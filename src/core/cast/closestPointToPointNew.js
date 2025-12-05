import { Vector3 } from 'three';
import { ExtendedTrianglePool } from '../../utils/ExtendedTrianglePool.js';
import { BufferStack } from '../utils/BufferStack.js';
import { closestDistanceSquaredPointToBox } from '../utils/distanceUtils.js';
import { iterateOverTriangles } from '../utils/iterationUtils.generated.js';
import { iterateOverTriangles_indirect } from '../utils/iterationUtils_indirect.generated.js';
import { COUNT, IS_LEAF, LEFT_NODE, OFFSET, RIGHT_NODE } from '../utils/nodeBufferUtils.js';

const temp = /* @__PURE__ */ new Vector3();
const temp1 = /* @__PURE__ */ new Vector3();

export function closestPointToPoint/* @echo INDIRECT_STRING */(
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

	_closestPointToPoint( root );

	BufferStack.clearBuffer();
	ExtendedTrianglePool.releasePrimitive( triangle );

	if ( closestDistanceSq === Infinity ) return null;

	const closestDistance = Math.sqrt( closestDistanceSq );

	if ( ! target.point ) target.point = temp1.clone();
	else target.point.copy( temp1 );
	target.distance = closestDistance;
	target.faceIndex = closestDistanceTriIndex;

	return target;


	// early out if under minThreshold
	// skip checking if over maxThreshold
	// set minThreshold = maxThreshold to quickly check if a point is within a threshold
	// returns Infinity if no value found
	function _closestPointToPoint( nodeIndex32 ) {

		const nodeIndex16 = nodeIndex32 * 2;
		const isLeaf = IS_LEAF( nodeIndex16, uint16Array );
		if ( isLeaf ) {

			const offset = OFFSET( nodeIndex32, uint32Array );
			const count = COUNT( nodeIndex16, uint16Array );

			return iterateOverTrianglesFunc( offset, count, bvh, intersectTriangle, null, null, triangle );

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

		return false;

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
