import { schlickFresnelReflectance, refract, getRandomUnitDirection, getHalfVector, schlickFresnel } from './utils.js';
import { ggxvndfDirection, ggxvndfPDF, ggxShadowMaskG2, ggxDistribution } from './ggxSampling.js';
import { MathUtils, Vector3, Color } from 'three';

const MIN_ROUGHNESS = 1e-6;
const tempVector = new Vector3();
const tempDir = new Vector3();
const halfVector = new Vector3();
const tempSpecularColor = new Color();
const tempMetallicColor = new Color();
const tempDiffuseColor = new Color();
const whiteColor = new Color( 0xffffff );

// diffuse
function diffusePDF( wo, wi, material, hit ) {

	// https://raytracing.github.io/books/RayTracingTheRestOfYourLife.html#lightscattering/thescatteringpdf
	const cosValue = wi.z;
	return cosValue / Math.PI;

}

function diffuseDirection( wo, hit, material, lightDirection ) {

	getRandomUnitDirection( lightDirection );
	lightDirection.z += 1;
	lightDirection.normalize();

}

function diffuseColor( wo, wi, material, colorTarget ) {

	const { metalness } = material;
	colorTarget.copy( material.color ).multiplyScalar( ( 1.0 - metalness ) * wi.z / Math.PI );

}

// specular
function specularPDF( wo, wi, material, hit ) {

	// See equation (17) in http://jcgt.org/published/0003/02/03/
	const minRoughness = Math.max( material.roughness, MIN_ROUGHNESS );
	getHalfVector( wi, wo, halfVector );
	return ggxvndfPDF( wi, halfVector, minRoughness ) / ( 4 * wi.dot( halfVector ) );

}

function specularDirection( wo, hit, material, lightDirection ) {

	// sample ggx vndf distribution which gives a new normal
	const minRoughness = Math.max( material.roughness, MIN_ROUGHNESS );
	ggxvndfDirection(
		wo,
		minRoughness,
		minRoughness,
		Math.random(),
		Math.random(),
		tempVector,
	);

	// apply to new ray by reflecting off the new normal
	lightDirection.copy( wo ).reflect( tempVector ).multiplyScalar( - 1 );

}

function specularColor( wo, wi, material, colorTarget ) {

	// if roughness is set to 0 then D === NaN which results in black pixels
	const { metalness, roughness } = material;
	const minRoughness = Math.max( roughness, MIN_ROUGHNESS );

	getHalfVector( wo, wi, halfVector );
	const F = schlickFresnel( wi.dot( halfVector ), 0.1 );
	const G = ggxShadowMaskG2( wi, wo, minRoughness );
	const D = ggxDistribution( halfVector, minRoughness );
	// TODO: sometimes the incoming vector is negative (surface vs geom normal issue)
	// TODO: And even with flat normals we sometimes get a light direction below the surface? (negative z)
	// It's because with the roughness direction we get a normal that's really skewed and reflects to below z

	colorTarget
		.lerpColors( whiteColor, material.color, metalness )
		.multiplyScalar( G * D / ( 4 * Math.abs( wi.z * wo.z ) ) )
		.multiplyScalar( MathUtils.lerp( F, 1.0, metalness ) );

}

// transmission
function transmissionPDF( wo, wi, material, hit ) {

	// See section 4.2 in https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf

	const { roughness, ior } = material;
	const { frontFace } = hit;
	const ratio = frontFace ? 1 / ior : ior;
	const minRoughness = Math.max( roughness, MIN_ROUGHNESS );

	// TODO: check this is on the hit side
	halfVector.set( 0, 0, 0 ).addScaledVector( wi, ratio ).addScaledVector( wo, 1.0 ).normalize().multiplyScalar( - 1 );
	const denom = Math.pow( ratio * halfVector.dot( wi ) + 1.0 * halfVector.dot( wo ), 2.0 );
	return ggxvndfPDF( wi, halfVector, minRoughness ) / denom;

}

function transmissionDirection( wo, hit, material, lightDirection ) {

	const { roughness, ior } = material;
	const { frontFace } = hit;
	const ratio = frontFace ? 1 / ior : ior;

	// sample ggx vndf distribution which gives a new normal
	ggxvndfDirection(
		wo,
		roughness,
		roughness,
		Math.random(),
		Math.random(),
		tempVector,
	);

	// apply to new ray by reflecting off the new normal
	tempDir.copy( wo ).multiplyScalar( - 1 );
	refract( tempDir, tempVector, ratio, lightDirection );

}

function transmissionColor( wo, wi, material, colorTarget ) {

	const { metalness } = material;
	colorTarget.copy( material.color ).multiplyScalar( ( 1.0 - metalness ) * wo.z / Math.PI );

}

export function bsdfSample( wo, hit, material, sampleInfo ) {

	const lightDirection = sampleInfo.direction;
	const color = sampleInfo.color;
	const { ior, metalness, transmission } = material;
	const { frontFace } = hit;

	// TODO: this schlick fresnel is just for dialectrics because it uses ior interally
	// Change this to use a common fresnel function
	const ratio = frontFace ? 1 / ior : ior;
	const cosTheta = Math.min( wo.z, 1.0 );
	const sinTheta = Math.sqrt( 1.0 - cosTheta * cosTheta );
	let reflectance = schlickFresnelReflectance( cosTheta, ratio );
	const cannotRefract = ratio * sinTheta > 1.0;
	if ( cannotRefract ) {

		reflectance = 1;

	}

	let pdf = 0;
	if ( Math.random() < transmission ) {

		const specularProb = MathUtils.lerp( reflectance, 1.0, metalness );
		if ( Math.random() < specularProb ) {

			specularDirection( wo, hit, material, lightDirection );
			pdf = specularPDF( wo, lightDirection, material, hit );

			specularColor( wo, lightDirection, material, color );

			pdf *= specularProb;

		} else {

			// TODO
			transmissionDirection( wo, hit, material, lightDirection );
			pdf = 1.0; //transmissionPDF( wo, lightDirection, material, hit );

			transmissionColor( wo, lightDirection, material, color );

			pdf *= ( 1.0 - specularProb );

		}

		pdf *= transmission;

	} else {

		// TODO: is there a better way to determine probability here?
		if ( Math.random() < 0.5 ) {

			specularDirection( wo, hit, material, lightDirection );
			pdf = specularPDF( wo, lightDirection, material, hit );

			specularColor( wo, lightDirection, material, color );

			pdf *= 0.5;

		} else {

			diffuseDirection( wo, hit, material, lightDirection );
			pdf = diffusePDF( wo, lightDirection, material, hit );

			diffuseColor( wo, lightDirection, material, color );

			pdf *= 0.5;

		}

		pdf *= ( 1.0 - transmission );

	}

	sampleInfo.pdf = pdf;

}

// IN PROGRESS
export function getMaterialColor( wo, wi, material, hit, targetColor ) {

	const { metalness, roughness, color } = material;
	getHalfVector( wo, wi, halfVector );

	if ( wi.z < 0 ) {

		// transmissive

	} else {

		// specular, diffuse
		const cosTheta = wi.dot( halfVector );
		const theta = Math.acos( cosTheta );
		const F = schlickFresnel( wi.dot( halfVector ), 0.16 );
		const D = ggxDistribution( theta, roughness );
		const G = ggxShadowMaskG2( wi, wo, roughness );

		// specular contribution
		tempSpecularColor
			.set( 0xffffff )
			.multiplyScalar( F * G * D / ( 4 * wo.z * wi.z ) );

		tempMetallicColor
			.copy( tempSpecularColor )
			.multiply( color );

		// diffuse contribution
		tempDiffuseColor
			.copy( color )
			.multiplyScalar( ( 1.0 - metalness ) * ( 1.0 - F ) / Math.PI );

		targetColor
			.lerpColors( tempSpecularColor, tempMetallicColor, metalness )
			.add( tempDiffuseColor );

	}

}
