import { schlickFresnelReflectance, refract, getRandomUnitDirection, getHalfVector, schlickFresnel } from './utils.js';
import { ggxvndfDirection, ggxvndfPDF, ggxShadowMaskG2, ggxDistribution } from './ggxSampling.js';
import { MathUtils, Vector3, Color } from 'three';

// Technically this value should be based on the index of refraction of the given dielectric.
const MIN_ROUGHNESS = 1e-6;
const tempDir = new Vector3();
const halfVector = new Vector3();
const tempColor = new Color();
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

function diffuseColor( wo, wi, material, hit, colorTarget ) {

	// note on division by PI
	// https://seblagarde.wordpress.com/2012/01/08/pi-or-not-to-pi-in-game-lighting-equation/
	const { metalness, transmission } = material;
	colorTarget
		.copy( material.color )
		.multiplyScalar( ( 1.0 - metalness ) * wi.z / Math.PI / Math.PI )
		.multiplyScalar( 1.0 - transmission );

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

// TODO: This is just using a basic cosine-weighted specular distribution with an
// incorrect PDF value at the moment. Update it to correctly use a GGX distribution
function transmissionPDF( wo, wi, material, hit ) {

	return 1.0;

}

function transmissionDirection( wo, hit, material, lightDirection ) {

	const { roughness, ior } = material;
	const { frontFace } = hit;
	const ratio = frontFace ? 1 / ior : ior;

	tempDir.copy( wo ).multiplyScalar( - 1 );
	refract( tempDir, new Vector3( 0, 0, 1 ), ratio, lightDirection );
	getRandomUnitDirection( tempDir );
	tempDir.multiplyScalar( roughness );
	lightDirection.add( tempDir );

}

function transmissionColor( wo, wi, material, hit, colorTarget ) {

	const { metalness, transmission } = material;
	colorTarget
		.copy( material.color )
		.multiplyScalar( 1.0 - metalness )
		.multiplyScalar( Math.abs( wi.z ) )
		.multiplyScalar( transmission );

	// Color is clamped to [0, 1] to make up for incorrect PDF and over sampling
	colorTarget.r = Math.min( colorTarget.r, 1.0 );
	colorTarget.g = Math.min( colorTarget.g, 1.0 );
	colorTarget.b = Math.min( colorTarget.b, 1.0 );

}

export function bsdfPdf( wo, wi, material, hit ) {

	const { ior, metalness, transmission } = material;
	const { frontFace } = hit;

	const ratio = frontFace ? 1 / ior : ior;
	const cosTheta = Math.min( wo.z, 1.0 );
	const sinTheta = Math.sqrt( 1.0 - cosTheta * cosTheta );
	let reflectance = schlickFresnelReflectance( cosTheta, ratio );
	const cannotRefract = ratio * sinTheta > 1.0;
	if ( cannotRefract ) {

		reflectance = 1;

	}

	let spdf = 0;
	let dpdf = 0;
	let tpdf = 0;

	if ( wi.z < 0 ) {

		tpdf = transmissionPDF( wo, wi, material, hit );

	} else {

		spdf = specularPDF( wo, wi, material, hit );
		dpdf = diffusePDF( wo, wi, material, hit );

	}

	const transSpecularProb = MathUtils.lerp( reflectance, 1.0, metalness );
	const diffSpecularProb = 0.5 + 0.5 * metalness;
	const pdf =
		spdf * transmission * transSpecularProb
		+ tpdf * transmission * ( 1.0 - transSpecularProb )
		+ spdf * ( 1.0 - transmission ) * diffSpecularProb
		+ dpdf * ( 1.0 - transmission ) * ( 1.0 - diffSpecularProb );

	return pdf;

}

export function bsdfColor( wo, wi, material, hit, targetColor ) {

	if ( wi.z < 0 ) {

		transmissionColor( wo, wi, material, hit, targetColor );

	} else {

		diffuseColor( wo, wi, material, hit, targetColor );
		targetColor.multiplyScalar( 1.0 - material.transmission );

		specularColor( wo, wi, material, hit, tempColor );
		targetColor.add( tempColor );

	}

}

export function bsdfSample( wo, hit, material, sampleInfo ) {

	const lightDirection = sampleInfo.direction;
	const color = sampleInfo.color;
	const { ior, metalness, transmission } = material;
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

			transmissionDirection( wo, hit, material, lightDirection );
			pdf = transmissionPDF( wo, lightDirection, material, hit );
			transmissionColor( wo, lightDirection, material, hit, color );

			pdf *= ( 1.0 - specularProb );

		}

		pdf *= transmission;

	} else {

		const specularProb = 0.5 + 0.5 * metalness;
		if ( Math.random() < specularProb ) {

			specularDirection( wo, hit, material, lightDirection );
			pdf = specularPDF( wo, lightDirection, material, hit );
			specularColor( wo, lightDirection, material, hit, color );

			pdf *= specularProb;

		} else {

			diffuseDirection( wo, hit, material, lightDirection );
			pdf = diffusePDF( wo, lightDirection, material, hit );
			diffuseColor( wo, lightDirection, material, hit, color );

			pdf *= ( 1.0 - specularProb );

		}

		pdf *= ( 1.0 - transmission );

	}

	sampleInfo.pdf = bsdfPdf( wo, lightDirection, material, hit );
	bsdfColor( wo, lightDirection, material, hit, sampleInfo.color );

}

