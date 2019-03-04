import { Vector3, Line3, Plane } from 'three';

// Returns a Float32Array representing the bounds data for box.
function boundsToArray( bx ) {

	const arr = new Float32Array( 6 );

	arr[ 0 ] = bx.min.x;
	arr[ 1 ] = bx.min.y;
	arr[ 2 ] = bx.min.z;

	arr[ 3 ] = bx.max.x;
	arr[ 4 ] = bx.max.y;
	arr[ 5 ] = bx.max.z;

	return arr;

}

function arrayToBox( arr, target ) {

	target.min.x = arr[ 0 ];
	target.min.y = arr[ 1 ];
	target.min.z = arr[ 2 ];

	target.max.x = arr[ 3 ];
	target.max.y = arr[ 4 ];
	target.max.z = arr[ 5 ];

	return target;

}

function getLongestEdgeIndex( bounds ) {

	let splitDimIdx = - 1;
	let splitDist = - Infinity;

	for ( let i = 0; i < 3; i ++ ) {

		const dist = bounds[ i + 3 ] - bounds[ i ];
		if ( dist > splitDist ) {

			splitDist = dist;
			splitDimIdx = i;

		}

	}

	return splitDimIdx;

}

function boxToObbPoints( bounds, matrix, target ) {

	const min = bounds.min;
	const max = bounds.max;
	for ( let x = 0; x <= 1; x ++ ) {

		for ( let y = 0; y <= 1; y ++ ) {

			for ( let z = 0; z <= 1; z ++ ) {

				const i = ( ( 1 << 0 ) * x ) | ( ( 1 << 1 ) * y ) | ( ( 1 << 2 ) * z );
				const v = target[ i ];
				v.x = min.x * x + max.x * ( 1 - x );
				v.y = min.y * y + max.y * ( 1 - y );
				v.z = min.z * z + max.z * ( 1 - z );

				v.applyMatrix4( matrix );

			}

		}

	}

	return target;

}

// returns an array with infinite planes defining the box
// in the following order
// [ minx, miny, minz, maxx, maxy, maxz ]

// the normals of the plane face outward
const xyzFields = [ 'x', 'y', 'z' ];
const v1 = new Vector3();
const v2 = new Vector3();
const center = new Vector3();
function boxToObbPlanes( bounds, matrix, target ) {

	const min = bounds.min;
	const max = bounds.max;
	bounds.getCenter( center );

	// iterate over every axis
	for ( let i = 0; i < 3; i ++ ) {

		// plane 1 and 2 targets along the given axis
		const p1 = target[ i ];
		const p2 = target[ i + 3 ];

		// i1 is the axis we're working with
		const i1 = xyzFields[ ( i + 0 ) % 3 ];
		const i2 = xyzFields[ ( i + 1 ) % 3 ];
		const i3 = xyzFields[ ( i + 2 ) % 3 ];

		// get the center point on each side of the box
		v1[ i1 ] = min[ i1 ];
		v1[ i2 ] = center[ i2 ];
		v1[ i3 ] = center[ i3 ];

		v2[ i1 ] = max[ i1 ];
		v2[ i2 ] = center[ i2 ];
		v2[ i3 ] = center[ i3 ];

		v1.applyMatrix4( matrix );
		v2.applyMatrix4( matrix );

		// NOTE: the constants seem to be stored negatively here
		// for some reason?
		p1.normal.subVectors( v1, v2 ).normalize();
		p1.setFromNormalAndCoplanarPoint( p1.normal, v1 );

		p2.normal.copy( p1.normal ).multiplyScalar( - 1 );
		p2.setFromNormalAndCoplanarPoint( p2.normal, v2 );

	}

	return target;

}

function boxIntersectsObb( bounds, obbPlanes, obbPoints ) {

	// check the abb bounds planes
	const min = bounds.min;
	const max = bounds.max;
	for ( let i = 0; i < 3; i ++ ) {

		const field = xyzFields[ i ];
		const minVal = min[ field ];
		const maxVal = max[ field ];

		// save the side that we find the first field is on
		let didCross = false;
		for ( let i = 0; i < 8; i ++ ) {

			// For the negative side plane the point should be less to
			// separate the boxes. The opposite for max side
			const val = obbPoints[ i ][ field ];
			const obbSideMin = val >= minVal;
			const obbSideMax = val <= maxVal;

			// we've found a point that's on the opposite side of the plane
			if ( obbSideMin || obbSideMax ) {

				didCross = true;
				break;

			}

		}

		// if one plane separated all points then we found a separating plane
		if ( didCross === false ) {

			return false;

		}

	}

	// check the obb planes
	for ( let i = 0; i < 6; i ++ ) {

		// p1 is min side plane, p2 is max side plane
		const plane = obbPlanes[ i ];
		let didCross = false;

		pointsLoop :
		for ( let x = 0; x <= 1; x ++ ) {

			for ( let y = 0; y <= 1; y ++ ) {

				for ( let z = 0; z <= 1; z ++ ) {

					v1.x = min.x * x + max.x * ( 1 - x );
					v1.y = min.y * y + max.y * ( 1 - y );
					v1.z = min.z * z + max.z * ( 1 - z );

					// if the point doesn't fall on the side of the plane that points
					// away from the OBB, then it's not a separating plane
					if ( plane.distanceToPoint( v1 ) <= 0 ) {

						didCross = true;
						break pointsLoop;

					}

				}

			}

		}

		if ( didCross === false ) {

			return false;

		}


	}

	return true;

}

// https://stackoverflow.com/questions/34043955/detect-collision-between-sphere-and-triangle-in-three-js
const closestPointTemp = new Vector3();
const projectedPointTemp = new Vector3();
const planeTemp = new Plane();
const lineTemp = new Line3();
function sphereIntersectTriangle( sphere, triangle ) {

	const { radius, center } = sphere;
	const { a, b, c } = triangle;

	// phase 1
	lineTemp.start = a;
	lineTemp.end = b;
	const closestPoint1 = lineTemp.closestPointToPoint( center, true, closestPointTemp );
	if ( closestPoint1.distanceTo( center ) <= radius ) return true;

	lineTemp.start = a;
	lineTemp.end = c;
	const closestPoint2 = lineTemp.closestPointToPoint( center, true, closestPointTemp );
	if ( closestPoint2.distanceTo( center ) <= radius ) return true;

	lineTemp.start = b;
	lineTemp.end = c;
	const closestPoint3 = lineTemp.closestPointToPoint( center, true, closestPointTemp );
	if ( closestPoint3.distanceTo( center ) <= radius ) return true;

	// phase 2
	const plane = triangle.getPlane( planeTemp );
	const dp = Math.abs( plane.distanceToPoint( center ) );
	if ( dp <= radius ) {

		const pp = plane.projectPoint( center, projectedPointTemp );
		const cp = triangle.containsPoint( pp );
		if ( cp ) return true;

	}

	return false;

}

// returns true if all points are on the positive side of the plane
function planeSeparatesPoints( plane, points ) {

	for ( let i = 0, l = points.length; i < l; i ++ ) {

		if ( plane.distanceToPoint( points[ i ] ) <= 0 ) {

			return false;

		}

	}

	return true;

}

const tempTriPlane = new Plane();
const tempTriNormal = new Vector3();
const tempTriEdge = new Vector3();
function triangleSeparatesPoints( triangle, points ) {

	const triEdge = tempTriEdge;
	const triNormal = tempTriNormal;
	triangle.getNormal( triNormal );

	// check the triangle plane
	const triPlane = tempTriPlane;
	triangle.getPlane( triPlane );

	if ( planeSeparatesPoints( triPlane, points ) ) return true;


	// check the other way
	triPlane.negate();
	if ( planeSeparatesPoints( triPlane, points ) ) return true;


	// check the edge 1 plane
	triEdge.subVectors( triangle.b, triangle.a );
	triPlane.normal.crossVectors( triEdge, triNormal ).normalize();
	triPlane.setFromNormalAndCoplanarPoint( triPlane.normal, triangle.a );

	if ( triEdge.length() !== 0 && planeSeparatesPoints( triPlane, points ) ) return true;


	// check the edge 2 plane
	triEdge.subVectors( triangle.c, triangle.b );
	triPlane.normal.crossVectors( triEdge, triNormal ).normalize();
	triPlane.setFromNormalAndCoplanarPoint( triPlane.normal, triangle.b );

	if ( triEdge.length() !== 0 && planeSeparatesPoints( triPlane, points ) ) return true;


	// check the edge 3 plane
	triEdge.subVectors( triangle.a, triangle.c );
	triPlane.normal.crossVectors( triEdge, triNormal ).normalize();
	triPlane.setFromNormalAndCoplanarPoint( triPlane.normal, triangle.c );

	if ( triEdge.length() !== 0 && planeSeparatesPoints( triPlane, points ) ) return true;

	return false;

}

function boxIntersectsTriangle( obbPlanes, obbPoints, triangle ) {

	// check if the planes are separating
	for ( let i = 0; i < 6; i ++ ) {

		const plane = obbPlanes[ i ];
		const distA = plane.distanceToPoint( triangle.a );
		const distB = plane.distanceToPoint( triangle.b );
		const distC = plane.distanceToPoint( triangle.c );

		const sideA = distA > 0;
		const sideB = distB > 0;
		const sideC = distC > 0;

		// If all the triangle points are on the outward side of the
		// plane then it must be separating
		if ( sideA && sideB && sideC ) {

			return false;

		}

	}

	if ( triangleSeparatesPoints( triangle, obbPoints ) ) return false;

	return true;

}

// TODO: Incorrect application of SAT?
const tempVectorArray = [];
function triangleIntersectsTriangleOld( triA, triB ) {

	// check if there's a plane from the first triangle that separates the vectors
	tempVectorArray[ 0 ] = triB.a;
	tempVectorArray[ 1 ] = triB.b;
	tempVectorArray[ 2 ] = triB.c;

	if ( triangleSeparatesPoints( triA, tempVectorArray ) ) return false;

	// check the second
	tempVectorArray[ 0 ] = triA.a;
	tempVectorArray[ 1 ] = triA.b;
	tempVectorArray[ 2 ] = triA.c;

	if ( triangleSeparatesPoints( triB, tempVectorArray ) ) return false;

	return true;

}

function triangleIntersectsTriangle( t1, t2 ) {

	const p1 = new Plane();
	t1.getPlane( p1 );

	const p2 = new Plane();
	t2.getPlane( p2 );

	if ( p1.distanceToPoint( t2.a ) === 0 && t1.containsPoint( t2.a ) ) return true;
	if ( p1.distanceToPoint( t2.b ) === 0 && t1.containsPoint( t2.b ) ) return true;
	if ( p1.distanceToPoint( t2.c ) === 0 && t1.containsPoint( t2.c ) ) return true;

	if ( p2.distanceToPoint( t1.a ) === 0 && t2.containsPoint( t1.a ) ) return true;
	if ( p2.distanceToPoint( t1.b ) === 0 && t2.containsPoint( t1.b ) ) return true;
	if ( p2.distanceToPoint( t1.c ) === 0 && t2.containsPoint( t1.c ) ) return true;

	const e1ab = new Line3( t1.a, t1.b );
	const e1bc = new Line3( t1.b, t1.c );
	const e1ca = new Line3( t1.c, t1.a );

	const e2ab = new Line3( t2.a, t2.b );
	const e2bc = new Line3( t2.b, t2.c );
	const e2ca = new Line3( t2.c, t2.a );

	const e1pab = p2.intersectLine( e1ab, new Vector3() );
	const e1pbc = p2.intersectLine( e1bc, new Vector3() );
	const e1pca = p2.intersectLine( e1ca, new Vector3() );

	const e2pab = p1.intersectLine( e2ab, new Vector3() );
	const e2pbc = p1.intersectLine( e2bc, new Vector3() );
	const e2pca = p1.intersectLine( e2ca, new Vector3() );


	if ( e2pab && t1.containsPoint( e2pab ) ) return true;
	if ( e2pbc && t1.containsPoint( e2pbc ) ) return true;
	if ( e2pca && t1.containsPoint( e2pca ) ) return true;


	if ( e1pab && t2.containsPoint( e1pab ) ) return true;
	if ( e1pbc && t2.containsPoint( e1pbc ) ) return true;
	if ( e1pca && t2.containsPoint( e1pca ) ) return true;

	return false;

}


export {
	boundsToArray, arrayToBox, getLongestEdgeIndex, boxToObbPoints,
	boxToObbPlanes, boxIntersectsObb, sphereIntersectTriangle, boxIntersectsTriangle,
	triangleIntersectsTriangle
};
