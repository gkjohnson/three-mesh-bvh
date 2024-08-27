import { Vector3 } from 'three';
import { COUNT, OFFSET, LEFT_NODE, RIGHT_NODE, IS_LEAF } from '../utils/nodeBufferUtils.js';
import { BufferStack } from '../utils/BufferStack.js';
import { ExtendedTrianglePool } from '../../utils/ExtendedTrianglePool.js';
import { setTriangle } from '../../utils/TriangleUtilities.js';
import { closestDistanceSquaredPointToBox } from '../utils/distanceUtils.js';
import { SortedListDesc } from '../utils/SortedListDesc.js';

const temp = /* @__PURE__ */ new Vector3();
const temp1 = /* @__PURE__ */ new Vector3();
const sortedList = new SortedListDesc();

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

	const { geometry } = bvh;
	const { index } = geometry;
	const pos = geometry.attributes.position;
	const triangle = ExtendedTrianglePool.getPrimitive();

	sortedList.clear();
	BufferStack.setBuffer( bvh._roots[ root ] );
	const { float32Array, uint16Array, uint32Array } = BufferStack;

	let node = { nodeIndex32: 0, distance: closestDistanceSquaredPointToBox( 0, float32Array, point ) };

	do {

		const { distance } = node;

		if ( distance >= closestDistanceSq ) return;

		const { nodeIndex32 } = node;

		const nodeIndex16 = nodeIndex32 * 2;
		const isLeaf = IS_LEAF( nodeIndex16, uint16Array );
		if ( isLeaf ) {

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

					if ( distSq < minThresholdSq ) return true;

				}

			}

			continue;

		}

		const leftIndex = LEFT_NODE( nodeIndex32 );
		const rightIndex = RIGHT_NODE( nodeIndex32, uint32Array );

		const leftDistance = closestDistanceSquaredPointToBox( leftIndex, float32Array, point );
		const rightDistance = closestDistanceSquaredPointToBox( rightIndex, float32Array, point );

		if ( leftDistance < closestDistanceSq && leftDistance < maxThresholdSq ) {

			sortedList.push( { nodeIndex32: leftIndex, distance: leftDistance } );

		}

		if ( rightDistance < closestDistanceSq && rightDistance < maxThresholdSq ) {

			sortedList.push( { nodeIndex32: rightIndex, distance: rightDistance } );

		}

	} while ( node = sortedList.pop() );

	BufferStack.clearBuffer();

	if ( closestDistanceSq === Infinity ) return null;

	const closestDistance = Math.sqrt( closestDistanceSq );

	if ( ! target.point ) target.point = temp1.clone();
	else target.point.copy( temp1 );
	target.distance = closestDistance;
	target.faceIndex = closestDistanceTriIndex;

	return target;

}
