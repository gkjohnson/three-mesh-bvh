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

export function closestPointToPointHybrid/* @echo INDIRECT_STRING */(
	bvh,
	root,
	point,
	target,
	maxDepthSorted,
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

	sortedList.clear();

	if ( maxDepthSorted > 0 ) {

		_fillSortedList( root, 0 );

	} else {

		sortedList.push( { nodeIndex32: root, distance: closestDistanceSquaredPointToBox( root, float32Array, point ) } );

	}

	const nodes = sortedList.array;
	for ( let i = nodes.length - 1; i >= 0; i -- ) {

		const { distance, nodeIndex32 } = nodes[ i ];

		if ( distance >= closestDistanceSq ) break;

		_closestPointToPoint( nodeIndex32 );

	}

	BufferStack.clearBuffer();

	if ( closestDistanceSq === Infinity ) return null;

	const closestDistance = Math.sqrt( closestDistanceSq );

	if ( ! target.point ) target.point = temp1.clone();
	else target.point.copy( temp1 );
	target.distance = closestDistance;
	target.faceIndex = closestDistanceTriIndex;

	return target;


	function _fillSortedList( nodeIndex32, depth ) {

		const nodeIndex16 = nodeIndex32 * 2;
		const isLeaf = IS_LEAF( nodeIndex16, uint16Array );
		if ( isLeaf ) {

			sortedList.push( { nodeIndex32, distance: closestDistanceSquaredPointToBox( nodeIndex32, float32Array, point ) } );

			return;

		}

		const leftIndex = LEFT_NODE( nodeIndex32 );
		const rightIndex = RIGHT_NODE( nodeIndex32, uint32Array );

		if ( depth === maxDepthSorted ) {

			const leftDistance = closestDistanceSquaredPointToBox( leftIndex, float32Array, point );
			const rightDistance = closestDistanceSquaredPointToBox( rightIndex, float32Array, point );

			if ( leftDistance > rightDistance ) { // leftDistance < maxThresholdSq - consider this?

				sortedList.push( { nodeIndex32: leftIndex, distance: leftDistance } );
				sortedList.push( { nodeIndex32: rightIndex, distance: rightDistance } );

			} else {

				sortedList.push( { nodeIndex32: rightIndex, distance: rightDistance } );
				sortedList.push( { nodeIndex32: leftIndex, distance: leftDistance } );

			}

			return;

		}

		_fillSortedList( leftIndex, depth + 1 );
		_fillSortedList( rightIndex, depth + 1 );

	}


	function _closestPointToPoint( nodeIndex32 ) {

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

			return;

		}

		const leftIndex = LEFT_NODE( nodeIndex32 );
		const rightIndex = RIGHT_NODE( nodeIndex32, uint32Array );

		const leftDistance = closestDistanceSquaredPointToBox( leftIndex, float32Array, point );
		const rightDistance = closestDistanceSquaredPointToBox( rightIndex, float32Array, point );

		if ( leftDistance <= rightDistance ) {

			if ( leftDistance < closestDistanceSq && leftDistance < maxThresholdSq ) {

				if ( _closestPointToPoint( leftIndex ) ) return true;
				if ( rightDistance < closestDistanceSq ) return _closestPointToPoint( rightIndex );

			}

		} else if ( rightDistance < closestDistanceSq && rightDistance < maxThresholdSq ) {

			if ( _closestPointToPoint( rightIndex ) ) return true;
			if ( leftDistance < closestDistanceSq ) return _closestPointToPoint( leftIndex );

		}

	}

}
