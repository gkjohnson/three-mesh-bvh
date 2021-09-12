import { EPSILON, schlickFresnelReflectance, refract } from './utils.js';
import { MathUtils, Vector3 } from 'three';

const tempVector = new Vector3();

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

	direction.random();
	direction.x -= 0.5;
	direction.y -= 0.5;
	direction.z -= 0.5;
	direction.normalize().add( normal ).normalize();

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
	const { geometryNormal, normal } = hit;

	direction.random();
	direction.x -= 0.5;
	direction.y -= 0.5;
	direction.z -= 0.5;
	tempVector.copy( ray.direction ).reflect( normal );
	direction.normalize().multiplyScalar( roughness ).add( tempVector );

	origin.copy( hit.point ).addScaledVector( geometryNormal, EPSILON );

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

	direction.random();
	direction.x -= 0.5;
	direction.y -= 0.5;
	direction.z -= 0.5;
	refract( ray.direction, normal, ratio, tempVector );
	direction.normalize().multiplyScalar( roughness ).add( tempVector );

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
