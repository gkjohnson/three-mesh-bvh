import { Vector3 } from 'three';
import { intersectRay } from '../utils/intersectUtils.js';
import { COUNT, OFFSET, LEFT_NODE, RIGHT_NODE, IS_LEAF } from '../utils/nodeBufferUtils.js';
import { BufferStack } from '../utils/BufferStack.js';
import { intersectTris } from '../utils/iterationUtils.generated.js';
import { intersectTris_indirect } from '../utils/iterationUtils_indirect.generated.js';

const _boxIntersection = /* @__PURE__ */ new Vector3();
export function raycast/* @echo INDIRECT_STRING */( bvh, root, side, ray, intersects ) {

	BufferStack.setBuffer( bvh._roots[ root ] );
	_raycast( 0, bvh, side, ray, intersects );
	BufferStack.clearBuffer();

}

function _raycast( nodeIndex32, bvh, side, ray, intersects ) {

	const { float32Array, uint16Array, uint32Array } = BufferStack;
	const nodeIndex16 = nodeIndex32 * 2;
	const isLeaf = IS_LEAF( nodeIndex16, uint16Array );
	if ( isLeaf ) {

		const offset = OFFSET( nodeIndex32, uint32Array );
		const count = COUNT( nodeIndex16, uint16Array );

		/* @if INDIRECT */

		intersectTris_indirect( bvh, side, ray, offset, count, intersects );

		/* @else */

		intersectTris( bvh, side, ray, offset, count, intersects );

		/* @endif */

	} else {

		const leftIndex = LEFT_NODE( nodeIndex32 );
		if ( intersectRay( leftIndex, float32Array, ray, _boxIntersection ) ) {

			_raycast( leftIndex, bvh, side, ray, intersects );

		}

		const rightIndex = RIGHT_NODE( nodeIndex32, uint32Array );
		if ( intersectRay( rightIndex, float32Array, ray, _boxIntersection ) ) {

			_raycast( rightIndex, bvh, side, ray, intersects );

		}

	}

}
