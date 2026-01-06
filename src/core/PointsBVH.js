import { Vector3, Matrix4 } from 'three';
import { BVH } from './BVH.js';
import { getRootIndexRanges, ensureIndex } from './build/geometryUtils.js';
import { iterateOverPoints } from './utils/pointIterationUtils.js';
import { iterateOverPoints_indirect } from './utils/pointIterationUtils.js';
import { FLOAT32_EPSILON, INTERSECTED, NOT_INTERSECTED } from './Constants.js';

const _inverseMatrix = /* @__PURE__ */ new Matrix4();

export class PointsBVH extends BVH {

	get primitiveStride() {

		return 1;

	}

	get resolvePointIndex() {

		return this.resolvePrimitiveIndex;

	}

	constructor( geometry, options = {} ) {

		// call parent constructor which handles tree building and bounding box
		super( geometry, {
			...options,

			// TODO: remove any "indirect=false" logic from the class once behavior is decided
			indirect: true,
		} );

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

			const pointIndex = indirectBuffer ? indirectBuffer[ i ] : i;
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

	getBuildRanges( options ) {

		if ( options.indirect ) {

			// For indirect mode, return ranges for generating the indirect buffer
			return getRootIndexRanges( this.geometry, options.range, 1 );

		} else {

			// For direct mode, ensure index exists (needed for BVH partitioning) and return ranges
			ensureIndex( this.geometry, options );
			return getRootIndexRanges( this.geometry, options.range, 1 );

		}

	}

	shapecast( callbacks ) {

		// TODO: use pool for primitive
		// TODO: avoid unnecessary "iterate over points" function
		const point = new Vector3();
		return this._shapecast(
			iterateOverPoints,
			iterateOverPoints_indirect,
			{
				...callbacks,
				intersectsPrimitive: callbacks.intersectsPoint,
				scratchPrimitive: point,
			},
		);

	}

	raycastObject3D( object, raycaster, intersects = [] ) {

		_inverseMatrix.copy( object.matrixWorld ).invert();

		const threshold = raycaster.params.Points.threshold;
		const localThreshold = threshold / ( ( object.scale.x + object.scale.y + object.scale.z ) / 3 );
		const localThresholdSq = localThreshold * localThreshold;

		const { geometry } = this;
		const { firstHitOnly } = raycaster;
		const ray = raycaster.ray.clone().applyMatrix4( _inverseMatrix );
		let closestHit = null;
		let localClosestDistance = Infinity;
		this.shapecast( {
			boundsTraverseOrder: box => {

				// traverse the closer bounds first.
				return box.distanceToPoint( ray.origin );

			},
			intersectsBounds: ( box, isLeaf, score ) => {

				// if we've already found a point that's closer then the full bounds then
				// don't traverse further.
				if ( score > localClosestDistance && firstHitOnly ) {

					return NOT_INTERSECTED;

				}

				box.expandByScalar( localThreshold );
				return ray.intersectsBox( box ) ? INTERSECTED : NOT_INTERSECTED;

			},
			intersectsPoint: ( point, index ) => {

				const rayPointDistanceSq = ray.distanceSqToPoint( point );
				if ( rayPointDistanceSq < localThresholdSq ) {

					// track the closest found point distance so we can early out traversal and only
					// use the closest point along the ray.
					const localDistanceToPoint = ray.origin.distanceTo( point );
					if ( localDistanceToPoint < localClosestDistance || ! firstHitOnly ) {

						const intersectPoint = new Vector3();
						ray.closestPointToPoint( point, intersectPoint );
						intersectPoint.applyMatrix4( object.matrixWorld );

						const distance = raycaster.ray.origin.distanceTo( intersectPoint );
						if ( distance < raycaster.near || distance > raycaster.far ) {

							return;

						}

						localClosestDistance = localDistanceToPoint;

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

				}

			},
		} );

		if ( raycaster.firstHitOnly ) {

			intersects.push( closestHit );

		}

		return intersects;

	}

}
