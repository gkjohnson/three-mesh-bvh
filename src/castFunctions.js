/* Generated from "castFunctions.template.js". Do not edit. */
// For speed and readability this script is processed to replace the macro-like calls
// with inline buffer reads. See generate-cast-functions.js.
import { Box3, Vector3 } from 'three';
import { intersectTris, intersectClosestTri } from './Utils/RayIntersectTriUtlities.js';
import { arrayToBox } from './Utils/BufferNodeUtils.js';
import { CONTAINED } from './Constants.js';

const boundingBox = new Box3();
const boxIntersection = new Vector3();
const xyzFields = [ 'x', 'y', 'z' ];

export function raycast( nodeIndex32, mesh, geometry, raycaster, ray, intersects ) {

	let nodeIndex16 = nodeIndex32 * 2, float32Array = _float32Array, uint16Array = _uint16Array, uint32Array = _uint32Array;

	const isLeaf = ( uint16Array[ nodeIndex16 + 15 ] === 0xFFFF );
	if ( isLeaf ) {

		const offset = uint32Array[ nodeIndex32 + 6 ];
		const count = uint16Array[ nodeIndex16 + 14 ];

		intersectTris( mesh, geometry, raycaster, ray, offset, count, intersects );

	} else {

		const leftIndex = nodeIndex32 + 8;
		if ( intersectRay( leftIndex, float32Array, ray, boxIntersection ) ) {

			raycast( leftIndex, mesh, geometry, raycaster, ray, intersects );

		}

		const rightIndex = uint32Array[ nodeIndex32 + 6 ];
		if ( intersectRay( rightIndex, float32Array, ray, boxIntersection ) ) {

			raycast( rightIndex, mesh, geometry, raycaster, ray, intersects );

		}

	}

}

export function raycastFirst( nodeIndex32, mesh, geometry, raycaster, ray ) {

	let nodeIndex16 = nodeIndex32 * 2, float32Array = _float32Array, uint16Array = _uint16Array, uint32Array = _uint32Array;

	const isLeaf = ( uint16Array[ nodeIndex16 + 15 ] === 0xFFFF );
	if ( isLeaf ) {

		const offset = uint32Array[ nodeIndex32 + 6 ];
		const count = uint16Array[ nodeIndex16 + 14 ];
		return intersectClosestTri( mesh, geometry, raycaster, ray, offset, count );

	} else {

		// consider the position of the split plane with respect to the oncoming ray; whichever direction
		// the ray is coming from, look for an intersection among that side of the tree first
		const splitAxis = uint32Array[ nodeIndex32 + 7 ];
		const xyzAxis = xyzFields[ splitAxis ];
		const rayDir = ray.direction[ xyzAxis ];
		const leftToRight = rayDir >= 0;

		// c1 is the child to check first
		let c1, c2;
		if ( leftToRight ) {

			c1 = nodeIndex32 + 8;
			c2 = uint32Array[ nodeIndex32 + 6 ];

		} else {

			c1 = uint32Array[ nodeIndex32 + 6 ];
			c2 = nodeIndex32 + 8;

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

	let _sortArrIndex = 0;
	const _sortArrPool = [];
	const sortFunc = ( a, b ) => {

		return a.score - b.score;

	};

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

		const isLeaf1 = ( uint16Array1[ node1Index32 * 2 + 15 ] === 0xFFFF );
		const isLeaf2 = ( uint16Array2[ node2Index32 * 2 + 15 ] === 0xFFFF );

		if ( isLeaf1 && isLeaf2 ) {

			// TODO: we know that children are leaves before calling this function again meaning we
			// could just check triangle range callback in the previous call (below two conditions)
			// and not have to read bounding data again.

			// intersect triangles
			arrayToBox( node1Index32, float32Array1, _box1 );
			arrayToBox( node2Index32, float32Array2, _box2 );
			return intersectsRangeFunc(
				uint32Array1[ node1Index32 + 6 ], uint16Array1[ node1Index32 + 14 ],
				uint32Array2[ node2Index32 + 6 ], uint16Array2[ node2Index32 + 14 ],
				depth1, node1IndexByteOffset + node1Index32,
				depth2, node2IndexByteOffset + node2Index32,
			);

		} else if ( isLeaf1 || isLeaf2 ) {

			// Assume that bvh 1 node is the leaf first
			let leafNodeIndex32 = node1Index32;
			let leafUint16Array = uint16Array1;
			let leafUint32Array = uint32Array1;
			let leafFloat32Array = float32Array1;
			let leafByteOffset = node1IndexByteOffset;
			let leafDepth = depth1;

			let otherNodeIndex32 = node2Index32;
			let otherUint16Array = uint16Array2;
			let otherUint32Array = uint32Array2;
			let otherFloat32Array = float32Array2;
			let otherByteOffset = node2IndexByteOffset;
			let otherDepth = depth2;

			// if not then flip the variables so bvh 2 node is the leaf and track that its been flipped
			// for upcoming function calls.
			let flipped = false;
			if ( isLeaf2 ) {

				[ leafNodeIndex32, otherNodeIndex32 ] = [ otherNodeIndex32, leafNodeIndex32 ];
				[ leafUint16Array, otherUint16Array ] = [ otherUint16Array, leafUint16Array ];
				[ leafUint32Array, otherUint32Array ] = [ otherUint32Array, leafUint32Array ];
				[ leafFloat32Array, otherFloat32Array ] = [ otherFloat32Array, leafFloat32Array ];
				[ leafByteOffset, otherByteOffset ] = [ otherByteOffset, leafByteOffset ];
				[ leafDepth, otherDepth ] = [ otherDepth, leafDepth ];
				flipped = true;

			}

			// reference boxes for intuitive naming
			const leafBox = _box1;
			const otherBox = _box2;
			const otherBoxLeft = _boxLeft2;
			const otherBoxRight = _boxRight2;

			const otherLeft = otherNodeIndex32 + 8;
			const otherRight = otherUint32Array[ otherNodeIndex32 + 6 ];
			arrayToBox( leafNodeIndex32, leafFloat32Array, leafBox );
			arrayToBox( otherLeft, otherFloat32Array, otherBoxLeft );
			arrayToBox( otherRight, otherFloat32Array, otherBoxRight );

			// determine the order to check the child intersections in if there's a node score function.
			let otherChild1 = otherLeft;
			let otherChild2 = otherRight;
			let score1 = 0;
			let score2 = 0;
			if ( nodeScoreFunc ) {

				let scoreLeft, scoreRight;
				if ( flipped ) {

					scoreLeft = nodeScoreFunc( otherBoxLeft, leafBox );
					scoreRight = nodeScoreFunc( otherBoxRight, leafBox );

				} else {

					// not flipped
					// Leaf is assumed to be the first node which should be passed in first
					scoreLeft = nodeScoreFunc( leafBox, otherBoxLeft );
					scoreRight = nodeScoreFunc( leafBox, otherBoxRight );

				}

				// if the right child scored lower than the left child, then traverse it first.
				if ( scoreRight < scoreLeft ) {

					otherChild1 = otherRight;
					otherChild2 = otherLeft;
					score1 = scoreRight;
					score2 = scoreLeft;

				} else {

					otherChild1 = otherLeft;
					otherChild2 = otherRight;
					score1 = scoreLeft;
					score2 = scoreRight;

				}

			}

			// Check the first bounds
			arrayToBox( leafNodeIndex32, float32Array1, leafBox );
			arrayToBox( otherChild1, float32Array2, otherBox );

			const c1IsLeaf = ( otherUint16Array[ otherChild1 * 2 + 15 ] === 0xFFFF );
			let c1Intersection, c1StopTraversal;
			if ( flipped ) {

				c1Intersection = intersectsBoundsFunc(
					otherBox, leafBox, score1,

					// node 2 info
					c1IsLeaf, otherDepth + 1, otherByteOffset + otherChild1,

					// node 1 info
					true, leafDepth, leafByteOffset + leafNodeIndex32,

				);

			} else {

				// not flipped
				c1Intersection = intersectsBoundsFunc(
					leafBox, otherBox, score1,

					// node 1 info
					true, leafDepth, leafByteOffset + leafNodeIndex32,

					// node 2 info
					c1IsLeaf, otherDepth + 1, otherByteOffset + otherChild1,

				);

			}

			if ( flipped ) {

				c1StopTraversal = c1Intersection && bvhcast(
					// node indices
					otherChild1, leafNodeIndex32,

					// functions
					intersectsBoundsFunc, intersectsRangeFunc, nodeScoreFunc,

					// depth and offsets
					otherByteOffset, otherDepth + 1,
					leafByteOffset, leafDepth,
				);

			} else {

				c1StopTraversal = c1Intersection && bvhcast(
					// node indices
					leafNodeIndex32, otherChild1,

					// functions
					intersectsBoundsFunc, intersectsRangeFunc, nodeScoreFunc,

					// depth and offsets
					leafByteOffset, leafDepth,
					otherByteOffset, otherDepth + 1,
				);

			}

			if ( c1StopTraversal ) {

				return true;

			}

			// Check the second bounds
			arrayToBox( leafNodeIndex32, leafFloat32Array, leafBox );
			arrayToBox( otherChild2, otherFloat32Array, otherBox );

			const c2IsLeaf = ( otherUint16Array[ otherChild2 * 2 + 15 ] === 0xFFFF );
			let c2Intersection, c2StopTraversal;
			if ( flipped ) {

				c2Intersection = intersectsBoundsFunc(
					otherBox, leafBox, score2,

					// node 1 info
					true, leafDepth, leafByteOffset + leafNodeIndex32,

					// node 2 info
					c2IsLeaf, otherDepth + 1, otherByteOffset + otherChild2,
				);

			} else {

				c2Intersection = intersectsBoundsFunc(
					leafBox, otherBox, score2,

					// node 2 info
					c2IsLeaf, otherDepth + 1, otherByteOffset + otherChild2,

					// node 1 info
					true, leafDepth, leafByteOffset + leafNodeIndex32,
				);

			}

			if ( flipped ) {

				c2StopTraversal = c2Intersection && bvhcast(
					// node indices
					otherChild2, leafNodeIndex32,

					// functions
					intersectsBoundsFunc, intersectsRangeFunc, nodeScoreFunc,

					// depth and offsets
					otherByteOffset, otherDepth + 1,
					leafByteOffset, leafDepth,
				);

			} else {

				c2StopTraversal = c2Intersection && bvhcast(
					// node indices
					leafNodeIndex32, otherChild2,

					// functions
					intersectsBoundsFunc, intersectsRangeFunc, nodeScoreFunc,

					// depth and offsets
					leafByteOffset, leafDepth,
					otherByteOffset, otherDepth + 1,
				);

			}

			if ( c2StopTraversal ) {

				return true;

			}

		} else {

			// TODO: consider a stack of these so we don't create a new one at each traversal
			let sortArr;
			if ( _sortArrIndex >= _sortArrPool.length ) {

				sortArr = [ null, null, null, null ].map( () => {

					return {
						score: 0,
						n1: - 1,
						n2: - 1,
						b1: null,
						b2: null,
					};

				} );
				_sortArrPool.push( sortArr );
				_sortArrIndex ++;

			} else {

				sortArr = _sortArrPool[ _sortArrIndex ];
				_sortArrIndex ++;

			}

			const child1Left = node1Index32 + 8;
			const child1Right = uint32Array1[ node1Index32 + 6 ];
			const child2Left = node2Index32 + 8;
			const child2Right = uint32Array2[ node2Index32 + 6 ];

			// get bounds of all children
			arrayToBox( child1Left, float32Array1, _boxLeft1 );
			arrayToBox( child1Right, float32Array1, _boxRight1 );
			arrayToBox( child2Left, float32Array2, _boxLeft2 );
			arrayToBox( child2Right, float32Array2, _boxRight2 );

			// if we have a score function then fill up the sort array
			if ( nodeScoreFunc ) {

				let info;

				// left vs left
				info = sortArr[ 0 ];
				info.score = nodeScoreFunc( _boxLeft1, _boxLeft2 );
				info.n1 = child1Left;
				info.n2 = child2Left;

				// left vs right
				info = sortArr[ 1 ];
				info.score = nodeScoreFunc( _boxLeft1, _boxRight2 );
				info.n1 = child1Left;
				info.n2 = child2Right;

				// right vs left
				info = sortArr[ 2 ];
				info.score = nodeScoreFunc( _boxRight1, _boxLeft2 );
				info.n1 = child1Right;
				info.n2 = child2Left;

				// right vs right
				info = sortArr[ 3 ];
				info.score = nodeScoreFunc( _boxRight1, _boxRight2 );
				info.n1 = child1Right;
				info.n2 = child2Right;

				// sort scores lowest first
				sortArr.sort( sortFunc );

			} else {

				let info;

				// left vs left
				info = sortArr[ 0 ];
				info.score = 0;
				info.n1 = child1Left;
				info.n2 = child2Left;

				// left vs right
				info = sortArr[ 1 ];
				info.score = 0;
				info.n1 = child1Left;
				info.n2 = child2Right;

				// right vs left
				info = sortArr[ 2 ];
				info.score = 0;
				info.n1 = child1Right;
				info.n2 = child2Left;

				// right vs right
				info = sortArr[ 3 ];
				info.score = 0;
				info.n1 = child1Right;
				info.n2 = child2Right;

			}

			for ( let i = 0; i < 4; i ++ ) {

				const { n1, n2, score } = sortArr[ i ];

				arrayToBox( n1, float32Array1, _box1 );
				arrayToBox( n2, float32Array2, _box2 );
				const leaf1 = ( uint16Array1[ n1 * 2 + 15 ] === 0xFFFF );
				const leaf2 = ( uint16Array2[ n2 * 2 + 15 ] === 0xFFFF );
				const intersection = intersectsBoundsFunc(
					_box1, _box2, score,

					leaf1, depth1 + 1, node1IndexByteOffset + n1,

					leaf2, depth2 + 1, node2IndexByteOffset + n2,
				);

				let stopTraversal = false;
				if ( intersection ) {

					stopTraversal = bvhcast(
						n1, n2, intersectsBoundsFunc,

						intersectsRangeFunc, nodeScoreFunc,

						node1IndexByteOffset, depth1 + 1,
						node2IndexByteOffset, depth2 + 1,
					);

				}

				if ( stopTraversal ) {

					_sortArrIndex --;
					return true;

				}

			}

			_sortArrIndex --;

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
			while ( ! ( uint16Array[ nodeIndex16 + 15 ] === 0xFFFF ) ) {

				nodeIndex32 = nodeIndex32 + 8;
				nodeIndex16 = nodeIndex32 * 2;

			}

			return uint32Array[ nodeIndex32 + 6 ];

		}

		function getRightEndOffset( nodeIndex32 ) {

			let nodeIndex16 = nodeIndex32 * 2, uint16Array = _uint16Array, uint32Array = _uint32Array;

			// traverse until we find a leaf
			while ( ! ( uint16Array[ nodeIndex16 + 15 ] === 0xFFFF ) ) {

				// adjust offset to point to the right node
				nodeIndex32 = uint32Array[ nodeIndex32 + 6 ];
				nodeIndex16 = nodeIndex32 * 2;

			}

			// return the end offset of the triangle range
			return uint32Array[ nodeIndex32 + 6 ] + uint16Array[ nodeIndex16 + 14 ];

		}

		let nodeIndex16 = nodeIndex32 * 2, float32Array = _float32Array, uint16Array = _uint16Array, uint32Array = _uint32Array;

		const isLeaf = ( uint16Array[ nodeIndex16 + 15 ] === 0xFFFF );
		if ( isLeaf ) {

			const offset = uint32Array[ nodeIndex32 + 6 ];
			const count = uint16Array[ nodeIndex16 + 14 ];

			// TODO: add tests for byte offsets?
			return intersectsRangeFunc( offset, count, false, depth, nodeIndexByteOffset + nodeIndex32 );

		} else {

			const left = nodeIndex32 + 8;
			const right = uint32Array[ nodeIndex32 + 6 ];
			let c1 = left;
			let c2 = right;

			let score1, score2;
			let box1, box2;
			if ( nodeScoreFunc ) {

				box1 = _box1;
				box2 = _box2;

				// bounding data is not offset
				arrayToBox( c1, float32Array, box1 );
				arrayToBox( c2, float32Array, box2 );

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
				arrayToBox( c1, float32Array, box1 );

			}

			const isC1Leaf = ( uint16Array[ c1 * 2 + 15 ] === 0xFFFF );
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
			arrayToBox( c2, float32Array, box2 );

			const isC2Leaf = ( uint16Array[ c2 * 2 + 15 ] === 0xFFFF );
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
