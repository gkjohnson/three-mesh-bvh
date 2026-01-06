import { Vector3, Matrix4 } from 'three';
import { BVH } from './BVH.js';
import { getRootIndexRanges, ensureIndex } from './build/geometryUtils.js';
import { iterateOverPoints } from './utils/pointIterationUtils.js';
import { iterateOverPoints_indirect } from './utils/pointIterationUtils.js';
import { FLOAT32_EPSILON, INTERSECTED, NOT_INTERSECTED } from './Constants.js';

export class PointsBVH extends BVH {

	get primitiveStride() {

		return 3;

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

	computePrimitiveBounds( offset, count, target = null ) {

		const indirectBuffer = this._indirectBuffer;
		const { geometry } = this;

		const posAttr = geometry.attributes.position;
		const needsIndirectBuffer = indirectBuffer && indirectBuffer !== posAttr.array;

		let result;
		if ( target ) {

			result = target;

		} else {

			// Use SharedArrayBuffer if the indirect buffer is a SharedArrayBuffer
			const BufferConstructor = needsIndirectBuffer && indirectBuffer.buffer instanceof SharedArrayBuffer
				? SharedArrayBuffer
				: ArrayBuffer;

			const buffer = new BufferConstructor( 6 * count * 4 );
			result = new Float32Array( buffer );

		}

		const boundsOffset = result.offset || 0;
		for ( let i = offset, end = offset + count; i < end; i ++ ) {

			const pointIndex = needsIndirectBuffer ? indirectBuffer[ i ] : i;
			const baseIndex = ( i - boundsOffset ) * 6;

			// Get point position
			const px = posAttr.getX( pointIndex );
			const py = posAttr.getY( pointIndex );
			const pz = posAttr.getZ( pointIndex );

			// For points, center equals position and half extents are zero (with epsilon for stability)
			const eps = FLOAT32_EPSILON * Math.max( Math.abs( px ), Math.abs( py ), Math.abs( pz ) );

			// [centerX, halfExtentX, centerY, halfExtentY, centerZ, halfExtentZ]
			result[ baseIndex + 0 ] = px;
			result[ baseIndex + 1 ] = eps;
			result[ baseIndex + 2 ] = py;
			result[ baseIndex + 3 ] = eps;
			result[ baseIndex + 4 ] = pz;
			result[ baseIndex + 5 ] = eps;

		}

		return result;

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

		// TODO: handle "firstHitOnly" correctly
		// TODO: use scratch variables
		const inverseMatrix = new Matrix4();
		inverseMatrix.copy( object.matrixWorld ).invert();

		const threshold = raycaster.params.Points.threshold;
		const localThreshold = threshold / ( ( object.scale.x + object.scale.y + object.scale.z ) / 3 );
		const localThresholdSq = localThreshold * localThreshold;

		const { firstHitOnly } = raycaster;
		const ray = raycaster.ray.clone().applyMatrix4( inverseMatrix );
		let closestDistance = Infinity;
		this.shapecast( {
			boundsTraverseOrder: box => {

				// traverse the closer bounds first.
				return box.distanceToPoint( ray.origin );

			},
			intersectsBounds: ( box, isLeaf, score ) => {

				// if we've already found a point that's closer then the full bounds then
				// don't traverse further.
				if ( score > closestDistance && firstHitOnly ) {

					return NOT_INTERSECTED;

				}

				box.expandByScalar( localThreshold );
				return ray.intersectsBox( box ) ? INTERSECTED : NOT_INTERSECTED;

			},
			intersectsPoint: point => {

				const distancesToRaySq = ray.distanceSqToPoint( point );
				if ( distancesToRaySq < localThresholdSq ) {

					// track the closest found point distance so we can early out traversal and only
					// use the closest point along the ray.
					const distanceToPoint = ray.origin.distanceTo( point );
					if ( distanceToPoint < closestDistance || firstHitOnly ) {

						closestDistance = distanceToPoint;

						point.applyMatrix4( object.matrixWorld );
						intersects.push( {
							point: point.clone(),
							distance: raycaster.ray.origin.distanceTo( point ),
						} );

					}

				}

			},
		} );

		return intersects;

	}

}
