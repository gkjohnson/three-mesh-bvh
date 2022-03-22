/**
 * Currently unused bvhcast code for iteratively walking down two BVHs. It's slower (or equally as performant) as
 * performing recursive shapecast calls between two BVHs (ie shapecast down to a leaf node and then shapecast using
 * that OBB against the other BVH) likely due to the overhead of updating the "OrientedBox" cache variables which
 * this approach needs to use and update a lot more frequently. If the OrientedBox update and intersects bounds
 * functions can be made faster then this may be a win. Using an AABB with a matrix applied is more of a win but
 * the same improvements benefit the shapecast approach, as well.
 */
import { Box3 } from 'three';

import { OrientedBox } from '../math/OrientedBox.js';
import { arrayToBox } from '../utils/ArrayBoxUtilities.js';
import { PrimitivePool } from '../utils/PrimitivePool.js';
import { COUNT, OFFSET, LEFT_NODE, RIGHT_NODE, IS_LEAF, BOUNDING_DATA_INDEX } from './nodeBufferFunctions.js';
import { MeshBVH } from './MeshBVH.js';
import { setTriangle } from '../utils/TriangleUtilities.js';
import { ExtendedTriangle } from '../math/ExtendedTriangle.js';

const trianglePool = /* @__PURE__ */ new PrimitivePool( () => new ExtendedTriangle() );

MeshBVH.prototype.bvhcast = function ( otherBvh, matrixToLocal, callbacks ) {

	let {
		intersectsRange,
		intersectsTriangle,
	} = callbacks;

	const geometry = otherBvh.geometry;
	const indexAttr = geometry.index;
	const positionAttr = geometry.attributes.position;

	const triangle = trianglePool.getPrimitive();
	const triangle2 = trianglePool.getPrimitive();
	if ( intersectsTriangle ) {

		function iterateOverDoubleTriangles( offset1, count1, offset2, count2, depth1, index1, depth2, index2 ) {

			for ( let i2 = offset2, l2 = offset2 + count2; i2 < l2; i2 ++ ) {

				setTriangle( triangle2, i2 * 3, indexAttr, positionAttr );
				triangle2.a.applyMatrix4( matrixToLocal );
				triangle2.b.applyMatrix4( matrixToLocal );
				triangle2.c.applyMatrix4( matrixToLocal );
				triangle2.needsUpdate = true;

				for ( let i1 = offset1, l1 = offset1 + count1; i1 < l1; i1 ++ ) {

					setTriangle( triangle, i1 * 3, indexAttr, positionAttr );
					triangle.needsUpdate = true;

					if ( intersectsTriangle( triangle, triangle2, i1, i2, depth1, index1, depth2, index2 ) ) {

						return true;

					}

				}

			}

			return false;

		}

		if ( intersectsRange ) {

			const originalIntersectsRange = intersectsRange;
			intersectsRange = function ( offset1, count1, offset2, count2, depth1, index1, depth2, index2 ) {

				if ( ! originalIntersectsRange( offset1, count1, offset2, count2, depth1, index1, depth2, index2 ) ) {

					return iterateOverDoubleTriangles( offset1, count1, offset2, count2, depth1, index1, depth2, index2 );

				}

				return true;

			};

		} else {

			intersectsRange = iterateOverDoubleTriangles;

		}

	}

	let result = false;
	let byteOffset = 0;
	let byteOffset2 = 0;
	for ( const root of this._roots ) {

		setBuffer( root );

		for ( const root2 of otherBvh._roots ) {

			setBuffer2( root2 );
			result = bvhcast( 0, 0, matrixToLocal, intersectsRange, byteOffset, byteOffset2 );
			clearBuffer2();

			if ( result ) {

				break;

			}

			byteOffset2 += root2.byteLength;

		}

		clearBuffer();

		if ( result ) {

			break;

		}

		byteOffset += root.byteLength;

	}

	trianglePool.releasePrimitive( triangle );
	trianglePool.releasePrimitive( triangle2 );
	return result;

};

export const bvhcast = ( function () {

	/**
	 * NOTE: Because the bvhcast approach requires a lot fetching and updating of AABBs and OBBs we cache them so they can be reused.
	 * However the caching itself can be fairly expensive and winds up creating a TON of bounds during tree traversal meaning a lot
	 * of memory is used.
	 */
	const _obbPool = new PrimitivePool( () => new OrientedBox() );
	const _aabbPool = new PrimitivePool( () => new Box3() );
	const _obbMap = new Map();
	const _aabbMap = new Map();

	function getAABB( nodeIndex32, float32Array ) {

		let box;
		if ( _aabbMap.has( nodeIndex32 ) ) {

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

		} else if ( isLeaf1 || isLeaf2 ) {

			// if one of the nodes is already a leaf then split it
			let splitSide = isLeaf1 ? 2 : 1;

			// get and cache the bounds
			const _box1 = getAABB( node1Index32, float32Array1 );
			const _box2 = getOBB( node2Index32, float32Array2, matrix2to1 );

			if ( splitSide === 1 ) {

				// split node 1
				const c1 = LEFT_NODE( node1Index32 );
				const c2 = RIGHT_NODE( node1Index32, uint32Array1 );

				// run the first child first
				const _child1 = getAABB( c1, float32Array1 );
				const _child2 = getAABB( c2, float32Array1 );

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
				const _oriented2 = getOBB( c2, float32Array2, matrix2to1 );

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

		} else {

			// split both sides
			const c11 = LEFT_NODE( node1Index32 );
			const c12 = RIGHT_NODE( node1Index32, uint32Array1 );
			const c21 = LEFT_NODE( node2Index32 );
			const c22 = RIGHT_NODE( node2Index32, uint32Array2 );

			const _child11 = getAABB( c11, float32Array1 );
			const _child12 = getAABB( c12, float32Array1 );
			const _oriented21 = getOBB( c21, float32Array2, matrix2to1 );
			const _oriented22 = getOBB( c22, float32Array2, matrix2to1 );

			if (
				_oriented21.intersectsBox( _child11 ) &&
				bvhcastTraverse(
					c11, c21, matrix2to1,
					intersectsRangeFunc,
					node1IndexByteOffset, node2IndexByteOffset,
					depth1 + 1, depth2 + 1,
				)
			) {

				return true;

			}

			if (
				_oriented21.intersectsBox( _child12 ) &&
				bvhcastTraverse(
					c12, c21, matrix2to1,
					intersectsRangeFunc,
					node1IndexByteOffset, node2IndexByteOffset,
					depth1 + 1, depth2 + 1,
				)
			) {

				return true;

			}

			if (
				_oriented22.intersectsBox( _child11 ) &&
				bvhcastTraverse(
					c11, c22, matrix2to1,
					intersectsRangeFunc,
					node1IndexByteOffset, node2IndexByteOffset,
					depth1 + 1, depth2 + 1,
				)
			) {

				return true;

			}

			if (
				_oriented22.intersectsBox( _child12 ) &&
				bvhcastTraverse(
					c12, c22, matrix2to1,
					intersectsRangeFunc,
					node1IndexByteOffset, node2IndexByteOffset,
					depth1 + 1, depth2 + 1,
				)
			) {

				return true;

			}

		}

		return false;

	}

} )();

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
