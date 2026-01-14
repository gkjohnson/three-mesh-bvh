import { Vector3, Matrix4, Ray, Box3 } from 'three';
import { INTERSECTED, NOT_INTERSECTED } from './Constants.js';
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

	writePrimitiveBounds( i, targetBuffer, baseIndex ) {

		const indirectBuffer = this._indirectBuffer;
		const { geometry } = this;
		const posAttr = geometry.attributes.position;
		const indexAttr = geometry.index;
		let pointIndex = indirectBuffer ? indirectBuffer[ i ] : i;
		if ( indexAttr ) {

			pointIndex = indexAttr.getX( pointIndex );

		}

		const px = posAttr.getX( pointIndex );
		const py = posAttr.getY( pointIndex );
		const pz = posAttr.getZ( pointIndex );

		// Write in min/max format [minx, miny, minz, maxx, maxy, maxz]
		// For points, min equals max (epsilon padding is applied in computePrimitiveBounds)
		targetBuffer[ baseIndex + 0 ] = px;
		targetBuffer[ baseIndex + 1 ] = py;
		targetBuffer[ baseIndex + 2 ] = pz;
		targetBuffer[ baseIndex + 3 ] = px;
		targetBuffer[ baseIndex + 4 ] = py;
		targetBuffer[ baseIndex + 5 ] = pz;

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
