import { Vector3 } from 'three';
import { ExtendedTrianglePool } from '../../utils/ExtendedTrianglePool.js';
import { BufferStack } from '../utils/BufferStack.js';
import { iterateOverTriangles } from '../utils/iterationUtils.generated.js';
import { iterateOverTriangles_indirect } from '../utils/iterationUtils_indirect.generated.js';
import { closestDistanceSquaredPointToBox } from '../utils/distanceUtils.js';
import { MinHeap } from '../utils/minHeap.js';
import { COUNT, IS_LEAF, LEFT_NODE, OFFSET, RIGHT_NODE } from '../utils/nodeBufferUtils.js';

const temp = /* @__PURE__ */ new Vector3();
const temp1 = /* @__PURE__ */ new Vector3();
const minHeap = new MinHeap();
// const heapQueue = new HeapQueue();

export function closestPointToPointSort/* @echo INDIRECT_STRING */(
	bvh,
	root,
	point,
	target,
	minThreshold,
	maxThreshold
) {

	const minThresholdSq = minThreshold * minThreshold;
	const maxThresholdSq = maxThreshold * maxThreshold;
	let closestDistanceSq = Infinity;
	let closestDistanceTriIndex = null;

	const triangle = ExtendedTrianglePool.getPrimitive();

	const iterateOverTrianglesFunc = bvh.indirect ? iterateOverTriangles_indirect : iterateOverTriangles;

	BufferStack.setBuffer( bvh._roots[ root ] );
	const { float32Array, uint16Array, uint32Array } = BufferStack;
	// heapQueue.reset();

	_closestPointToPoint( { nodeIndex32: 0, distance: closestDistanceSquaredPointToBox( 0, float32Array, point ) } );

	BufferStack.clearBuffer();
	ExtendedTrianglePool.releasePrimitive( triangle );

	if ( closestDistanceSq === Infinity ) return null;

	const closestDistance = Math.sqrt( closestDistanceSq );

	if ( ! target.point ) target.point = temp1.clone();
	else target.point.copy( temp1 );
	target.distance = closestDistance;
	target.faceIndex = closestDistanceTriIndex;

	return target;


	function _closestPointToPoint( node ) {

		// const minHeap = heapQueue.getMinHeap();
		minHeap.clear();

		do {

			const { distance, nodeIndex32 } = node;

			if ( distance >= closestDistanceSq ) return;

			const nodeIndex16 = nodeIndex32 * 2;
			const isLeaf = IS_LEAF( nodeIndex16, uint16Array );
			if ( isLeaf ) {

				const offset = OFFSET( nodeIndex32, uint32Array );
				const count = COUNT( nodeIndex16, uint16Array );
				if ( iterateOverTrianglesFunc( offset, count, bvh, intersectTriangle, null, null, triangle ) ) return true;

			} else if ( minHeap.isFull() ) {

				_closestPointToPointRecursive( nodeIndex32 );
				// or we can use _closestPointToPoint( node ) if we want to use minHeap again;

			} else {

				const leftIndex = LEFT_NODE( nodeIndex32 );
				const rightIndex = RIGHT_NODE( nodeIndex32, uint32Array );

				const leftDistance = closestDistanceSquaredPointToBox( leftIndex, float32Array, point );
				const rightDistance = closestDistanceSquaredPointToBox( rightIndex, float32Array, point );

				if ( leftDistance < closestDistanceSq && leftDistance < maxThresholdSq ) {

					minHeap.add( { nodeIndex32: leftIndex, distance: leftDistance } );

				}

				if ( rightDistance < closestDistanceSq && rightDistance < maxThresholdSq ) {

					minHeap.add( { nodeIndex32: rightIndex, distance: rightDistance } );

				}

			}

		} while ( ( node = minHeap.poll() ) );

	}


	function _closestPointToPointRecursive( nodeIndex32 ) {

		const nodeIndex16 = nodeIndex32 * 2;
		const isLeaf = IS_LEAF( nodeIndex16, uint16Array );
		if ( isLeaf ) {

			const offset = OFFSET( nodeIndex32, uint32Array );
			const count = COUNT( nodeIndex16, uint16Array );
			return iterateOverTrianglesFunc( offset, count, bvh, intersectTriangle, null, null, triangle );

		} else {

			const leftIndex = LEFT_NODE( nodeIndex32 );
			const rightIndex = RIGHT_NODE( nodeIndex32, uint32Array );

			const leftDistance = closestDistanceSquaredPointToBox( leftIndex, float32Array, point );
			const rightDistance = closestDistanceSquaredPointToBox( rightIndex, float32Array, point );

			if ( leftDistance <= rightDistance ) {

				if ( leftDistance < closestDistanceSq && leftDistance < maxThresholdSq ) {

					if ( _closestPointToPointRecursive( leftIndex ) ) return true;
					if ( rightDistance < closestDistanceSq ) return _closestPointToPointRecursive( rightIndex );

				}

			} else if ( rightDistance < closestDistanceSq && rightDistance < maxThresholdSq ) {

				if ( _closestPointToPointRecursive( rightIndex ) ) return true;
				if ( leftDistance < closestDistanceSq ) return _closestPointToPointRecursive( leftIndex );

			}

		}

	}

	function intersectTriangle( triangle, triIndex ) {

		triangle.closestPointToPoint( point, temp );
		const distSq = point.distanceToSquared( temp );
		if ( distSq < closestDistanceSq ) {

			temp1.copy( temp );
			closestDistanceSq = distSq;
			closestDistanceTriIndex = triIndex;

		}

		return distSq < minThresholdSq;

	}

}
