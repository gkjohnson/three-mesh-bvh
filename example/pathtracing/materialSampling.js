import { EPSILON, schlickFresnelReflectance, refract, getRandomUnitDirection, getBasisFromNormal } from './utils.js';
import { ggxvndfDirection } from './ggxSampling.js';
import { MathUtils, Vector3, Matrix4 } from 'three';

const tempVector = new Vector3();
const tempDir = new Vector3();
const tempMat = new Matrix4();
const tempInvMat = new Matrix4();

// diffuse
function diffuseWeight( reflectance, metalness, transmission ) {

	return ( 1.0 - reflectance ) * ( 1.0 - metalness ) * ( 1.0 - transmission );

}

function diffusePDF( direction, normal, roughness ) {

	return 1; // TODO

}

function diffuseDirection( ray, hit, material, rayTarget ) {

	const { origin, direction } = rayTarget;
	const { geometryNormal, normal } = hit;

	getRandomUnitDirection( direction ).add( normal ).normalize();
	origin.copy( hit.point ).addScaledVector( geometryNormal, EPSILON );

}

// specular
function specularWeight( reflectance, metalness, transmission ) {

	return MathUtils.lerp( reflectance, 1.0, metalness );

}

function specularPDF( direction, normal, roughness ) {

	return 1; // TODO

}

function specularDirection( ray, hit, material, rayTarget ) {

	const { roughness } = material;
	const { origin, direction } = rayTarget;
	const { geometryNormal } = hit;

	// get the basis matrix and invert from the hit normal
	getBasisFromNormal( hit.normal, tempMat );
	tempInvMat.copy( tempMat ).invert();

	// convert the hit direction into the local frame facing away from the origin
	tempDir.copy( ray.direction ).applyMatrix4( tempInvMat ).multiplyScalar( - 1 ).normalize();

	// sample ggx vndf distribution which gives a new normal
	ggxvndfDirection(
		tempDir,
		roughness,
		roughness,
		Math.random(),
		Math.random(),
		tempVector,
	);

	// transform normal back into world space
	tempVector.applyMatrix4( tempMat );

	// apply to new ray by reflecting off the new normal
	direction.copy( ray.direction ).reflect( tempVector );
	origin.copy( hit.point ).addScaledVector( geometryNormal, EPSILON );

	// // basic implementation
	// const { roughness } = material;
	// const { origin, direction } = rayTarget;
	// const { geometryNormal, normal } = hit;

	// tempVector.copy( ray.direction ).reflect( normal );
	// getRandomUnitDirection( direction ).multiplyScalar( roughness ).add( tempVector );
	// origin.copy( hit.point ).addScaledVector( geometryNormal, EPSILON );

}

// transmission
function transmissionWeight( reflectance, metalness, transmission ) {

	return ( 1.0 - reflectance ) * ( 1.0 - metalness ) * transmission;

}

function transmissionPDF( direction, normal, roughness ) {

	return 1; // TODO

}

function transmissionDirection( ray, hit, material, rayTarget ) {

	const { roughness, ior } = material;
	const { origin, direction } = rayTarget;
	const { geometryNormal, normal, frontFace } = hit;
	const ratio = frontFace ? 1 / ior : ior;

	refract( ray.direction, normal, ratio, tempVector );
	getRandomUnitDirection( direction ).multiplyScalar( roughness ).add( tempVector );

	origin.copy( hit.point ).addScaledVector( geometryNormal, - EPSILON );

}

export function bsdfColor( ray, hit, material, colorTarget ) {



}

export function bsdfDirection( ray, hit, material, rayTarget ) {

	let randomValue = Math.random();
	const { ior, metalness, roughness, transmission } = material;
	const { normal, frontFace } = hit;

	const ratio = frontFace ? 1 / ior : ior;
	const cosTheta = Math.min( - ray.direction.dot( normal ), 1.0 );
	const sinTheta = Math.sqrt( 1.0 - cosTheta * cosTheta );
	let reflectance = schlickFresnelReflectance( cosTheta, ratio );
	const cannotRefract = ratio * sinTheta > 1.0;
	if ( cannotRefract ) {

		reflectance = 1;

	}

	// specular
	const sW = specularWeight( reflectance, metalness, transmission );
	const sPdf = specularPDF( ray.direction, normal, roughness );
	const sVal = sW * sPdf;

	if ( randomValue <= sVal ) {

		specularDirection( ray, hit, material, rayTarget );
		return metalness;

	}

	randomValue -= sW;

	// diffuse
	const dW = diffuseWeight( reflectance, metalness, transmission );
	const dPdf = diffusePDF( ray.direction, normal, roughness );
	const dVal = dW * dPdf;

	if ( randomValue <= dVal ) {

		diffuseDirection( ray, hit, material, rayTarget );
		return 1;

	}

	// transmission
	transmissionDirection( ray, hit, material, rayTarget );
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
