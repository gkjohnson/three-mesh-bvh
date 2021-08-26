import { TRAVERSAL_COST, TRIANGLE_INTERSECT_COST } from '../Constants.js';
import { arrayToBox } from './ArrayBoxUtilities.js';
import { Box3, Vector3 } from 'three';

// https://stackoverflow.com/questions/1248302/how-to-get-the-size-of-a-javascript-object
function getPrimitiveSize( el ) {

	switch ( typeof el ) {

		case 'number':
			return 8;
		case 'string':
			return el.length * 2;
		case 'boolean':
			return 4;
		default:
			return 0;

	}

}

function isTypedArray( arr ) {

	const regex = /(Uint|Int|Float)(8|16|32)Array/;
	return regex.test( arr.constructor.name );

}

function getRootExtremes( bvh, group ) {

	const result = {
		nodeCount: 0,
		leafNodeCount: 0,

		depth: {
			min: Infinity, max: - Infinity
		},
		tris: {
			min: Infinity, max: - Infinity
		},
		splits: [ 0, 0, 0 ],
		surfaceAreaScore: 0,
	};

	bvh.traverse( ( depth, isLeaf, boundingData, offsetOrSplit, count ) => {

		const l0 = boundingData[ 0 + 3 ] - boundingData[ 0 ];
		const l1 = boundingData[ 1 + 3 ] - boundingData[ 1 ];
		const l2 = boundingData[ 2 + 3 ] - boundingData[ 2 ];

		const surfaceArea = 2 * ( l0 * l1 + l1 * l2 + l2 * l0 );

		result.nodeCount ++;
		if ( isLeaf ) {

			result.leafNodeCount ++;

			result.depth.min = Math.min( depth, result.depth.min );
			result.depth.max = Math.max( depth, result.depth.max );

			result.tris.min = Math.min( count, result.tris.min );
			result.tris.max = Math.max( count, result.tris.max );

			result.surfaceAreaScore += surfaceArea * TRIANGLE_INTERSECT_COST * count;

		} else {

			result.splits[ offsetOrSplit ] ++;

			result.surfaceAreaScore += surfaceArea * TRAVERSAL_COST;

		}

	}, group );

	// If there are no leaf nodes because the tree hasn't finished generating yet.
	if ( result.tris.min === Infinity ) {

		result.tris.min = 0;
		result.tris.max = 0;

	}

	if ( result.depth.min === Infinity ) {

		result.depth.min = 0;
		result.depth.max = 0;

	}

	return result;

}

function getBVHExtremes( bvh ) {

	return bvh._roots.map( ( root, i ) => getRootExtremes( bvh, i ) );

}

function estimateMemoryInBytes( obj ) {

	const traversed = new Set();
	const stack = [ obj ];
	let bytes = 0;

	while ( stack.length ) {

		const curr = stack.pop();
		if ( traversed.has( curr ) ) {

			continue;

		}

		traversed.add( curr );

		for ( let key in curr ) {

			if ( ! curr.hasOwnProperty( key ) ) {

				continue;

			}

			bytes += getPrimitiveSize( key );

			const value = curr[ key ];
			if ( value && ( typeof value === 'object' || typeof value === 'function' ) ) {

				if ( isTypedArray( value ) ) {

					bytes += value.byteLength;

				} else if ( value instanceof ArrayBuffer ) {

					bytes += value.byteLength;

				} else {

					stack.push( value );

				}

			} else {

				bytes += getPrimitiveSize( value );

			}


		}

	}

	return bytes;

}

const box1 = new Box3();
const box2 = new Box3();
const vec = new Vector3();

function validateBounds( bvh ) {

	const geometry = bvh.geometry;
	const depthStack = [];
	const index = geometry.index;
	const position = geometry.getAttribute( 'position' );
	let passes = true;

	bvh.traverse( ( depth, isLeaf, boundingData, offset, count ) => {

		const info = {
			depth,
			isLeaf,
			boundingData,
			offset,
			count,
		};
		depthStack[ depth ] = info;

		arrayToBox( boundingData, box1 );
		const parent = depthStack[ depth - 1 ];

		if ( isLeaf ) {

			// check triangles
			for ( let i = offset * 3, l = ( offset + count ) * 3; i < l; i += 3 ) {

				const i0 = index.getX( i );
				const i1 = index.getX( i + 1 );
				const i2 = index.getX( i + 2 );

				let isContained;

				vec.fromBufferAttribute( position, i0 );
				isContained = box1.containsPoint( vec );

				vec.fromBufferAttribute( position, i1 );
				isContained = isContained && box1.containsPoint( vec );

				vec.fromBufferAttribute( position, i2 );
				isContained = isContained && box1.containsPoint( vec );

				console.assert( isContained, 'Leaf bounds does not fully contain triangle.' );
				passes = passes && isContained;

			}

		}

		if ( parent ) {

			// check if my bounds fit in my parents
			arrayToBox( boundingData, box2 );

			const isContained = box2.containsBox( box1 );
			console.assert( isContained, 'Parent bounds does not fully contain child.' );
			passes = passes && isContained;

		}

	} );

	return passes;

}

// Returns a simple, human readable object that represents the BVH.
function getJSONStructure( bvh ) {

	const depthStack = [];

	bvh.traverse( ( depth, isLeaf, boundingData, offset, count ) => {

		const info = {
			bounds: arrayToBox( boundingData, new Box3() ),
		};

		if ( isLeaf ) {

			info.count = count;
			info.offset = offset;

		} else {

			info.left = null;
			info.right = null;

		}

		depthStack[ depth ] = info;

		// traversal hits the left then right node
		const parent = depthStack[ depth - 1 ];
		if ( parent ) {

			if ( parent.left === null ) {

				parent.left = info;

			} else {

				parent.right = info;

			}

		}

	} );

	return depthStack[ 0 ];

}

export { estimateMemoryInBytes, getBVHExtremes, validateBounds, getJSONStructure };
