import { schlickFresnelReflectance, refract, getRandomUnitDirection, getHalfVector, schlickFresnel } from './utils.js';
import { ggxvndfDirection, ggxvndfPDF, ggxShadowMaskG2, ggxDistribution } from './ggxSampling.js';
import { MathUtils, Vector3, Color } from 'three';

// Technically this value should be based on the index of refraction of the given dielectric.
const SCHLICK_FRESNEL_FACTOR = 0.05;
const MIN_ROUGHNESS = 1e-6;
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

	// note on division by PI
	// https://seblagarde.wordpress.com/2012/01/08/pi-or-not-to-pi-in-game-lighting-equation/
	const { metalness } = material;
	colorTarget
		.copy( material.color )
		.multiplyScalar( ( 1.0 - metalness ) * wi.z / Math.PI / Math.PI );

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
		halfVector,
	);

	// apply to new ray by reflecting off the new normal
	lightDirection.copy( wo ).reflect( halfVector ).multiplyScalar( - 1 );

}

function specularColor( wo, wi, material, hit, colorTarget ) {

	// if roughness is set to 0 then D === NaN which results in black pixels
	const { metalness, roughness, ior } = material;
	const { frontFace } = hit;
	const minRoughness = Math.max( roughness, MIN_ROUGHNESS );

	getHalfVector( wo, wi, halfVector );
	const iorRatio = frontFace ? 1 / ior : ior;
	const G = ggxShadowMaskG2( wi, wo, minRoughness );
	const D = ggxDistribution( halfVector, minRoughness );
	// TODO: sometimes the incoming vector is negative (surface vs geom normal issue)

	let F = schlickFresnelReflectance( wi.dot( halfVector ), iorRatio );
	const cosTheta = Math.min( wo.z, 1.0 );
	const sinTheta = Math.sqrt( 1.0 - cosTheta * cosTheta );
	const cannotRefract = iorRatio * sinTheta > 1.0;
	if ( cannotRefract ) {

		F = 1;

	}

	colorTarget
		.lerpColors( whiteColor, material.color, metalness )
		.multiplyScalar( G * D / ( 4 * Math.abs( wi.z * wo.z ) ) )
		.multiplyScalar( MathUtils.lerp( F, 1.0, metalness ) )
		.multiplyScalar( wi.z ); // scale the light by the direction the light is coming in from


}

/*
// transmission
function transmissionPDF( wo, wi, material, hit ) {

	// See section 4.2 in https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf

	const { roughness, ior } = material;
	const { frontFace } = hit;
	const ratio = frontFace ? ior : 1 / ior;
	const minRoughness = Math.max( roughness, MIN_ROUGHNESS );

	halfVector.set( 0, 0, 0 ).addScaledVector( wi, ratio ).addScaledVector( wo, 1.0 ).normalize().multiplyScalar( - 1 );

	const denom = Math.pow( ratio * halfVector.dot( wi ) + 1.0 * halfVector.dot( wo ), 2.0 );
	return ggxvndfPDF( wo, halfVector, minRoughness ) / denom;

}

function transmissionDirection( wo, hit, material, lightDirection ) {

	const { roughness, ior } = material;
	const { frontFace } = hit;
	const ratio = frontFace ? 1 / ior : ior;
	const minRoughness = Math.max( roughness, MIN_ROUGHNESS );

	// sample ggx vndf distribution which gives a new normal
	ggxvndfDirection(
		wo,
		minRoughness,
		minRoughness,
		Math.random(),
		Math.random(),
		halfVector,
	);

	// apply to new ray by reflecting off the new normal
	tempDir.copy( wo ).multiplyScalar( - 1 );
	refract( tempDir, halfVector, ratio, lightDirection );

}

function transmissionColor( wo, wi, material, colorTarget ) {

	const { metalness } = material;
	colorTarget.copy( material.color ).multiplyScalar( ( 1.0 - metalness ) * wo.z / Math.PI );

}
*/

export function bsdfSample( wo, hit, material, sampleInfo ) {

	const lightDirection = sampleInfo.direction;
	const color = sampleInfo.color;
	const { ior, metalness, transmission, roughness } = material;
	const { frontFace } = hit;

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

			specularColor( wo, lightDirection, material, hit, color );

			pdf *= specularProb;

		} else {

			// TODO: This is just using a basic cosine-weighted specular distribution with an
			// incorrect PDF value at the moment. Update it to correctly use a GGX distribution
			tempDir.copy( wo ).multiplyScalar( - 1 );
			refract( tempDir, new Vector3( 0, 0, 1 ), ratio, lightDirection );
			getRandomUnitDirection( tempDir );
			tempDir.multiplyScalar( roughness );
			lightDirection.add( tempDir );

			pdf = 1.0;
			color
				.copy( material.color )
				.multiplyScalar( 1.0 - metalness )
				.multiplyScalar( Math.abs( lightDirection.z ) );

			// Color is clamped to [0, 1] to make up for incorrect PDF and over sampling
			color.r = Math.min( color.r, 1.0 );
			color.g = Math.min( color.g, 1.0 );
			color.b = Math.min( color.b, 1.0 );

			// transmissionDirection( wo, hit, material, lightDirection );
			// pdf = transmissionPDF( wo, lightDirection, material, hit );
			// transmissionColor( wo, lightDirection, material, color );

			pdf *= ( 1.0 - specularProb );

		}

		pdf *= transmission;

	} else {

		const specProb = 0.5 + 0.5 * metalness;
		if ( Math.random() < specProb ) {

			specularDirection( wo, hit, material, lightDirection );
			pdf = specularPDF( wo, lightDirection, material, hit );

			specularColor( wo, lightDirection, material, hit, color );

			pdf *= specProb;

		} else {

			diffuseDirection( wo, hit, material, lightDirection );
			pdf = diffusePDF( wo, lightDirection, material, hit );

			diffuseColor( wo, lightDirection, material, color );

			pdf *= ( 1.0 - specProb );

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

		// TODO: use IOR here, instead
		const F = schlickFresnel( wi.dot( halfVector ), SCHLICK_FRESNEL_FACTOR );
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
