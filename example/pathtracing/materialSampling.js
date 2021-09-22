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
function diffusePDF( wo, wi, material ) {

	// https://raytracing.github.io/books/RayTracingTheRestOfYourLife.html#lightscattering/thescatteringpdf
	const cosValue = wi.z;
	return cosValue / Math.PI;

}

function diffuseDirection( wo, hit, material, lightDirection ) {

	getRandomUnitDirection( lightDirection );
	lightDirection.z += 1;
	lightDirection.normalize();

}

// specular
function specularPDF( wo, wi, material ) {

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

// transmission
function transmissionPDF( wo, wi, material ) {

	// Is this needed?

	// const { roughness, ior } = material;
	// const { frontFace } = hit;
	// const ratio = frontFace ? 1 / ior : ior;


	// // See equation (17) in http://jcgt.org/published/0003/02/03/
	// getHalfVector( wi, wo, halfVector );
	// return ggxvndfPDF( wi, halfVector, material.roughness ) / ( 4 * wi.dot( wo ) );


	// return 1; // TODO

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

export function bsdfSample( wo, hit, material, sampleInfo ) {

	const lightDirection = sampleInfo.direction;
	const color = sampleInfo.color;
	const { ior, metalness, transmission, roughness } = material;
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

	const specularProb = MathUtils.lerp( reflectance, 1.0, metalness );
	let pdf = 0;
	if ( Math.random() < transmission ) {

		if ( Math.random() < specularProb ) {

			specularDirection( wo, hit, material, lightDirection );
			pdf = specularPDF( wo, lightDirection, material );
			color.lerpColors( whiteColor, material.color, metalness );

		} else {

			transmissionDirection( wo, hit, material, lightDirection );
			color.copy( material.color );

		}

	} else {

		if ( Math.random() < 0.5 ) {

			specularDirection( wo, hit, material, lightDirection );
			pdf = specularPDF( wo, lightDirection, material );

			// if roughness is set to 0 then D === NaN which results in black pixels
			const minRoughness = Math.max( roughness, MIN_ROUGHNESS );

			getHalfVector( wo, lightDirection, halfVector );
			const F = schlickFresnel( lightDirection.dot( halfVector ), 0.1 );
			const G = ggxShadowMaskG2( lightDirection, wo, minRoughness );
			const D = ggxDistribution( halfVector, minRoughness );
			// TODO: sometimes the incoming vector is negative (surface vs geom normal issue)
			// TODO: D results in some odd circle pattern at the moment

			color
				.lerpColors( whiteColor, material.color, metalness )
				.multiplyScalar( G * D / ( 4 * Math.abs( lightDirection.z * wo.z ) ) )
				.multiplyScalar( MathUtils.lerp( F, 1.0, metalness ) );


		} else {


			diffuseDirection( wo, hit, material, lightDirection );
			pdf = diffusePDF( wo, lightDirection, material );

			// const F = schlickFresnel( wo.z, 0.16 );
			color.copy( material.color )
				// .lerp( whiteColor, F )
				.multiplyScalar( ( 1.0 - metalness ) * pdf * 1.0 );

		}

		pdf *= 2.0;
		// pdf *= 1.0;
		color.multiplyScalar( 1 / pdf );

	}

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
