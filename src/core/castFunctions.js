import { Box3, Vector3, Matrix4 } from 'three';
import { CONTAINED } from './Constants.js';

import { OrientedBox } from '../math/OrientedBox.js';
import { SeparatingAxisTriangle } from '../math/SeparatingAxisTriangle.js';
import { intersectTris, intersectClosestTri } from '../utils/GeometryRayIntersectUtilities.js';
import { setTriangle } from '../utils/TriangleUtilities.js';
import { arrayToBox } from '../utils/ArrayBoxUtilities.js';
import { PrimitivePool } from '../utils/PrimitivePool.js';

const boundingBox = new Box3();
const boxIntersection = new Vector3();
const xyzFields = [ 'x', 'y', 'z' ];

function IS_LEAF( n16, uint16Array ) {

	return uint16Array[ n16 + 15 ] === 0xFFFF;

}

function OFFSET( n32, uint32Array ) {

	return uint32Array[ n32 + 6 ];

}

function COUNT( n16, uint16Array ) {

	return uint16Array[ n16 + 14 ];

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

export function raycast( nodeIndex32, geometry, side, ray, intersects ) {

	let nodeIndex16 = nodeIndex32 * 2, float32Array = _float32Array, uint16Array = _uint16Array, uint32Array = _uint32Array;

	const isLeaf = IS_LEAF( nodeIndex16, uint16Array );
	if ( isLeaf ) {

		const offset = OFFSET( nodeIndex32, uint32Array );
		const count = COUNT( nodeIndex16, uint16Array );

		intersectTris( geometry, side, ray, offset, count, intersects );

	} else {

		const leftIndex = LEFT_NODE( nodeIndex32 );
		if ( intersectRay( leftIndex, float32Array, ray, boxIntersection ) ) {

			raycast( leftIndex, geometry, side, ray, intersects );

		}

		const rightIndex = RIGHT_NODE( nodeIndex32, uint32Array );
		if ( intersectRay( rightIndex, float32Array, ray, boxIntersection ) ) {

			raycast( rightIndex, geometry, side, ray, intersects );

		}

	}

}

export function raycastFirst( nodeIndex32, geometry, side, ray ) {

	let nodeIndex16 = nodeIndex32 * 2, float32Array = _float32Array, uint16Array = _uint16Array, uint32Array = _uint32Array;

	const isLeaf = IS_LEAF( nodeIndex16, uint16Array );
	if ( isLeaf ) {

		const offset = OFFSET( nodeIndex32, uint32Array );
		const count = COUNT( nodeIndex16, uint16Array );
		return intersectClosestTri( geometry, side, ray, offset, count );

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
		const c1Result = c1Intersection ? raycastFirst( c1, geometry, side, ray ) : null;

		// if we got an intersection in the first node and it's closer than the second node's bounding
		// box, we don't need to consider the second node because it couldn't possibly be a better result
		if ( c1Result ) {

			// check if the point is within the second bounds
			// "point" is in the local frame of the bvh
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
		const c2Result = c2Intersection ? raycastFirst( c2, geometry, side, ray ) : null;

		if ( c1Result && c2Result ) {

			return c1Result.distance <= c2Result.distance ? c1Result : c2Result;

		} else {

			return c1Result || c2Result || null;

		}

	}

}

export const shapecast = ( function () {

	let _box1, _box2;
	const boxStack = [];
	const boxPool = new PrimitivePool( () => new Box3() );

	return function shapecast( ...args ) {

		_box1 = boxPool.getPrimitive();
		_box2 = boxPool.getPrimitive();
		boxStack.push( _box1, _box2 );

		const result = shapecastTraverse( ...args );

		boxPool.releasePrimitive( _box1 );
		boxPool.releasePrimitive( _box2 );
		boxStack.pop();
		boxStack.pop();

		const length = boxStack.length;
		if ( length > 0 ) {

			_box2 = boxStack[ length - 1 ];
			_box1 = boxStack[ length - 2 ];

		}

		return result;

	};

	function shapecastTraverse(
		nodeIndex32,
		geometry,
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
			arrayToBox( BOUNDING_DATA_INDEX( nodeIndex32 ), float32Array, _box1 );
			return intersectsRangeFunc( offset, count, false, depth, nodeIndexByteOffset + nodeIndex32, _box1 );

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

				c1StopTraversal = intersectsRangeFunc( offset, count, true, depth + 1, nodeIndexByteOffset + c1, box1 );

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

				c2StopTraversal = intersectsRangeFunc( offset, count, true, depth + 1, nodeIndexByteOffset + c2, box2 );

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

		}

	}

} )();

export const bvhcast = ( function () {

	// const _child1 = new Box3();
	// const _child2 = new Box3();
	// const _oriented1 = new OrientedBox();
	// const _oriented2 = new OrientedBox();

	// const _box1 = new Box3();
	// const _box2 = new OrientedBox();

	const _obbPool = new PrimitivePool( () => new OrientedBox() );
	const _aabbPool = new PrimitivePool( () => new Box3() );
	const _obbMap = new Map();
	const _aabbMap = new Map();

	function boxVolume( box ) {

		const { min, max } = box;
		const x = max.x - min.x;
		const y = max.y - min.y;
		const z = max.z - min.z;

		return x * y * z;

	}

	function getAABB( nodeIndex32, float32Array ) {

		let box;
		if ( _aabbMap.has( nodeIndex32 ) && false ) {

			box = _aabbMap.get( nodeIndex32 );

		} else {

			box = _aabbPool.getPrimitive();
			_aabbMap.set( nodeIndex32, box );
			arrayToBox( BOUNDING_DATA_INDEX( nodeIndex32 ), float32Array, box );

		}

		return box;

	}

	function getOBB( nodeIndex32, float32Array, matrix ) {

		let box;
		if ( _obbMap.has( nodeIndex32 ) ) {

			box = _obbMap.get( nodeIndex32 );

		} else {

			box = _obbPool.getPrimitive();
			_obbMap.set( nodeIndex32, box );
			arrayToBox( BOUNDING_DATA_INDEX( nodeIndex32 ), float32Array, box );
			box.matrix.copy( matrix );
			box.needsUpdate = true;

		}

		return box;

	}

	return function bvhcast( node1Index32, node2Index32, matrix2to1, ...args ) {

		// copy the matrices once here so we don't have to do it over and over
		// _oriented1.matrix.copy( matrix2to1 );
		// _oriented2.matrix.copy( matrix2to1 );
		// _box2.matrix.copy( matrix2to1 );

		_obbMap.forEach( box => _obbPool.releasePrimitive( box ) );
		_obbMap.clear();

		_aabbMap.forEach( box => _aabbPool.releasePrimitive( box ) );
		_aabbMap.clear();

		return bvhcastTraverse( node1Index32, node2Index32, matrix2to1, ...args );

	};

	function bvhcastTraverse(
		// current parent node status
		node1Index32,
		node2Index32,
		matrix2to1,

		// function taking the triangle ranges of both intersecting leaf bounds as well as the bounds themselves.
		// returns the same types of values the the shapecast variant can.
		intersectsRangeFunc,

		// node index and depth identifiers
		node1IndexByteOffset = 0,
		node2IndexByteOffset = 0,

		depth1 = 0,
		depth2 = 0,
	) {

		const float32Array1 = _float32Array, uint16Array1 = _uint16Array, uint32Array1 = _uint32Array;
		const float32Array2 = _float32Array2, uint16Array2 = _uint16Array2, uint32Array2 = _uint32Array2;

		const isLeaf1 = IS_LEAF( node1Index32 * 2, uint16Array1 );
		const isLeaf2 = IS_LEAF( node2Index32 * 2, uint16Array2 );

		if ( isLeaf1 && isLeaf2 ) {

			// intersect triangles
			return intersectsRangeFunc(
				OFFSET( node1Index32, uint32Array1 ), COUNT( node1Index32 * 2, uint16Array1 ),
				OFFSET( node2Index32, uint32Array2 ), COUNT( node2Index32 * 2, uint16Array2 ),
				depth1, node1IndexByteOffset + node1Index32,
				depth2, node2IndexByteOffset + node2Index32,
			);

		} else {

			// if one of the nodes is already a leaf then split it
			let splitSide = 0;
			if ( isLeaf1 ) {

				splitSide = 2;

			}

			if ( isLeaf2 ) {

				splitSide = 1;

			}

			// get and cache the bounds
			const _box1 = getAABB( node1Index32, float32Array1 );
			const _box2 = getOBB( node2Index32, float32Array2, matrix2to1 );

			// if neither element is a leaf then split the one that has a higher volume
			if ( splitSide === 0 ) {

				// TODO: account for scale here
				const volume1 = boxVolume( _box1 );
				const volume2 = boxVolume( _box2 );
				splitSide = volume1 > volume2 ? 1 : 2;

			}

			if ( splitSide === 1 ) {

				// split node 1
				const c1 = LEFT_NODE( node1Index32 );
				const c2 = RIGHT_NODE( node1Index32, uint32Array1 );

				// run the first child first
				const _child1 = getAABB( c1, float32Array1 );

				if (
					_box2.intersectsBox( _child1 ) &&
					bvhcastTraverse(
						c1, node2Index32, matrix2to1,
						intersectsRangeFunc,
						node1IndexByteOffset, node2IndexByteOffset,
						depth1 + 1, depth2,
					)
				) {

					return true;

				}

				// run the second child next
				const _child2 = getAABB( c2, float32Array1 );

				if (
					_box2.intersectsBox( _child2 ) &&
					bvhcastTraverse(
						c2, node2Index32, matrix2to1,
						intersectsRangeFunc,
						node1IndexByteOffset, node2IndexByteOffset,
						depth1 + 1, depth2,
					)
				) {

					return true;

				}

			} else {

				const c1 = LEFT_NODE( node2Index32 );
				const c2 = RIGHT_NODE( node2Index32, uint32Array2 );

				// run the first child first
				const _oriented1 = getOBB( c1, float32Array2, matrix2to1 );

				if (
					_oriented1.intersectsBox( _box1 ) &&
					bvhcastTraverse(
						node1Index32, c1, matrix2to1,
						intersectsRangeFunc,
						node1IndexByteOffset, node2IndexByteOffset,
						depth1, depth2 + 1,
					)
				) {

					return true;

				}

				// run the second child next
				const _oriented2 = getOBB( c2, float32Array2, matrix2to1 );

				if (
					_oriented2.intersectsBox( _box1 ) &&
					bvhcastTraverse(
						node1Index32, c2, matrix2to1,
						intersectsRangeFunc,
						node1IndexByteOffset, node2IndexByteOffset,
						depth1, depth2 + 1,
					)
				) {

					return true;

				}

			}

		}

		return false;

	}

} )();

export const intersectsGeometry = ( function () {

	const triangle = new SeparatingAxisTriangle();
	const triangle2 = new SeparatingAxisTriangle();
	const invertedMat = new Matrix4();

	const obb = new OrientedBox();
	const obb2 = new OrientedBox();

	return function intersectsGeometry( nodeIndex32, geometry, otherGeometry, geometryToBvh, cachedObb = null ) {

		let nodeIndex16 = nodeIndex32 * 2, float32Array = _float32Array, uint16Array = _uint16Array, uint32Array = _uint32Array;

		if ( cachedObb === null ) {

			if ( ! otherGeometry.boundingBox ) {

				otherGeometry.computeBoundingBox();

			}

			obb.set( otherGeometry.boundingBox.min, otherGeometry.boundingBox.max, geometryToBvh );
			cachedObb = obb;

		}

		const isLeaf = IS_LEAF( nodeIndex16, uint16Array );
		if ( isLeaf ) {

			const thisGeometry = geometry;
			const thisIndex = thisGeometry.index;
			const thisPos = thisGeometry.attributes.position;

			const index = otherGeometry.index;
			const pos = otherGeometry.attributes.position;

			const offset = OFFSET( nodeIndex32, uint32Array );
			const count = COUNT( nodeIndex16, uint16Array );

			// get the inverse of the geometry matrix so we can transform our triangles into the
			// geometry space we're trying to test. We assume there are fewer triangles being checked
			// here.
			invertedMat.copy( geometryToBvh ).invert();

			if ( otherGeometry.boundsTree ) {

				arrayToBox( BOUNDING_DATA_INDEX( nodeIndex32 ), float32Array, obb2 );
				obb2.matrix.copy( invertedMat );
				obb2.needsUpdate = true;

				const res = otherGeometry.boundsTree.shapecast( {

					intersectsBounds: box => obb2.intersectsBox( box ),

					intersectsTriangle: tri => {

						tri.a.applyMatrix4( geometryToBvh );
						tri.b.applyMatrix4( geometryToBvh );
						tri.c.applyMatrix4( geometryToBvh );
						tri.needsUpdate = true;

						for ( let i = offset * 3, l = ( count + offset ) * 3; i < l; i += 3 ) {

							// this triangle needs to be transformed into the current BVH coordinate frame
							setTriangle( triangle2, i, thisIndex, thisPos );
							triangle2.needsUpdate = true;
							if ( tri.intersectsTriangle( triangle2 ) ) {

								return true;

							}

						}

						return false;

					}

				} );

				return res;

			} else {

				for ( let i = offset * 3, l = ( count + offset * 3 ); i < l; i += 3 ) {

					// this triangle needs to be transformed into the current BVH coordinate frame
					setTriangle( triangle, i, thisIndex, thisPos );
					triangle.a.applyMatrix4( invertedMat );
					triangle.b.applyMatrix4( invertedMat );
					triangle.c.applyMatrix4( invertedMat );
					triangle.needsUpdate = true;

					for ( let i2 = 0, l2 = index.count; i2 < l2; i2 += 3 ) {

						setTriangle( triangle2, i2, index, pos );
						triangle2.needsUpdate = true;

						if ( triangle.intersectsTriangle( triangle2 ) ) {

							return true;

						}

					}

				}

			}

		} else {

			const left = nodeIndex32 + 8;
			const right = uint32Array[ nodeIndex32 + 6 ];

			arrayToBox( BOUNDING_DATA_INDEX( left ), float32Array, boundingBox );
			const leftIntersection =
				cachedObb.intersectsBox( boundingBox ) &&
				intersectsGeometry( left, geometry, otherGeometry, geometryToBvh, cachedObb );

			if ( leftIntersection ) return true;

			arrayToBox( BOUNDING_DATA_INDEX( right ), float32Array, boundingBox );
			const rightIntersection =
				cachedObb.intersectsBox( boundingBox ) &&
				intersectsGeometry( right, geometry, otherGeometry, geometryToBvh, cachedObb );

			if ( rightIntersection ) return true;

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

// for bvhcast only
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
