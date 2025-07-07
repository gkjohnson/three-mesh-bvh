import { Vector3 } from 'three';
import { COUNT, OFFSET, LEFT_NODE, RIGHT_NODE, IS_LEAF } from '../utils/nodeBufferUtils.js';
import { BufferStack } from '../utils/BufferStack.js';
import { ExtendedTrianglePool } from '../../utils/ExtendedTrianglePool.js';
import { setTriangle } from '../../utils/TriangleUtilities.js';
import { closestDistanceSquaredPointToBox } from '../utils/distanceUtils.js';
import { HeapQueue } from '../utils/heapQueue.js';

const temp = /* @__PURE__ */ new Vector3();
const temp1 = /* @__PURE__ */ new Vector3();
const heapQueue = new HeapQueue();

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
	BufferStack.setBuffer( bvh._roots[ root ] );

	const { geometry } = bvh;
	const { index } = geometry;
	const pos = geometry.attributes.position;
	const triangle = ExtendedTrianglePool.getPrimitive();
	const { float32Array, uint16Array, uint32Array } = BufferStack;
	heapQueue.reset();

	_closestPointToPoint( { nodeIndex32: 0, distance: closestDistanceSquaredPointToBox( 0, float32Array, point ) } );

	BufferStack.clearBuffer();

	if ( closestDistanceSq === Infinity ) return null;

	const closestDistance = Math.sqrt( closestDistanceSq );

	if ( ! target.point ) target.point = temp1.clone();
	else target.point.copy( temp1 );
	target.distance = closestDistance;
	target.faceIndex = closestDistanceTriIndex;

	return target;


	function _closestPointToPoint( node ) {

		const minHeap = heapQueue.getMinHeap();

		do {

			const { distance, nodeIndex32 } = node;

			if ( distance >= closestDistanceSq ) return;

			const leftIndex = LEFT_NODE( nodeIndex32 );
			const rightIndex = RIGHT_NODE( nodeIndex32, uint32Array );

			const isLeftLeaf = IS_LEAF( leftIndex * 2, uint16Array );
			const isRightLeaf = IS_LEAF( rightIndex * 2, uint16Array );

			if ( isLeftLeaf && isRightLeaf ) {

				const leftDistance = closestDistanceSquaredPointToBox( leftIndex, float32Array, point );
				const rightDistance = closestDistanceSquaredPointToBox( rightIndex, float32Array, point );

				if ( leftDistance < rightDistance ) {

					test( leftIndex );
					if ( rightDistance >= closestDistanceSq ) continue;
					test( rightIndex );

				} else {

					test( rightIndex );
					if ( leftDistance >= closestDistanceSq ) continue;
					test( leftIndex );

				}

			} else if ( minHeap.isFull() ) { // secondo me andrebbe sopra

				_closestPointToPoint( node );

			} else {

				if ( isLeftLeaf ) {

					test( leftIndex ); // fare solo se distanza minore?

					const rightDistance = closestDistanceSquaredPointToBox( rightIndex, float32Array, point );

					if ( rightDistance < closestDistanceSq && rightDistance < maxThresholdSq ) {

						minHeap.add( { nodeIndex32: rightIndex, distance: rightDistance } );

					}

				} else if ( isRightLeaf ) {

					test( rightIndex ); // fare solo se distanza minore?

					const leftDistance = closestDistanceSquaredPointToBox( leftIndex, float32Array, point );

					if ( leftDistance < closestDistanceSq && leftDistance < maxThresholdSq ) {

						minHeap.add( { nodeIndex32: leftIndex, distance: leftDistance } );

					}

				} else {

					const leftDistance = closestDistanceSquaredPointToBox( leftIndex, float32Array, point );
					const rightDistance = closestDistanceSquaredPointToBox( rightIndex, float32Array, point );

					if ( leftDistance < closestDistanceSq && leftDistance < maxThresholdSq ) {

						minHeap.add( { nodeIndex32: leftIndex, distance: leftDistance } );

					}

					if ( rightDistance < closestDistanceSq && rightDistance < maxThresholdSq ) {

						minHeap.add( { nodeIndex32: rightIndex, distance: rightDistance } );

					}

				}

			}

		} while ( ( node = minHeap.poll() ) );

	}


	function test( nodeIndex32 ) {

		const nodeIndex16 = nodeIndex32 * 2;

		const offset = OFFSET( nodeIndex32, uint32Array );
		const count = COUNT( nodeIndex16, uint16Array );

		for ( let i = offset, l = count + offset; i < l; i ++ ) {

			/* @if INDIRECT */

			const ti = bvh.resolveTriangleIndex( i );
			setTriangle( triangle, 3 * ti, index, pos );

			/* @else */

			setTriangle( triangle, i * 3, index, pos );

			/* @endif */

			triangle.needsUpdate = true;

			triangle.closestPointToPoint( point, temp );
			const distSq = point.distanceToSquared( temp );
			if ( distSq < closestDistanceSq ) {

				temp1.copy( temp );
				closestDistanceSq = distSq;
				closestDistanceTriIndex = i;

				if ( distSq < minThresholdSq ) return;

			}

		}

	}

}
