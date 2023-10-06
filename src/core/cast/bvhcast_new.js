import { Box3, Matrix4 } from 'three';
import { BufferStack } from '../utils/BufferStack.js';
import { BOUNDING_DATA_INDEX, COUNT, IS_LEAF, LEFT_NODE, OFFSET, RIGHT_NODE } from '../utils/nodeBufferUtils.js';
import { arrayToBox } from '../../utils/ArrayBoxUtilities.js';
import { PrimitivePool } from '../../utils/PrimitivePool.js';

const _bufferStack1 = new BufferStack.constructor();
const _bufferStack2 = new BufferStack.constructor();
const _boxPool = new PrimitivePool( () => new Box3() );

const _lbox2 = new Box3();
const _rbox2 = new Box3();

let _active = false;

export function bvhcast_new( bvh, otherBvh, matrixToLocal, intersectsRanges ) {

	if ( _active ) {

		throw new Error( 'MeshBVH: Recursive calls to bvhcast not supported.' );

	}

	_active = true;

	const roots = bvh._roots;
	const otherRoots = otherBvh._roots;
	let result;
	let offset1 = 0;
	let offset2 = 0;
	const invMat = new Matrix4().copy( matrixToLocal ).invert();

	// iterate over the first set of roots
	for ( let i = 0, il = roots.length; i < il; i ++ ) {

		_bufferStack1.setBuffer( roots[ i ] );
		offset2 = 0;

		// iterate over the second set of roots
		for ( let j = 0, jl = otherRoots.length; j < jl; j ++ ) {

			_bufferStack2.setBuffer( otherRoots[ i ] );

			result = _traverse(
				0, 0, matrixToLocal, invMat, intersectsRanges,
				offset1, offset2,
			);

			_bufferStack2.clearBuffer();
			offset2 += otherRoots[ j ].length;

			if ( result ) {

				break;

			}

		}

		_bufferStack1.clearBuffer();
		offset1 += roots[ i ].length;

		if ( result ) {

			break;

		}

	}

	_active = false;
	return result;

}

function _traverse(
	node1Index32,
	node2Index32,
	matrix2to1,
	matrix1to2,
	intersectsRangesFunc,

	// offsets for ids
	node1IndexByteOffset = 0,
	node2IndexByteOffset = 0,

	// tree depth
	depth1 = 0,
	depth2 = 0,

	currBox = null,
	reversed = false,

) {

	const bufferStack1 = reversed ? _bufferStack2 : _bufferStack1;
	const bufferStack2 = reversed ? _bufferStack1 : _bufferStack2;
	let localBox = currBox;
	if ( localBox === null ) {

		localBox = _boxPool.getPrimitive();
		arrayToBox( BOUNDING_DATA_INDEX( node1Index32 ), bufferStack1.float32Array, localBox );
		localBox.applyMatrix4( matrix1to2 );

	}

	const node1Index16 = node1Index32 * 2;
	const node2Index16 = node2Index32 * 2;
	const isLeaf1 = IS_LEAF( node1Index16, bufferStack1.uint16Array );
	const isLeaf2 = IS_LEAF( node2Index16, bufferStack2.uint16Array );
	let result = false;
	if ( isLeaf2 && isLeaf1 ) {

		// if both bounds are leaf nodes then fire the callback if the boxes intersect
		// arrayToBox( BOUNDING_DATA_INDEX( node2Index32 ), bufferStack2.float32Array, _tempBox );
		// if ( ! currBox.intersectsBox( _tempBox ) ) {

		// 	// TODO: is this check necessary?
		// 	return false;

		// }

		if ( reversed ) {

			result = intersectsRangesFunc(
				OFFSET( node2Index32, bufferStack2.uint32Array ), COUNT( node2Index32 * 2, bufferStack2.uint16Array ),
				OFFSET( node1Index32, bufferStack1.uint32Array ), COUNT( node1Index32 * 2, bufferStack1.uint16Array ),
				depth2, node2IndexByteOffset + node2Index32,
				depth1, node1IndexByteOffset + node1Index32,
			);

		} else {

			result = intersectsRangesFunc(
				OFFSET( node1Index32, bufferStack1.uint32Array ), COUNT( node1Index32 * 2, bufferStack1.uint16Array ),
				OFFSET( node2Index32, bufferStack2.uint32Array ), COUNT( node2Index32 * 2, bufferStack2.uint16Array ),
				depth1, node1IndexByteOffset + node1Index32,
				depth2, node2IndexByteOffset + node2Index32,
			);

		}

	} else if ( isLeaf2 ) {

		// If we've traversed to the leaf node on the second side then traverse
		// down the other bvh
		// arrayToBox( BOUNDING_DATA_INDEX( node2Index32 ), bufferStack2.float32Array, _tempBox );
		// if ( ! currBox.intersectsBox( _tempBox ) ) {

		// 	// TODO: is this check necessary
		// 	return false;

		// }

		const newBox = _boxPool.getPrimitive();
		arrayToBox( BOUNDING_DATA_INDEX( node2Index32 ), bufferStack2.float32Array, newBox );
		newBox.applyMatrix4( matrix2to1 );

		const cl1 = LEFT_NODE( node1Index32 );
		const cr1 = RIGHT_NODE( node1Index32, bufferStack1.uint32Array );
		result = _traverse(
			node2Index32, cl1, matrix1to2, matrix2to1, intersectsRangesFunc,
			node2IndexByteOffset, node1IndexByteOffset, depth2, depth1 + 1,
			newBox, ! reversed,
		) || _traverse(
			node2Index32, cr1, matrix1to2, matrix2to1, intersectsRangesFunc,
			node2IndexByteOffset, node1IndexByteOffset, depth2, depth1 + 1,
			newBox, ! reversed,
		);

		_boxPool.releasePrimitive( newBox );

	} else {

		const cl2 = LEFT_NODE( node2Index32 );
		const cr2 = RIGHT_NODE( node2Index32, bufferStack2.uint32Array );
		arrayToBox( BOUNDING_DATA_INDEX( cl2 ), bufferStack2.float32Array, _lbox2 );
		arrayToBox( BOUNDING_DATA_INDEX( cr2 ), bufferStack2.float32Array, _rbox2 );

		const leftIntersects = localBox.intersectsBox( _lbox2 );
		const rightIntersects = localBox.intersectsBox( _rbox2 );
		if ( leftIntersects && rightIntersects ) {

			result = _traverse(
				node1Index32, cl2, matrix2to1, matrix1to2, intersectsRangesFunc,
				node1IndexByteOffset, node2IndexByteOffset, depth1, depth2 + 1,
				localBox, reversed,
			) || _traverse(
				node1Index32, cr2, matrix2to1, matrix1to2, intersectsRangesFunc,
				node1IndexByteOffset, node2IndexByteOffset, depth1, depth2 + 1,
				localBox, reversed,
			);

		} else if ( leftIntersects ) {

			if ( isLeaf1 ) {

				result = _traverse(
					node1Index32, cl2, matrix2to1, matrix1to2, intersectsRangesFunc,
					node1IndexByteOffset, node2IndexByteOffset, depth1, depth2 + 1,
					localBox, reversed,
				);

			} else {

				const newBox = _boxPool.getPrimitive();
				newBox.copy( _lbox2 ).applyMatrix4( matrix2to1 );

				const cl1 = LEFT_NODE( node1Index32 );
				const cr1 = RIGHT_NODE( node1Index32, bufferStack1.uint32Array );
				result = _traverse(
					cl2, cl1, matrix1to2, matrix2to1, intersectsRangesFunc,
					node2IndexByteOffset, node1IndexByteOffset, depth2, depth1 + 1,
					newBox, ! reversed,
				) || _traverse(
					cl2, cr1, matrix1to2, matrix2to1, intersectsRangesFunc,
					node2IndexByteOffset, node1IndexByteOffset, depth2, depth1 + 1,
					newBox, ! reversed,
				);

				_boxPool.releasePrimitive( newBox );

			}

		} else if ( rightIntersects ) {

			if ( isLeaf1 ) {

				result = _traverse(
					node1Index32, cr2, matrix2to1, matrix1to2, intersectsRangesFunc,
					node1IndexByteOffset, node2IndexByteOffset, depth1, depth2 + 1,
					localBox, reversed,
				);

			} else {

				const newBox = _boxPool.getPrimitive();
				newBox.copy( _rbox2 ).applyMatrix4( matrix2to1 );

				const cl1 = LEFT_NODE( node1Index32 );
				const cr1 = RIGHT_NODE( node1Index32, bufferStack1.uint32Array );
				result = _traverse(
					cr2, cl1, matrix1to2, matrix2to1, intersectsRangesFunc,
					node2IndexByteOffset, node1IndexByteOffset, depth2, depth1 + 1,
					newBox, ! reversed,
				) || _traverse(
					cr2, cr1, matrix1to2, matrix2to1, intersectsRangesFunc,
					node2IndexByteOffset, node1IndexByteOffset, depth2, depth1 + 1,
					newBox, ! reversed,
				);

				_boxPool.releasePrimitive( newBox );

			}

		}

	}

	if ( currBox === null ) {

		_boxPool.releasePrimitive( localBox );

	}

	return result;

}

