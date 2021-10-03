import { Vector3 } from 'three';

const tempVector = new Vector3();
const tempVector1 = new Vector3();
const tempVector2 = new Vector3();

export const EPSILON = 1e-7;

// https://docs.microsoft.com/en-us/windows/win32/api/d3d11/ne-d3d11-d3d11_standard_multisample_quality_levels
export const ANTIALIAS_WIDTH = 16;
export const ANTIALIAS_OFFSETS = [
	[ 1, 1 ], [ - 1, - 3 ], [ - 3, 2 ], [ 4, - 1 ],
	[ - 5, - 2 ], [ 2, 5 ], [ 5, 3 ], [ 3, - 5 ],
	[ - 2, 6 ], [ 0, - 7 ], [ - 4, - 6 ], [ - 6, 4 ],
	[ - 8, 0 ], [ 7, - 4 ], [ 6, 7 ], [ - 7, - 8 ],
];

// https://google.github.io/filament/Filament.md.html#materialsystem/diffusebrdf
export function schlickFresnel( cosine, f0 ) {

	return f0 + ( 1.0 - f0 ) * Math.pow( 1.0 - cosine, 5.0 );

}

// https://raytracing.github.io/books/RayTracingInOneWeekend.html#dielectrics/schlickapproximation
export function schlickFresnelFromIor( cosine, iorRatio ) {

	// Schlick approximation
	const r0 = Math.pow( ( 1 - iorRatio ) / ( 1 + iorRatio ), 2 );
	return schlickFresnel( cosine, r0 );

}

export function refract( dir, norm, iorRatio, target ) {

	// snell's law
	// ior1 * sin( t1 ) = ior2 * sin( t2 )
	let cosTheta = Math.min( - dir.dot( norm ), 1.0 );

	tempVector
		.copy( dir )
		.addScaledVector( norm, cosTheta )
		.multiplyScalar( iorRatio );

	target
		.copy( norm )
		.multiplyScalar( - Math.sqrt( Math.abs( 1.0 - tempVector.lengthSq() ) ) )
		.add( tempVector );

}

// forms a basis with the normal vector as Z
export function getBasisFromNormal( normal, targetMatrix ) {

	if ( Math.abs( normal.x ) > 0.5 ) {

		tempVector.set( 0, 1, 0 );

	} else {

		tempVector.set( 1, 0, 0 );

	}

	tempVector1.crossVectors( normal, tempVector ).normalize();
	tempVector2.crossVectors( normal, tempVector1 ).normalize();
	targetMatrix.makeBasis( tempVector2, tempVector1, normal );

}

export function getHalfVector( a, b, target ) {

	return target.addVectors( a, b ).normalize();

}

// The discrepancy between interpolated surface normal and geometry normal can cause issues when a ray
// is cast that is on the top side of the geometry normal plane but below the surface normal plane. If
// we find a ray like that we ignore it to avoid artifacts.
// This function returns if the direction is on the same side of both planes.
export function isDirectionValid( direction, surfaceNormal, geometryNormal ) {

	const aboveSurfaceNormal = direction.dot( surfaceNormal ) > 0;
	const aboveGeometryNormal = direction.dot( geometryNormal ) > 0;
	return aboveSurfaceNormal === aboveGeometryNormal;

}
