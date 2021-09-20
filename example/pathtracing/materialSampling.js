import { EPSILON, schlickFresnelReflectance, refract, getRandomUnitDirection } from './utils.js';
import { ggxvndfDirection } from './ggxSampling.js';
import { MathUtils, Vector3 } from 'three';

const tempVector = new Vector3();
const tempDir = new Vector3();

// diffuse
function diffuseWeight( reflectance, metalness, transmission ) {

	return ( 1.0 - reflectance ) * ( 1.0 - metalness ) * ( 1.0 - transmission );

}

function diffusePDF( direction, normal, roughness ) {

	// https://raytracing.github.io/books/RayTracingTheRestOfYourLife.html#lightscattering/thescatteringpdf
	const cosValue = direction.dot( normal );
	return cosValue / Math.PI;

}

function diffuseDirection( wo, hit, material, lightDirection ) {

	getRandomUnitDirection( lightDirection );
	lightDirection.z += 1;
	lightDirection.normalize();

}

// specular
function specularWeight( reflectance, metalness, transmission ) {

	return MathUtils.lerp( reflectance, 1.0, metalness );

}

function specularPDF( direction, normal, roughness ) {

	return 1; // TODO

}

function specularDirection( wo, hit, material, lightDirection ) {

	const { roughness } = material;

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
	lightDirection.copy( wo ).reflect( tempVector ).multiplyScalar( - 1 );

}

// transmission
function transmissionWeight( reflectance, metalness, transmission ) {

	return ( 1.0 - reflectance ) * ( 1.0 - metalness ) * transmission;

}

function transmissionPDF( direction, normal, roughness ) {

	return 1; // TODO

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

export function bsdfColor( ray, hit, material, colorTarget ) {



}

export function bsdfDirection( wo, hit, material, lightDirection ) {

	let randomValue = Math.random();
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

	// specular
	const sW = specularWeight( reflectance, metalness, transmission );
	const sVal = sW;

	if ( randomValue <= sVal ) {

		// TODO: need to account for equation 15 in http://jcgt.org/published/0007/04/01/
		specularDirection( wo, hit, material, lightDirection );
		return metalness;

	}

	randomValue -= sW;

	// diffuse
	const dW = diffuseWeight( reflectance, metalness, transmission );
	const dVal = dW;

	if ( randomValue <= dVal ) {

		diffuseDirection( wo, hit, material, lightDirection );
		return 1;

	}

	// transmission
	transmissionDirection( wo, hit, material, lightDirection );
	return 1.0;

}

export function bsdfPDF( ray, hit, material ) {

	// TODO: include "cannotRefract" in transmission / specular weight
	const { ior, metalness, roughness, transmission } = material;
	const { normal, frontFace } = hit;
	const { direction } = ray.direction;

	// TODO: do we need to handle the case where the ray is underneath the sphere on the shading normal?
	const ratio = frontFace ? 1 / ior : ior;
	const cosTheta = Math.min( - ray.direction.dot( normal ), 1.0 );
	const sinTheta = Math.sqrt( 1.0 - cosTheta * cosTheta );
	let reflectance = schlickFresnelReflectance( cosTheta, ratio );
	const cannotRefract = ratio * sinTheta > 1.0;
	if ( cannotRefract ) {

		reflectance = 1;

	}

	const dW = diffuseWeight( reflectance, metalness, transmission );
	const dPdf = diffusePDF( direction, normal, roughness );

	const sW = specularWeight( reflectance, metalness, transmission );
	const sPdf = specularPDF( direction, normal, roughness );

	const tW = transmissionWeight( reflectance, metalness, transmission );
	const tPdf = transmissionPDF( direction, normal, roughness );

	return dW * dPdf + sW * sPdf + tW * tPdf;

}
