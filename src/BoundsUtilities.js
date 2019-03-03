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

		p1.normal.subVectors( v1, v2 ).normalize();
		p1.constant = p1.normal.dot( v1 );

		p2.normal.copy( p1.normal ).multiplyScalar( - 1 );
		p2.constant = p2.normal.dot( v2 );

	}

	return target;

}

function boxIntersectsObb( bounds, obbPlanes, obbPoints ) {

	for ( let i = 0, l = obbPoints.length; i < l; i ++ ) {

		if ( bounds.containsPoint( obbPoints[ i ] ) ) return true;

	}

	// check the bounds planes
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

					// TODO: we're assuming the normal is pointing away from the box here
					// so why is this >= and not <=?
					if ( plane.distanceToPoint( v1 ) >= 0 ) {

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

function boxIntersectsTriangle( obbPlanes, triangle ) {

	let crossCount = 0;
	for ( let i = 0; i < 3; i ++ ) {

		let sideA, sideB, sideC;

		const p1 = obbPlanes[ i ];
		sideA = p1.distanceToPoint( triangle.a ) > 0;
		sideB = p1.distanceToPoint( triangle.b ) > 0;
		sideC = p1.distanceToPoint( triangle.c ) > 0;

		if ( sideA !== sideB || sideA !== sideC ) {

			crossCount ++;
			continue;

		}

		const p2 = obbPlanes[ i + 3 ];
		sideA = p2.distanceToPoint( triangle.a ) > 0;
		sideB = p2.distanceToPoint( triangle.b ) > 0;
		sideC = p2.distanceToPoint( triangle.c ) > 0;

		if ( sideA !== sideB || sideA !== sideC ) {

			crossCount ++;
			continue;

		}

	}

	return crossCount === 3;

}

function triangleIntersectsTriangle( triA, triB ) {

	throw new Error( 'Not Implemented' );

}

export {
	boundsToArray, arrayToBox, getLongestEdgeIndex, boxToObbPoints,
	boxToObbPlanes, boxIntersectsObb, sphereIntersectTriangle, boxIntersectsTriangle,
	triangleIntersectsTriangle
};
