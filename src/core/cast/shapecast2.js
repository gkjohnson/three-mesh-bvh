import { BufferStack } from '../utils/BufferStack.js';
import { COUNT, IS_LEAF, LEFT_NODE, OFFSET, RIGHT_NODE } from '../utils/nodeBufferUtils.js';

// test function optimized for score function that not uses box conversion to test performance (5-6% slower, instead of 40% slower)
export function shapecast( bvh, root, intersectsBoundsFunc, intersectsRangeFunc, nodeScoreFunc ) {

	// setup
	BufferStack.setBuffer( bvh._roots[ root ] );
	const { float32Array, uint16Array, uint32Array } = BufferStack;

	const result = shapecastTraverse( 0 );

	// cleanup
	BufferStack.clearBuffer();

	return result;

	function shapecastTraverse( nodeIndex32	) {

		let nodeIndex16 = nodeIndex32 * 2;

		const isLeaf = IS_LEAF( nodeIndex16, uint16Array );
		if ( isLeaf ) {

			const offset = OFFSET( nodeIndex32, uint32Array );
			const count = COUNT( nodeIndex16, uint16Array );
			return intersectsRangeFunc( offset, count, false );

		}

		const left = LEFT_NODE( nodeIndex32 );
		const right = RIGHT_NODE( nodeIndex32, uint32Array );
		let c1 = left;
		let c2 = right;

		let score1, score2;

		score1 = nodeScoreFunc( c1, float32Array );
		score2 = nodeScoreFunc( c2, float32Array );

		if ( score2 < score1 ) {

			c1 = right;
			c2 = left;

			const temp = score1;
			score1 = score2;
			score2 = temp;

		}


		if ( intersectsBoundsFunc( score1 ) ) {

			if ( shapecastTraverse( c1 ) ) return true;

			if ( intersectsBoundsFunc( score2 ) && shapecastTraverse( c2 ) ) return true;

		}

		return false;

	}

}
