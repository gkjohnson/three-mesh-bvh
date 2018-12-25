import { Vector3 } from 'three';

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

				const i = ( 1 << ( x + y + z ) ) - 1;
				const v = target[ i ];
				v.x = min.x * x + max.x * ( 1 - x );
				v.y = min.y * x + max.y * ( 1 - y );
				v.z = min.z * x + max.z * ( 1 - z );

				v.applyMatrix4( matrix );

			}

		}

	}

	return target;

}

const xyzFields = [ 'x', 'y', 'z' ];
const v1 = new Vector3();
const v2 = new Vector3();
function boxToObbPlanes( bounds, matrix, target ) {

	const min = bounds.min;
	const max = bounds.max;
	for ( let i = 0; i < 3; i ++ ) {

		const p1 = target[ i ];
		const p2 = target[ i + 3 ];

		const i1 = xyzFields[ ( i + 0 ) % 3 ];
		const i2 = xyzFields[ ( i + 1 ) % 3 ];
		const i3 = xyzFields[ ( i + 2 ) % 3 ];

		v1[ i1 ] = min[ i1 ];
		v1[ i2 ] = min[ i2 ];
		v1[ i3 ] = min[ i3 ];

		v1[ i1 ] = max[ i1 ];
		v1[ i2 ] = min[ i2 ];
		v1[ i3 ] = min[ i3 ];

		v1.applyMatrix4( matrix );
		v2.applyMatrix4( matrix );

		p1.normal.subVectors( v1, v2 );
		p1.constant = p1.normal.dot( v1 );

		p2.normal.subVectors( v1, v2 );
		p2.constant = p2.normal.dot( v2 );

	}

	return target;

}

function boxIntersectsObb( bounds, obbPlanes, obbPoints ) {

	// check if obb points fall on either side
	// of the planes
	const min = bounds.min;
	const max = bounds.max;
	for ( let i = 0; i < 3; i ++ ) {

		const field = xyzFields[ i ];
		const val0 = obbPoints[ 0 ][ field ];
		const minVal = min[ field ];
		const maxVal = max[ field ];
		let sideMin = val0 > minVal;
		let sideMax = val0 < maxVal;
		for ( let i = 1; i < 8; i ++ ) {

			const val = obbPoints[ i ][ field ];
			const obbSideMin = val > minVal;
			const obbSideMax = val < maxVal;
			if ( sideMin !== obbSideMin || sideMax !== obbSideMax ) {

				return true;

			}

		}

		// inside box
		if ( sideMin === sideMax ) {

			return true;

		}

	}

	// check if bounds intersect obb planes
	for ( let i = 0, l = obbPlanes.length; i < l; i ++ ) {

		if ( bounds.intersectsPlane( obbPlanes[ i ] ) ) {

			return true;

		}

	}

	return false;

}

const A = new Vector3();
const B = new Vector3();
const C = new Vector3();
const P = new Vector3();
const BmA = new Vector3();
const CmA = new Vector3();
const V = new Vector3();

const AB = new Vector3();
const BC = new Vector3();
const CA = new Vector3();

const Q1 = new Vector3();
const Q2 = new Vector3();
const Q3 = new Vector3();
const QA = new Vector3();
const QB = new Vector3();
const QC = new Vector3();
function sphereItersectTriangle( sphere, triangle ) {

	// http://realtimecollisiondetection.net/blog/?p=103

	P.copy( sphere.center );
	A.copy( triangle.a );
	B.copy( triangle.b );
	C.copy( triangle.c );
	const r = sphere.radius;

	// A = A - P
	// B = B - P
	// C = C - P
	A.sub( P );
	B.sub( P );
	C.sub( P );

	// rr = r * r
	const rr = r * r;

	// V = cross(B - A, C - A)
	BmA.subVectors( B, A );
	CmA.subVectors( C, A );
	V.crossVectors( BmA, CmA );

	// d = dot(A, V)
	// e = dot(V, V)
	const d = A.dot( V );
	const e = V.dot( V );

	// sep1 = d * d > rr * e
	// aa = dot(A, A)
	// ab = dot(A, B)
	// ac = dot(A, C)
	// bb = dot(B, B)
	// bc = dot(B, C)
	// cc = dot(C, C)
	const sep1 = d * d > rr * e;
	const aa = A.dot( A );
	const ab = A.dot( B );
	const ac = A.dot( C );
	const bb = B.dot( B );
	const bc = B.dot( C );
	const cc = C.dot( C );

	// sep2 = (aa > rr) & (ab > aa) & (ac > aa)
	// sep3 = (bb > rr) & (ab > bb) & (bc > bb)
	// sep4 = (cc > rr) & (ac > cc) & (bc > cc)
	const sep2 = ( aa > rr ) && ( ab > aa ) && ( ac > aa );
	const sep3 = ( bb > rr ) && ( ab > bb ) && ( bc > bb );
	const sep4 = ( cc > rr ) && ( ac > cc ) && ( bc > cc );

	// AB = B - A
	// BC = C - B
	// CA = A - C
	AB.subVectors( B, A );
	BC.subVectors( C, B );
	CA.subVectors( A, C );

	// d1 = ab - aa
	// d2 = bc - bb
	// d3 = ac - cc
	// e1 = dot(AB, AB)
	// e2 = dot(BC, BC)
	// e3 = dot(CA, CA)
	const d1 = ab - aa;
	const d2 = bc - bb;
	const d3 = ac - cc;
	const e1 = AB.dot( AB );
	const e2 = BC.dot( BC );
	const e3 = CA.dot( CA );

	// Q1 = A * e1 - d1 * AB
	AB.multiplyScalar( d1 );
	Q1.copy( A ).multiplyScalar( e1 ).sub( AB );

	// Q2 = B * e2 - d2 * BC
	BC.multiplyScalar( d2 );
	Q2.copy( B ).multiplyScalar( e2 ).sub( BC );

	// Q3 = C * e3 - d3 * CA
	CA.multiplyScalar( d3 );
	Q3.copy( C ).multiplyScalar( e3 ).sub( CA );

	// QC = C * e1 - Q1
	QC.copy( C ).multiplyScalar( e1 ).sub( Q1 );

	// QA = A * e2 - Q2
	QA.copy( A ).multiplyScalar( e2 ).sub( Q2 );

	// QB = B * e3 - Q3
	QB.copy( B ).multiplyScalar( e1 ).sub( Q3 );

	// sep5 = [dot(Q1, Q1) > rr * e1 * e1] & [dot(Q1, QC) > 0]
	// sep6 = [dot(Q2, Q2) > rr * e2 * e2] & [dot(Q2, QA) > 0]
	// sep7 = [dot(Q3, Q3) > rr * e3 * e3] & [dot(Q3, QB) > 0]
	const sep5 = ( Q1.dot( Q1 ) > rr * e1 * e1 ) && ( Q1.dot( QC ) > 0 );
	const sep6 = ( Q2.dot( Q2 ) > rr * e2 * e2 ) && ( Q2.dot( QA ) > 0 );
	const sep7 = ( Q3.dot( Q3 ) > rr * e3 * e3 ) && ( Q3.dot( QB ) > 0 );
	return sep1 || sep2 || sep3 || sep4 || sep5 || sep6 || sep7;

}

function triangleIntersectsTriangle( triA, triB ) {

	throw new Error( 'Not Implemented' );

}

export {
	boundsToArray, arrayToBox, getLongestEdgeIndex, boxToObbPoints,
	boxToObbPlanes, boxIntersectsObb, sphereItersectTriangle,
	triangleIntersectsTriangle
};
