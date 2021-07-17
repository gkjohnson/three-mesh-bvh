// For speed and readability this script is processed to replace the macro-like calls
// with inline buffer reads. See generate-cast-functions.js.
import { Box3, Vector3 } from 'three';
import { intersectTris, intersectClosestTri } from './Utils/RayIntersectTriUtlities.js';
import { arrayToBox } from './Utils/BufferNodeUtils.js';
import { CONTAINED } from './Constants.js';

const boundingBox = new Box3();
const boxIntersection = new Vector3();
const xyzFields = [ 'x', 'y', 'z' ];

function IS_LEAF( n16, uint16Array ) {

	return uint16Array[ n16 + 15 ] === 0xFFFF;

}

function OFFSET( n32, uint32Array ) {

	return uint32Array[ n32 + 6 ];

}

function COUNT( n32, uint16Array ) {

	return uint16Array[ n32 + 14 ];

}

function LEFT_NODE( n32 ) {

	return n32 + 8;

}

function RIGHT_NODE( n32, uint32Array ) {

	return uint32Array[ n32 + 6 ];

}

function SPLIT_AXIS( n32, uint32Array ) {

	return uint32Array[ n32 + 7 ];

}

function BOUNDING_DATA_INDEX( n32 ) {

	return n32;

}

export function raycast( nodeIndex32, mesh, geometry, raycaster, ray, intersects ) {

	let nodeIndex16 = nodeIndex32 * 2, float32Array = _float32Array, uint16Array = _uint16Array, uint32Array = _uint32Array;

	const isLeaf = IS_LEAF( nodeIndex16, uint16Array );
	if ( isLeaf ) {

		const offset = OFFSET( nodeIndex32, uint32Array );
		const count = COUNT( nodeIndex16, uint16Array );

		intersectTris( mesh, geometry, raycaster, ray, offset, count, intersects );

	} else {

		const leftIndex = LEFT_NODE( nodeIndex32 );
		if ( intersectRay( leftIndex, float32Array, ray, boxIntersection ) ) {

			raycast( leftIndex, mesh, geometry, raycaster, ray, intersects );

		}

		const rightIndex = RIGHT_NODE( nodeIndex32, uint32Array );
		if ( intersectRay( rightIndex, float32Array, ray, boxIntersection ) ) {

			raycast( rightIndex, mesh, geometry, raycaster, ray, intersects );

		}

	}

}

export function raycastFirst( nodeIndex32, mesh, geometry, raycaster, ray ) {

	let nodeIndex16 = nodeIndex32 * 2, float32Array = _float32Array, uint16Array = _uint16Array, uint32Array = _uint32Array;

	const isLeaf = IS_LEAF( nodeIndex16, uint16Array );
	if ( isLeaf ) {

		const offset = OFFSET( nodeIndex32, uint32Array );
		const count = COUNT( nodeIndex16, uint16Array );
		return intersectClosestTri( mesh, geometry, raycaster, ray, offset, count );

	} else {

		// consider the position of the split plane with respect to the oncoming ray; whichever direction
		// the ray is coming from, look for an intersection among that side of the tree first
		const splitAxis = SPLIT_AXIS( nodeIndex32, uint32Array );
		const xyzAxis = xyzFields[ splitAxis ];
		const rayDir = ray.direction[ xyzAxis ];
		const leftToRight = rayDir >= 0;

		// c1 is the child to check first
		let c1, c2;
		if ( leftToRight ) {

			c1 = LEFT_NODE( nodeIndex32 );
			c2 = RIGHT_NODE( nodeIndex32, uint32Array );

		} else {

			c1 = RIGHT_NODE( nodeIndex32, uint32Array );
			c2 = LEFT_NODE( nodeIndex32 );

		}

		const c1Intersection = intersectRay( c1, float32Array, ray, boxIntersection );
		const c1Result = c1Intersection ? raycastFirst( c1, mesh, geometry, raycaster, ray ) : null;

		// if we got an intersection in the first node and it's closer than the second node's bounding
		// box, we don't need to consider the second node because it couldn't possibly be a better result
		if ( c1Result ) {

			// check if the point is within the second bounds
			const point = c1Result.point[ xyzAxis ];
			const isOutside = leftToRight ?
				point <= float32Array[ c2 + splitAxis ] : // min bounding data
				point >= float32Array[ c2 + splitAxis + 3 ]; // max bounding data

			if ( isOutside ) {

				return c1Result;

			}

		}

		// either there was no intersection in the first node, or there could still be a closer
		// intersection in the second, so check the second node and then take the better of the two
		const c2Intersection = intersectRay( c2, float32Array, ray, boxIntersection );
		const c2Result = c2Intersection ? raycastFirst( c2, mesh, geometry, raycaster, ray ) : null;

		if ( c1Result && c2Result ) {

			return c1Result.distance <= c2Result.distance ? c1Result : c2Result;

		} else {

			return c1Result || c2Result || null;

		}

	}

}

export const bvhcast = ( function () {

	const _boxLeft1 = new Box3();
	const _boxRight1 = new Box3();
	const _boxLeft2 = new Box3();
	const _boxRight2 = new Box3();
	const _box1 = new Box3();
	const _box2 = new Box3();
	const _vector = new Vector3();

	return function bvhcast(
		// current parent node status
		node1Index32,
		node2Index32,

		// function taking two bounds and otherwise taking the same arguments as the shapecast variant
		// returning what kind of intersection if any the two bounds have.
		intersectsBoundsFunc,

		// function taking the triangle ranges of both intersecting leaf bounds as well as the bounds themselves.
		// returns the same types of values the the shapecast variant can.
		intersectsRangeFunc,

		// function that takes two bounds and return a score indicating the run order (lowest first)
		nodeScoreFunc = null,

		// node index and depth identifiers
		node1IndexByteOffset = 0,
		depth1 = 0,

		node2IndexByteOffset = 0,
		depth2 = 0,
	) {

		const float32Array1 = _float32Array, uint16Array1 = _uint16Array, uint32Array1 = _uint32Array;
		const float32Array2 = _float32Array2, uint16Array2 = _uint16Array2, uint32Array2 = _uint32Array2;

		const isLeaf1 = IS_LEAF( node1Index32 * 2, uint16Array1 );
		const isLeaf2 = IS_LEAF( node2Index32 * 2, uint16Array2 );
		if ( isLeaf1 && isLeaf2 ) {

			// TODO: we know that children are leaves before calling this function again meaning we
			// could just check triangle range callback in the previous call (below two conditions)
			// and not have to read bounding data again.

			// intersect triangles
			return intersectsRangeFunc(
				OFFSET( node1Index32, uint32Array1 ), COUNT( node1Index32, uint16Array1 ),
				OFFSET( node2Index32, uint32Array2 ), COUNT( node2Index32, uint16Array2 ),
				depth1, node1IndexByteOffset + node1Index32,
				depth2, node2IndexByteOffset + node2Index32,
			);

		}

		arrayToBox( BOUNDING_DATA_INDEX( node1Index32 ), float32Array1, _box1 );
		arrayToBox( BOUNDING_DATA_INDEX( node2Index32 ), float32Array2, _box2 );

		let breakLeaf1 = false;
		if ( ! isLeaf2 && ! isLeaf1 ) {

			let volume1, volume2;
			_box1.getSize( _vector );
			volume1 = _vector.x * _vector.y * _vector.z;

			_box2.getSize( _vector );
			volume2 = _vector.x * _vector.y * _vector.z;

			breakLeaf1 = volume1 > volume2;

		} else {

			breakLeaf1 = isLeaf2;

		}

		let n1Depth = depth1;
		let n2Depth = depth2;
		let node1Child1 = node1Index32;
		let node1Child2 = node1Index32;
		let node2Child1 = node2Index32;
		let node2Child2 = node2Index32;
		let score1 = 0;
		let score2 = 0;
		let stopTraversal;

		if ( breakLeaf1 ) {

			node1Child1 = LEFT_NODE( node1Index32 );
			node1Child2 = RIGHT_NODE( node1Index32, uint32Array1 );
			n1Depth += 1;
			if ( nodeScoreFunc ) {

				arrayToBox( BOUNDING_DATA_INDEX( node1Child1 ), float32Array1, _boxLeft1 );
				arrayToBox( BOUNDING_DATA_INDEX( node1Child2 ), float32Array1, _boxRight1 );

				score1 = nodeScoreFunc( _boxLeft1, _box2 );
				score2 = nodeScoreFunc( _boxRight1, _box2 );

				if ( score2 < score1 ) {

					[ node1Child2, node1Child1 ] = [ node1Child1, node1Child2 ];
					[ score2, score1 ] = [ score1, score2 ];

				}

			}

		} else {

			node2Child1 = LEFT_NODE( node2Index32 );
			node2Child2 = RIGHT_NODE( node2Index32, uint32Array2 );
			n2Depth += 1;
			if ( nodeScoreFunc ) {

				arrayToBox( BOUNDING_DATA_INDEX( node2Child1 ), float32Array2, _boxLeft2 );
				arrayToBox( BOUNDING_DATA_INDEX( node2Child2 ), float32Array2, _boxRight2 );

				score1 = nodeScoreFunc( _box1, _boxLeft2 );
				score2 = nodeScoreFunc( _box1, _boxRight2 );

				if ( score2 < score1 ) {

					[ node2Child2, node2Child1 ] = [ node2Child1, node2Child2 ];
					[ score2, score1 ] = [ score1, score2 ];

				}

			}

		}

		// test first set
		arrayToBox( BOUNDING_DATA_INDEX( node1Child1 ), float32Array1, _box1 );
		arrayToBox( BOUNDING_DATA_INDEX( node2Child1 ), float32Array2, _box2 );

		stopTraversal =
			intersectsBoundsFunc(
				_box1, _box2, score1,

				IS_LEAF( node1Child1 * 2, uint16Array1 ), n1Depth, node1IndexByteOffset + node1Child1,
				IS_LEAF( node2Child1 * 2, uint16Array2 ), n2Depth, node2IndexByteOffset + node2Child1,

			) && bvhcast(
				node1Child1, node2Child1,
				intersectsBoundsFunc, intersectsRangeFunc, nodeScoreFunc,

				// depth and offsets
				node1IndexByteOffset, n1Depth,
				node2IndexByteOffset, n2Depth,
			);

		if ( stopTraversal ) {

			return true;

		}

		// test second set
		arrayToBox( BOUNDING_DATA_INDEX( node1Child2 ), float32Array1, _box1 );
		arrayToBox( BOUNDING_DATA_INDEX( node2Child2 ), float32Array2, _box2 );

		stopTraversal =
			intersectsBoundsFunc(
				_box1, _box2, score2,

				IS_LEAF( node1Child2 * 2, uint16Array1 ), n1Depth, node1IndexByteOffset + node1Child2,
				IS_LEAF( node2Child2 * 2, uint16Array2 ), n2Depth, node2IndexByteOffset + node2Child2,

			) && bvhcast(
				// node indices
				node1Child2, node2Child2,

				// functions
				intersectsBoundsFunc, intersectsRangeFunc, nodeScoreFunc,

				// depth and offsets
				node1IndexByteOffset, n1Depth,
				node2IndexByteOffset, n2Depth,
			);

		if ( stopTraversal ) {

			return true;

		}

		return false;

	};

} )();

export const shapecast = ( function () {

	const _box1 = new Box3();
	const _box2 = new Box3();

	return function shapecast(
		nodeIndex32,
		intersectsBoundsFunc,
		intersectsRangeFunc,
		nodeScoreFunc = null,
		nodeIndexByteOffset = 0, // offset for unique node identifier
		depth = 0
	) {

		// Define these inside the function so it has access to the local variables needed
		// when converting to the buffer equivalents
		function getLeftOffset( nodeIndex32 ) {

			let nodeIndex16 = nodeIndex32 * 2, uint16Array = _uint16Array, uint32Array = _uint32Array;

			// traverse until we find a leaf
			while ( ! IS_LEAF( nodeIndex16, uint16Array ) ) {

				nodeIndex32 = LEFT_NODE( nodeIndex32 );
				nodeIndex16 = nodeIndex32 * 2;

			}

			return OFFSET( nodeIndex32, uint32Array );

		}

		function getRightEndOffset( nodeIndex32 ) {

			let nodeIndex16 = nodeIndex32 * 2, uint16Array = _uint16Array, uint32Array = _uint32Array;

			// traverse until we find a leaf
			while ( ! IS_LEAF( nodeIndex16, uint16Array ) ) {

				// adjust offset to point to the right node
				nodeIndex32 = RIGHT_NODE( nodeIndex32, uint32Array );
				nodeIndex16 = nodeIndex32 * 2;

			}

			// return the end offset of the triangle range
			return OFFSET( nodeIndex32, uint32Array ) + COUNT( nodeIndex16, uint16Array );

		}

		let nodeIndex16 = nodeIndex32 * 2, float32Array = _float32Array, uint16Array = _uint16Array, uint32Array = _uint32Array;

		const isLeaf = IS_LEAF( nodeIndex16, uint16Array );
		if ( isLeaf ) {

			const offset = OFFSET( nodeIndex32, uint32Array );
			const count = COUNT( nodeIndex16, uint16Array );

			// TODO: add tests for byte offsets?
			return intersectsRangeFunc( offset, count, false, depth, nodeIndexByteOffset + nodeIndex32 );

		} else {

			const left = LEFT_NODE( nodeIndex32 );
			const right = RIGHT_NODE( nodeIndex32, uint32Array );
			let c1 = left;
			let c2 = right;

			let score1, score2;
			let box1, box2;
			if ( nodeScoreFunc ) {

				box1 = _box1;
				box2 = _box2;

				// bounding data is not offset
				arrayToBox( BOUNDING_DATA_INDEX( c1 ), float32Array, box1 );
				arrayToBox( BOUNDING_DATA_INDEX( c2 ), float32Array, box2 );

				score1 = nodeScoreFunc( box1 );
				score2 = nodeScoreFunc( box2 );

				if ( score2 < score1 ) {

					c1 = right;
					c2 = left;

					const temp = score1;
					score1 = score2;
					score2 = temp;

					box1 = box2;
					// box2 is always set before use below

				}

			}

			// Check box 1 intersection
			if ( ! box1 ) {

				box1 = _box1;
				arrayToBox( BOUNDING_DATA_INDEX( c1 ), float32Array, box1 );

			}

			const isC1Leaf = IS_LEAF( c1 * 2, uint16Array );
			const c1Intersection = intersectsBoundsFunc( box1, isC1Leaf, score1, depth + 1, nodeIndexByteOffset + c1 );

			let c1StopTraversal;
			if ( c1Intersection === CONTAINED ) {

				const offset = getLeftOffset( c1 );
				const end = getRightEndOffset( c1 );
				const count = end - offset;

				c1StopTraversal = intersectsRangeFunc( offset, count, true, depth + 1, nodeIndexByteOffset + c1 );

			} else {

				c1StopTraversal =
					c1Intersection &&
					shapecast(
						c1,
						intersectsBoundsFunc,
						intersectsRangeFunc,
						nodeScoreFunc,
						nodeIndexByteOffset,
						depth + 1
					);

			}

			if ( c1StopTraversal ) return true;

			// Check box 2 intersection
			// cached box2 will have been overwritten by previous traversal
			box2 = _box2;
			arrayToBox( BOUNDING_DATA_INDEX( c2 ), float32Array, box2 );

			const isC2Leaf = IS_LEAF( c2 * 2, uint16Array );
			const c2Intersection = intersectsBoundsFunc( box2, isC2Leaf, score2, depth + 1, nodeIndexByteOffset + c2 );

			let c2StopTraversal;
			if ( c2Intersection === CONTAINED ) {

				const offset = getLeftOffset( c2 );
				const end = getRightEndOffset( c2 );
				const count = end - offset;

				c2StopTraversal = intersectsRangeFunc( offset, count, true, depth + 1, nodeIndexByteOffset + c2 );

			} else {

				c2StopTraversal =
					c2Intersection &&
					shapecast(
						c2,
						intersectsBoundsFunc,
						intersectsRangeFunc,
						nodeScoreFunc,
						nodeIndexByteOffset,
						depth + 1
					);

			}

			if ( c2StopTraversal ) return true;

			return false;

		}

	};

} )();

function intersectRay( nodeIndex32, array, ray, target ) {

	arrayToBox( nodeIndex32, array, boundingBox );
	return ray.intersectBox( boundingBox, target );

}

const bufferStack = [];
let _prevBuffer;
let _float32Array;
let _uint16Array;
let _uint32Array;
export function setBuffer( buffer ) {

	if ( _prevBuffer ) {

		bufferStack.push( _prevBuffer );

	}

	_prevBuffer = buffer;
	_float32Array = new Float32Array( buffer );
	_uint16Array = new Uint16Array( buffer );
	_uint32Array = new Uint32Array( buffer );

}

export function clearBuffer() {

	_prevBuffer = null;
	_float32Array = null;
	_uint16Array = null;
	_uint32Array = null;

	if ( bufferStack.length ) {

		setBuffer( bufferStack.pop() );

	}

}

const bufferStack2 = [];
let _prevBuffer2;
let _float32Array2;
let _uint16Array2;
let _uint32Array2;

export function setBuffer2( buffer ) {

	if ( _prevBuffer2 ) {

		bufferStack2.push( _prevBuffer2 );

	}

	_prevBuffer2 = buffer;
	_float32Array2 = new Float32Array( buffer );
	_uint16Array2 = new Uint16Array( buffer );
	_uint32Array2 = new Uint32Array( buffer );

}

export function clearBuffer2() {

	_prevBuffer2 = null;
	_float32Array2 = null;
	_uint16Array2 = null;
	_uint32Array2 = null;

	if ( bufferStack2.length ) {

		setBuffer( bufferStack2.pop() );

	}

}
