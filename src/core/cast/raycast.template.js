import { intersectRay } from '../utils/intersectUtils.js';
import { COUNT, OFFSET, LEFT_NODE, RIGHT_NODE, IS_LEAF } from '../utils/nodeBufferUtils.js';
import { BufferStack } from '../utils/BufferStack.js';
import { intersectTris } from '../utils/iterationUtils.generated.js';
import { intersectTris_indirect } from '../utils/iterationUtils_indirect.generated.js';

const origin = new Float64Array(3);
const dirInv = new Float64Array(3);
const sign = new Int8Array(3);

export function raycast/* @echo INDIRECT_STRING */( bvh, root, side, ray, intersects ) {

    // const distance = raycaster.far;

    origin[0] = ray.origin.x;
    origin[1] = ray.origin.y;
    origin[2] = ray.origin.z;

    dirInv[0] = 1 / ray.direction.x;
    dirInv[1] = 1 / ray.direction.y;
    dirInv[2] = 1 / ray.direction.z;

    sign[0] = dirInv[0] < 0 ? 3 : 0;
    sign[1] = dirInv[1] < 0 ? 3 : 0;
    sign[2] = dirInv[2] < 0 ? 3 : 0;


	BufferStack.setBuffer( bvh._roots[ root ] );
	_raycast( 0, bvh, side, ray, intersects);
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
		if ( intersectRay( leftIndex, float32Array, origin, dirInv, sign ) ) {

			_raycast( leftIndex, bvh, side, ray, intersects );

		}

		const rightIndex = RIGHT_NODE( nodeIndex32, uint32Array );
		if ( intersectRay( rightIndex, float32Array, origin, dirInv, sign ) ) {

			_raycast( rightIndex, bvh, side, ray, intersects );

		}

	}

}
