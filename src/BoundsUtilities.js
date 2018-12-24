import { Plane, Vector3 } from 'three';

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

function boxToObbPoints(bounds, matrix, target) {

	const min = bounds.min;
	const max = bounds.max;
	for (let x = 0; x <= 1; x ++ ) {
		
		for (let y = 0; y <= 1; y ++ ) {
		
			for (let z = 0; z <= 1; z ++ ) {

				const i = ( 1 << (x + y + z) ) - 1;
				const v = target[ i ];
				v.x = min.x * x + max.x * (1 - x);
				v.y = min.y * x + max.y * (1 - y);
				v.z = min.z * x + max.z * (1 - z);

				v.applyMatrix4( matrix );

			}
		
		}
	
	}

	return target;

}

const xyzFields = [ 'x', 'y', 'z' ];
const v1 = new Vector3();
const v2 = new Vector3();
function boxToObbPlanes(bounds, matrix, target) {

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

		p1.normal.subVectors(v1, v2);
		p1.constant = p1.normal.dot( v1 );

		p2.normal.subVectors(v1, v2);
		p2.constant = p2.normal.dot( v2 );

	}

	return target;

}

function boxIntersectsObb(bounds, obbPlanes, obbPoints) {

	// check if obb points fall on either side
	// of the planes
	const min = bounds.min;
	const max = bounds.max;
	for( let i = 0; i < 3 ; i ++ ) {

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
	for( let i = 0, l = obbPlanes.length; i < l; i ++ ) {

		if ( bounds.intersectsPlane( obbPlanes[ i ] ) ) {

			return true;

		}

	}

	return false;

}

export { boundsToArray, arrayToBox, getLongestEdgeIndex, boxToObbPoints, boxIntersectsObb };
