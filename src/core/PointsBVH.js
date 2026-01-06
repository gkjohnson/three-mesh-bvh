import { Vector3, Matrix4 } from 'three';
import { BVH } from './BVH.js';
import { getRootIndexRanges } from './build/geometryUtils.js';
import { FLOAT32_EPSILON, INTERSECTED, NOT_INTERSECTED } from './Constants.js';
import { PrimitivePool } from '../utils/PrimitivePool.js';

const _inverseMatrix = /* @__PURE__ */ new Matrix4();
const _pointPool = /* @__PURE__ */ new PrimitivePool( () => new Vector3() );

export class PointsBVH extends BVH {

	get primitiveStride() {

		return 1;

	}

	get resolvePointIndex() {

		return this.resolvePrimitiveIndex;

	}

	constructor( geometry, options = {} ) {

		if ( ! geometry.index ) {

			// use "indirect = true" by default since using an index attribute seems to have
			// a performance impact
			options = {
				...options,
				indirect: true,
			};

		}

		// call parent constructor which handles tree building and bounding box
		super( geometry, options );

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

	getBuildRanges( options ) {

		if ( options.indirect ) {

			// For indirect mode, return ranges for generating the indirect buffer
			return getRootIndexRanges( this.geometry, options.range, 1 );

		} else {

			// For direct mode, ensure index exists (needed for BVH partitioning) and return ranges
			return getRootIndexRanges( this.geometry, options.range, 1 );

		}

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
