import { Vector3, Matrix4, Ray } from 'three';
import { BVH } from './BVH.js';
import { FLOAT32_EPSILON, INTERSECTED, NOT_INTERSECTED } from './Constants.js';
import { PrimitivePool } from '../utils/PrimitivePool.js';

const _inverseMatrix = /* @__PURE__ */ new Matrix4();
const _ray = /* @__PURE__ */ new Ray();
const _pointPool = /* @__PURE__ */ new PrimitivePool( () => new Vector3() );
export class PointsBVH extends BVH {

	get primitiveStride() {

		return 1;

	}

	get resolvePointIndex() {

		return this.resolvePrimitiveIndex;

	}

	// Implement abstract methods from BVH base class
	getPrimitiveCount() {

		return this.geometry.attributes.position.count;

	}

	computePrimitiveBounds( offset, count, targetBuffer ) {

		const indirectBuffer = this._indirectBuffer;
		const { geometry } = this;

		const posAttr = geometry.attributes.position;
		const boundsOffset = targetBuffer.offset || 0;
		for ( let i = offset, end = offset + count; i < end; i ++ ) {

			let pointIndex = indirectBuffer ? indirectBuffer[ i ] : i;
			if ( geometry.index ) {

				pointIndex = geometry.index.getX( pointIndex );

			}

			const baseIndex = ( i - boundsOffset ) * 6;
			const px = posAttr.getX( pointIndex );
			const py = posAttr.getY( pointIndex );
			const pz = posAttr.getZ( pointIndex );
			targetBuffer[ baseIndex + 0 ] = px;
			targetBuffer[ baseIndex + 1 ] = Math.abs( px ) * FLOAT32_EPSILON;
			targetBuffer[ baseIndex + 2 ] = py;
			targetBuffer[ baseIndex + 3 ] = Math.abs( py ) * FLOAT32_EPSILON;
			targetBuffer[ baseIndex + 4 ] = pz;
			targetBuffer[ baseIndex + 5 ] = Math.abs( pz ) * FLOAT32_EPSILON;

		}

		return targetBuffer;

	}

	shapecast( callbacks ) {

		// TODO: avoid unnecessary "iterate over points" function
		const point = _pointPool.getPrimitive();
		const result = super.shapecast(
			{
				...callbacks,
				intersectsPrimitive: callbacks.intersectsPoint,
				scratchPrimitive: point,
				iterateDirect: iterateOverPoints,
				iterateIndirect: iterateOverPoints,
			},
		);

		_pointPool.releasePrimitive( point );
		return result;

	}

	raycastObject3D( object, raycaster, intersects = [] ) {

		_inverseMatrix.copy( object.matrixWorld ).invert();
		_ray.copy( raycaster.ray ).applyMatrix4( _inverseMatrix );

		const threshold = raycaster.params.Points.threshold;
		const localThreshold = threshold / ( ( object.scale.x + object.scale.y + object.scale.z ) / 3 );
		const localThresholdSq = localThreshold * localThreshold;

		const { geometry } = this;
		const { firstHitOnly } = raycaster;

		let closestHit = null;
		let localClosestDistance = Infinity;
		this.shapecast( {
			boundsTraverseOrder: box => {

				// traverse the closer bounds first.
				return box.distanceToPoint( _ray.origin );

			},
			intersectsBounds: ( box, isLeaf, score ) => {

				// if we've already found a point that's closer then the full bounds then
				// don't traverse further.
				if ( score > localClosestDistance && firstHitOnly ) {

					return NOT_INTERSECTED;

				}

				box.expandByScalar( localThreshold );
				return _ray.intersectsBox( box ) ? INTERSECTED : NOT_INTERSECTED;

			},
			intersectsPoint: ( point, index ) => {

				const rayPointDistanceSq = _ray.distanceSqToPoint( point );
				if ( rayPointDistanceSq < localThresholdSq ) {

					// track the closest found point distance so we can early out traversal and only
					// use the closest point along the ray.
					const localDistanceToPoint = _ray.origin.distanceTo( point );
					if ( firstHitOnly && localDistanceToPoint > localClosestDistance ) {

						return;

					}

					// get intersection point
					const intersectPoint = new Vector3();
					_ray.closestPointToPoint( point, intersectPoint );
					intersectPoint.applyMatrix4( object.matrixWorld );

					// check if it's within the raycast rnge
					const distance = raycaster.ray.origin.distanceTo( intersectPoint );
					if ( distance < raycaster.near || distance > raycaster.far ) {

						return;

					}

					localClosestDistance = localDistanceToPoint;

					index = this.resolvePointIndex( index );

					closestHit = {
						distance,
						// TODO: this doesn't seem right?
						distanceToRay: Math.sqrt( rayPointDistanceSq ),
						point: intersectPoint,
						index: geometry.index ? geometry.index.getX( index ) : index,
						face: null,
						faceIndex: null,
						barycoord: null,
						object,
					};

					if ( ! raycaster.firstHitOnly ) {

						intersects.push( closestHit );

					}


				}

			},
		} );

		if ( raycaster.firstHitOnly ) {

			intersects.push( closestHit );

		}

		return intersects;

	}

}

function iterateOverPoints(
	offset,
	count,
	bvh,
	intersectsPointFunc,
	contained,
	depth,
	point
) {

	const { geometry } = bvh;
	const { index } = geometry;
	const pos = geometry.attributes.position;

	for ( let i = offset, l = count + offset; i < l; i ++ ) {

		const prim = bvh.resolvePointIndex( i );
		const vertexIndex = index ? index.array[ prim ] : prim;
		point.fromBufferAttribute( pos, vertexIndex );

		if ( intersectsPointFunc( point, i, contained, depth ) ) {

			return true;

		}

	}

	return false;

}
