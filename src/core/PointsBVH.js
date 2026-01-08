import { Vector3, Matrix4, Ray, Box3 } from 'three';
import { FLOAT32_EPSILON, INTERSECTED, NOT_INTERSECTED } from './Constants.js';
import { PrimitivePool } from '../utils/PrimitivePool.js';
import { GeometryBVH } from './GeometryBVH.js';

const _inverseMatrix = /* @__PURE__ */ new Matrix4();
const _ray = /* @__PURE__ */ new Ray();
const _pointPool = /* @__PURE__ */ new PrimitivePool( () => new Vector3() );
const _box = /* @__PURE__ */ new Box3();

export class PointsBVH extends GeometryBVH {

	get primitiveStride() {

		return 1;

	}

	// Implement abstract methods from BVH base class
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

		const { geometry } = this;
		const { matrixWorld } = object;
		const { firstHitOnly } = raycaster;

		_inverseMatrix.copy( matrixWorld ).invert();
		_ray.copy( raycaster.ray ).applyMatrix4( _inverseMatrix );

		const threshold = raycaster.params.Points.threshold;
		const localThreshold = threshold / ( ( object.scale.x + object.scale.y + object.scale.z ) / 3 );
		const localThresholdSq = localThreshold * localThreshold;

		let closestHit = null;
		let closestDistance = Infinity;
		this.shapecast( {
			boundsTraverseOrder: box => {

				return box.distanceToPoint( _ray.origin );

			},
			intersectsBounds: box => {

				// TODO: for some reason trying to early-out here is causing firstHitOnly tests to fail
				_box.copy( box ).expandByScalar( Math.abs( localThreshold ) );
				return _ray.intersectsBox( _box ) ? INTERSECTED : NOT_INTERSECTED;

			},
			intersectsPoint: ( point, index ) => {

				const rayPointDistanceSq = _ray.distanceSqToPoint( point );
				if ( rayPointDistanceSq < localThresholdSq ) {

					const intersectPoint = new Vector3();

					_ray.closestPointToPoint( point, intersectPoint );
					intersectPoint.applyMatrix4( matrixWorld );

					const distance = raycaster.ray.origin.distanceTo( intersectPoint );

					if ( distance < raycaster.near || distance > raycaster.far ) return;

					if ( firstHitOnly && distance >= closestDistance ) return;
					closestDistance = distance;

					index = this.resolvePrimitiveIndex( index );

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

					if ( ! firstHitOnly ) {

						intersects.push( closestHit );

					}

				}

			},
		} );

		if ( firstHitOnly && closestHit ) {

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

		const prim = bvh.resolvePrimitiveIndex( i );
		const vertexIndex = index ? index.array[ prim ] : prim;
		point.fromBufferAttribute( pos, vertexIndex );

		if ( intersectsPointFunc( point, i, contained, depth ) ) {

			return true;

		}

	}

	return false;

}
