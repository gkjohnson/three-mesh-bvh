import { CONTAINED } from '../Constants.js';
import { COUNT, OFFSET, LEFT_NODE, RIGHT_NODE, IS_LEAF, BOUNDING_DATA_INDEX } from '../utils/nodeBufferUtils.js';
import { BufferStack } from '../utils/BufferStack.js';

const boundsArray = /* @__PURE__ */ new Float32Array( 6 );

export function shapecast( bvh, root, intersectsBounds, intersectsRange, boundsTraverseOrder, byteOffset ) {

	BufferStack.setBuffer( bvh._roots[ root ] );
	const result = shapecastTraverse( 0, bvh.geometry, intersectsBounds, intersectsRange, boundsTraverseOrder, byteOffset, 0 );
	BufferStack.clearBuffer();

	return result;

}

function shapecastTraverse(
	nodeIndex32,
	geometry,
	intersectsBoundsFunc,
	intersectsRangeFunc,
	nodeScoreFunc = null,
	nodeIndexByteOffset = 0, // offset for unique node identifier
	depth = 0
) {

	const { float32Array, uint16Array, uint32Array } = BufferStack;
	let nodeIndex16 = nodeIndex32 * 2;

	const isLeaf = IS_LEAF( nodeIndex16, uint16Array );
	if ( isLeaf ) {

		const offset = OFFSET( nodeIndex32, uint32Array );
		const count = COUNT( nodeIndex16, uint16Array );
		const boundsIndex = BOUNDING_DATA_INDEX( nodeIndex32 );

		// Copy bounds to the shared array
		boundsArray[ 0 ] = float32Array[ boundsIndex ];
		boundsArray[ 1 ] = float32Array[ boundsIndex + 1 ];
		boundsArray[ 2 ] = float32Array[ boundsIndex + 2 ];
		boundsArray[ 3 ] = float32Array[ boundsIndex + 3 ];
		boundsArray[ 4 ] = float32Array[ boundsIndex + 4 ];
		boundsArray[ 5 ] = float32Array[ boundsIndex + 5 ];

		return intersectsRangeFunc( offset, count, false, depth, nodeIndexByteOffset + nodeIndex32, boundsArray );

	} else {

		const left = LEFT_NODE( nodeIndex32 );
		const right = RIGHT_NODE( nodeIndex32, uint32Array );
		let c1 = left;
		let c2 = right;

		let score1, score2;
		let boundsIndex1, boundsIndex2;

		if ( nodeScoreFunc ) {

			boundsIndex1 = BOUNDING_DATA_INDEX( c1 );
			boundsIndex2 = BOUNDING_DATA_INDEX( c2 );

			// Copy c1 bounds
			boundsArray[ 0 ] = float32Array[ boundsIndex1 ];
			boundsArray[ 1 ] = float32Array[ boundsIndex1 + 1 ];
			boundsArray[ 2 ] = float32Array[ boundsIndex1 + 2 ];
			boundsArray[ 3 ] = float32Array[ boundsIndex1 + 3 ];
			boundsArray[ 4 ] = float32Array[ boundsIndex1 + 4 ];
			boundsArray[ 5 ] = float32Array[ boundsIndex1 + 5 ];

			score1 = nodeScoreFunc( boundsArray );

			// Copy c2 bounds
			boundsArray[ 0 ] = float32Array[ boundsIndex2 ];
			boundsArray[ 1 ] = float32Array[ boundsIndex2 + 1 ];
			boundsArray[ 2 ] = float32Array[ boundsIndex2 + 2 ];
			boundsArray[ 3 ] = float32Array[ boundsIndex2 + 3 ];
			boundsArray[ 4 ] = float32Array[ boundsIndex2 + 4 ];
			boundsArray[ 5 ] = float32Array[ boundsIndex2 + 5 ];

			score2 = nodeScoreFunc( boundsArray );

			if ( score2 < score1 ) {

				c1 = right;
				c2 = left;

				const temp = score1;
				score1 = score2;
				score2 = temp;

				const tempIndex = boundsIndex1;
				boundsIndex1 = boundsIndex2;
				boundsIndex2 = tempIndex;

			}

		}

		// Check box 1 intersection
		const isC1Leaf = IS_LEAF( c1 * 2, uint16Array );
		let c1Intersection;

		if ( boundsIndex1 === undefined ) {

			boundsIndex1 = BOUNDING_DATA_INDEX( c1 );

		}

		// Copy c1 bounds
		boundsArray[ 0 ] = float32Array[ boundsIndex1 ];
		boundsArray[ 1 ] = float32Array[ boundsIndex1 + 1 ];
		boundsArray[ 2 ] = float32Array[ boundsIndex1 + 2 ];
		boundsArray[ 3 ] = float32Array[ boundsIndex1 + 3 ];
		boundsArray[ 4 ] = float32Array[ boundsIndex1 + 4 ];
		boundsArray[ 5 ] = float32Array[ boundsIndex1 + 5 ];

		c1Intersection = intersectsBoundsFunc( boundsArray, isC1Leaf, score1, depth + 1, nodeIndexByteOffset + c1 );

		let c1StopTraversal;
		if ( c1Intersection === CONTAINED ) {

			const offset = getLeftOffset( c1 );
			const end = getRightEndOffset( c1 );
			const count = end - offset;

			c1StopTraversal = intersectsRangeFunc( offset, count, true, depth + 1, nodeIndexByteOffset + c1, boundsArray );

		} else {

			c1StopTraversal =
				c1Intersection &&
				shapecastTraverse(
					c1,
					geometry,
					intersectsBoundsFunc,
					intersectsRangeFunc,
					nodeScoreFunc,
					nodeIndexByteOffset,
					depth + 1
				);

		}

		if ( c1StopTraversal ) return true;

		// Check box 2 intersection
		const isC2Leaf = IS_LEAF( c2 * 2, uint16Array );
		let c2Intersection;

		if ( boundsIndex2 === undefined ) {

			boundsIndex2 = BOUNDING_DATA_INDEX( c2 );

		}

		// Copy c2 bounds
		boundsArray[ 0 ] = float32Array[ boundsIndex2 ];
		boundsArray[ 1 ] = float32Array[ boundsIndex2 + 1 ];
		boundsArray[ 2 ] = float32Array[ boundsIndex2 + 2 ];
		boundsArray[ 3 ] = float32Array[ boundsIndex2 + 3 ];
		boundsArray[ 4 ] = float32Array[ boundsIndex2 + 4 ];
		boundsArray[ 5 ] = float32Array[ boundsIndex2 + 5 ];

		c2Intersection = intersectsBoundsFunc( boundsArray, isC2Leaf, score2, depth + 1, nodeIndexByteOffset + c2 );

		let c2StopTraversal;
		if ( c2Intersection === CONTAINED ) {

			const offset = getLeftOffset( c2 );
			const end = getRightEndOffset( c2 );
			const count = end - offset;

			c2StopTraversal = intersectsRangeFunc( offset, count, true, depth + 1, nodeIndexByteOffset + c2, boundsArray );

		} else {

			c2StopTraversal =
				c2Intersection &&
				shapecastTraverse(
					c2,
					geometry,
					intersectsBoundsFunc,
					intersectsRangeFunc,
					nodeScoreFunc,
					nodeIndexByteOffset,
					depth + 1
				);

		}

		if ( c2StopTraversal ) return true;

		return false;

		// Define these inside the function so it has access to the local variables needed
		// when converting to the buffer equivalents
		function getLeftOffset( nodeIndex32 ) {

			const { uint16Array, uint32Array } = BufferStack;
			let nodeIndex16 = nodeIndex32 * 2;

			// traverse until we find a leaf
			while ( ! IS_LEAF( nodeIndex16, uint16Array ) ) {

				nodeIndex32 = LEFT_NODE( nodeIndex32 );
				nodeIndex16 = nodeIndex32 * 2;

			}

			return OFFSET( nodeIndex32, uint32Array );

		}

		function getRightEndOffset( nodeIndex32 ) {

			const { uint16Array, uint32Array } = BufferStack;
			let nodeIndex16 = nodeIndex32 * 2;

			// traverse until we find a leaf
			while ( ! IS_LEAF( nodeIndex16, uint16Array ) ) {

				// adjust offset to point to the right node
				nodeIndex32 = RIGHT_NODE( nodeIndex32, uint32Array );
				nodeIndex16 = nodeIndex32 * 2;

			}

			// return the end offset of the triangle range
			return OFFSET( nodeIndex32, uint32Array ) + COUNT( nodeIndex16, uint16Array );

		}

	}

}
