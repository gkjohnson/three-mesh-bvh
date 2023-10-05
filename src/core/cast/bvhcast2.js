import { Box3 } from 'three';
import { BufferStack } from '../utils/BufferStack.js';
import { BOUNDING_DATA_INDEX, COUNT, IS_LEAF, LEFT_NODE, OFFSET, RIGHT_NODE } from '../utils/nodeBufferUtils.js';
import { arrayToBox } from '../../utils/ArrayBoxUtilities.js';

const _bufferStack1 = new BufferStack.constructor();
const _bufferStack2 = new BufferStack.constructor();
const _box1 = new Box3();
const _box2 = new Box3();

export function bvhcast_new( bvh, otherBvh, matrixToLocal, intersectsRanges ) {

	const roots = bvh._roots;
	const otherRoots = otherBvh._roots;
	let result;
	let offset1 = 0;
	let offset2 = 0;

	// iterate over the first set of roots
	for ( let i = 0, il = roots.length; i < il; i ++ ) {

		_bufferStack1.setBuffer( roots[ i ] );
		offset2 = 0;

		// iterate over the second set of roots
		for ( let j = 0, jl = otherRoots.length; j < jl; j ++ ) {

			_bufferStack2.setBuffer( otherRoots[ i ] );

			result = _traverse(
				0, 0, matrixToLocal, intersectsRanges,
				offset1, offset2, 0, 0,
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

	return result;

}

function _traverse(
	node1Index32,
	node2Index32,
	matrix2to1,
	intersectsRangesFunc,

	// offsets for ids
	node1IndexByteOffset = 0,
	node2IndexByteOffset = 0,

	// tree depth
	depth1 = 0,
	depth2 = 0,
) {

	// TODO: Compare the number of matrix multiplications that occur in each case
	// compared to the previous iterations
	// TODO: do obbs help here?
	// TODO: is it best to ensure the shallower of the two trees comes second so fewer
	// box multiplications occur? Or to book keep both the inverse and the regular matrix
	// so we can use both?
	const node1Index16 = node1Index32 * 2;
	const node2Index16 = node2Index32 * 2;
	arrayToBox( BOUNDING_DATA_INDEX( node1Index32 ), _bufferStack1.float32Array, _box1 );
	arrayToBox( BOUNDING_DATA_INDEX( node2Index32 ), _bufferStack2.float32Array, _box2 );
	_box2.applyMatrix4( matrix2to1 );
	if ( ! _box1.intersectsBox( _box2 ) ) {

		return false;

	}

	const node1IsLeaf = IS_LEAF( node1Index16, _bufferStack1.uint16Array );
	const node2IsLeaf = IS_LEAF( node2Index16, _bufferStack2.uint16Array );
	if ( node1IsLeaf && node2IsLeaf ) {

		return intersectsRangesFunc(
			OFFSET( node1Index32, _bufferStack1.uint32Array ), COUNT( node1Index32 * 2, _bufferStack1.uint16Array ),
			OFFSET( node2Index32, _bufferStack2.uint32Array ), COUNT( node2Index32 * 2, _bufferStack2.uint16Array ),
			depth1, node1IndexByteOffset + node1Index32,
			depth2, node2IndexByteOffset + node2Index32,
		);

	} else if ( node1IsLeaf ) {

		const cl2 = LEFT_NODE( node2Index32 );
		const cr2 = RIGHT_NODE( node2Index32, _bufferStack2.uint32Array );
		return _traverse(
			node1Index32, cl2, matrix2to1, intersectsRangesFunc,
			node1IndexByteOffset, node2IndexByteOffset,
			depth1, depth2 + 1,
		) || _traverse(
			node1Index32, cr2, matrix2to1, intersectsRangesFunc,
			node1IndexByteOffset, node2IndexByteOffset,
			depth1, depth2 + 1,
		);

	} else if ( node2IsLeaf ) {

		const cl1 = LEFT_NODE( node1Index32 );
		const cr1 = RIGHT_NODE( node1Index32, _bufferStack1.uint32Array );
		return _traverse(
			cl1, node2Index32, matrix2to1, intersectsRangesFunc,
			node1IndexByteOffset, node1IndexByteOffset,
			depth1 + 1, depth2,
		) || _traverse(
			cr1, node2Index32, matrix2to1, intersectsRangesFunc,
			node1IndexByteOffset, node1IndexByteOffset,
			depth1 + 1, depth2,
		);

	} else {

		// TODO: is it best to check if children intersect the larger boxes here before traversing?
		// Or pass the parent node of the larger box down first?
		// TODO: should we pass a child and one parent down here? Ie the paren that has the most remaining
		// depth until leaves?
		const cl1 = LEFT_NODE( node1Index32 );
		const cr1 = RIGHT_NODE( node1Index32, _bufferStack1.uint32Array );
		const cl2 = LEFT_NODE( node2Index32 );
		const cr2 = RIGHT_NODE( node2Index32, _bufferStack2.uint32Array );

		return _traverse(
			cl1, cl2, matrix2to1, intersectsRangesFunc,
			node1IndexByteOffset, node2IndexByteOffset,
			depth1 + 1, depth2 + 1,
		) || _traverse(
			cr1, cl2, matrix2to1, intersectsRangesFunc,
			node1IndexByteOffset, node2IndexByteOffset,
			depth1 + 1, depth2 + 1,
		) || _traverse(
			cl1, cr2, matrix2to1, intersectsRangesFunc,
			node1IndexByteOffset, node2IndexByteOffset,
			depth1 + 1, depth2 + 1,
		) || _traverse(
			cr1, cr2, matrix2to1, intersectsRangesFunc,
			node1IndexByteOffset, node2IndexByteOffset,
			depth1 + 1, depth2 + 1,
		);

	}

}
