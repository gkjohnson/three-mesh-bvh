import { Box3 } from 'three';
import { PRIMITIVE_INTERSECT_COST, TRAVERSAL_COST } from '../core/Constants.js';
import { arrayToBox } from '../utils/ArrayBoxUtilities.js';
import { isSharedArrayBufferSupported } from '../utils/BufferUtils.js';

const _box1 = /* @__PURE__ */ new Box3();
const _box2 = /* @__PURE__ */ new Box3();

// https://stackoverflow.com/questions/1248302/how-to-get-the-size-of-a-javascript-object
function getElementSize( el ) {

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
		primitives: {
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

			result.primitives.min = Math.min( count, result.primitives.min );
			result.primitives.max = Math.max( count, result.primitives.max );

			result.surfaceAreaScore += surfaceArea * PRIMITIVE_INTERSECT_COST * count;

		} else {

			result.splits[ offsetOrSplit ] ++;

			result.surfaceAreaScore += surfaceArea * TRAVERSAL_COST;

		}

	}, group );

	// If there are no leaf nodes because the tree hasn't finished generating yet.
	if ( result.primitives.min === Infinity ) {

		result.primitives.min = 0;
		result.primitives.max = 0;

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

			if ( ! Object.hasOwn( curr, key ) ) {

				continue;

			}

			bytes += getElementSize( key );

			const value = curr[ key ];
			if ( value && ( typeof value === 'object' || typeof value === 'function' ) ) {

				if ( isTypedArray( value ) ) {

					bytes += value.byteLength;

				} else if ( isSharedArrayBufferSupported() && value instanceof SharedArrayBuffer ) {

					bytes += value.byteLength;

				} else if ( value instanceof ArrayBuffer ) {

					bytes += value.byteLength;

				} else {

					stack.push( value );

				}

			} else {

				bytes += getElementSize( value );

			}


		}

	}

	return bytes;

}

function validateBounds( bvh ) {

	const depthStack = [];
	const tempBuffer = new Float32Array( 6 );
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

		arrayToBox( 0, boundingData, _box1 );
		const parent = depthStack[ depth - 1 ];

		if ( isLeaf ) {

			// Compute the actual bounds of the primitives in this leaf
			bvh.writePrimitiveRangeBounds( offset, count, tempBuffer, 0 );

			// tempBuffer is in min/max format [minx, miny, minz, maxx, maxy, maxz]
			_box2.min.set( tempBuffer[ 0 ], tempBuffer[ 1 ], tempBuffer[ 2 ] );
			_box2.max.set( tempBuffer[ 3 ], tempBuffer[ 4 ], tempBuffer[ 5 ] );

			// Check if the stored bounds contain the actual primitive bounds
			const isContained = _box1.containsBox( _box2 );
			console.assert( isContained, 'Leaf bounds does not fully contain primitives.' );
			passes = passes && isContained;

		}

		if ( parent ) {

			// check if my bounds fit in my parents
			arrayToBox( 0, parent.boundingData, _box2 );

			const isContained = _box2.containsBox( _box1 );
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
			bounds: arrayToBox( 0, boundingData, new Box3() ),
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
