import { Vector3 } from 'three';
import { getHalfVector } from './utils.js';

const _V = new Vector3();
const _T1 = new Vector3();
const _T2 = new Vector3();
const _N = new Vector3();
const _Z_VECTOR = new Vector3( 0, 0, 1 );
const _HALF_VECTOR = new Vector3();
const M_PI = Math.PI;

// The GGX functions provide sampling and distribution information for normals as output so
// in order to get probability of scatter direction the half vector must be computed and provided.
// https://hal.archives-ouvertes.fr/hal-01509746/document
// http://jcgt.org/published/0007/04/01/
export function ggxvndfDirection( incidentDir, roughnessX, roughnessY, random1, random2, target ) {

	// stretch view
	const V = _V.set( roughnessX * incidentDir.x, roughnessY * incidentDir.y, incidentDir.z ).normalize();

	// orthonormal basis
	const T1 = ( V.z < 0.9999 ) ? _T1.crossVectors( V, _Z_VECTOR ).normalize() : _T1.set( 1, 0, 0 );
	const T2 = _T2.crossVectors( T1, V );

	// sample point with polar coordinates (r, phi)
	const a = 1.0 / ( 1.0 + V.z );
	const r = Math.sqrt( random1 );
	const phi = ( random2 < a ) ? random2 / a * M_PI : M_PI + ( random2 - a ) / ( 1.0 - a ) * M_PI;
	const P1 = r * Math.cos( phi );
	const P2 = r * Math.sin( phi ) * ( ( random2 < a ) ? 1.0 : V.z );

	// compute normal
	T1.multiplyScalar( P1 );
	T2.multiplyScalar( P2 );
	const N = _N.addVectors( T1, T2 ).addScaledVector( V, Math.sqrt( Math.max( 0.0, 1.0 - P1 * P1 - P2 * P2 ) ) );

	// unstretch
	N.x *= roughnessX;
	N.y *= roughnessY;
	N.z = Math.max( 0.0, N.z );
	N.normalize();

	target.copy( N );

	return target;

}

// Below are PDF and related functions for use in a Monte Carlo path tracer
// as specified in Appendix B of the following paper
// http://jcgt.org/published/0007/04/01/paper.pdf

// See equation (2)
function ggxLamda( theta, roughness ) {

	const tanTheta = Math.tan( theta );
	const tanTheta2 = tanTheta * tanTheta;
	const alpha2 = roughness * roughness;

	const numerator = - 1 + Math.sqrt( 1 + alpha2 * tanTheta2 );
	return numerator / 2;

}

// See equation (2)
export function ggxShadowMaskG1( theta, roughness ) {

	return 1.0 / ( 1.0 + ggxLamda( theta, roughness ) );

}

// See equation (125) in http://jcgt.org/published/0003/02/03/
export function ggxShadowMaskG2( wi, wo, roughness ) {

	const incidentTheta = Math.acos( wi.z );
	const scatterTheta = Math.acos( wo.z );
	return 1.0 / ( 1 + ggxLamda( incidentTheta, roughness ) + ggxLamda( scatterTheta, roughness ) );

}

// TODO: where is this from?
export function ggxDistribution( theta, roughness ) {

	const cosTheta = Math.cos( theta );
	const cosTheta2 = cosTheta * cosTheta;
	const cosTheta4 = cosTheta2 * cosTheta2;
	const tanTheta = Math.tan( theta );
	const tanTheta2 = tanTheta * tanTheta;
	const alpha2 = roughness * roughness;

	const denom = M_PI * cosTheta4 * Math.pow( alpha2 + tanTheta2, 2 );
	return alpha2 / denom;

}

// See equation (3)
function ggxvndfPDF( wi, halfVector, roughness ) {

	const incidentTheta = Math.acos( wi.z );
	const halfTheta = Math.acos( wi.z );

	const D = ggxDistribution( halfTheta, roughness );
	const G1 = ggxShadowMaskG1( incidentTheta, roughness );

	return D * G1 * Math.max( 0.0, wi.dot( halfVector ) ) / wi.z;

}

// See equation (17)
export function sampledGGXPDF( wi, wo, roughness ) {

	const halfVector = getHalfVector( wi, wo, _HALF_VECTOR );
	return ggxvndfPDF( wi, halfVector, roughness ) / ( 4 * wi.dot( wo ) );

}
