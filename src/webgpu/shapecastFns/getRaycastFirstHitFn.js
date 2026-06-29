/** @import { BVHComputeData } from '../BVHComputeData.js' */
import { float } from 'three/tsl';
import { wgslTagFn } from '../nodes/WGSLTagFnNode.js';
import { rayStruct, rayIntersectionResultStruct, bvhNodeStruct, bvhNodeBoundsStruct } from '../tsl/structs.js';
import { intersectRayTriangle } from '../tsl/fns.js';

/**
 * Builds the `raycastFirstHit` shapecast function: traverses the BVH front to back and returns the
 * closest ray / triangle intersection.
 *
 * @private
 * @param {BVHComputeData} bvhData
 * @returns {Function} TSL function node for the TLAS traversal.
 */
export function getRaycastFirstHitFn( bvhData ) {

	// the generator owns the leaf loop + vertex fetch; "transforms" is only needed for the ray transform
	const { transforms } = bvhData.storage;

	const scratchRayScalar = float( 1.0 ).toVar( `bvh_rayScalar_${ Math.random().toString( 36 ).substring( 2, 7 ) }` );

	return bvhData.getShapecastFn( {
		name: 'bvh_RaycastFirstHit',
		shapeStruct: rayStruct,
		resultStruct: rayIntersectionResultStruct,

		boundsOrderFn: wgslTagFn/* wgsl */`
			fn getBoundsOrder( ray: ${ rayStruct }, splitAxis: u32, node: ${ bvhNodeStruct } ) -> bool {

				return ray.direction[ splitAxis ] >= 0.0;

			}
		`,
		intersectsBoundsFn: wgslTagFn/* wgsl */`
			fn rayIntersectsBounds( ray: ${ rayStruct }, bounds: ${ bvhNodeBoundsStruct }, result: ptr<function, ${ rayIntersectionResultStruct }> ) -> u32 {

				let boundsMin = vec3( bounds.min[0], bounds.min[1], bounds.min[2] );
				let boundsMax = vec3( bounds.max[0], bounds.max[1], bounds.max[2] );

				let invDir = 1.0 / ray.direction;
				let tMinPlane = ( boundsMin - ray.origin ) * invDir;
				let tMaxPlane = ( boundsMax - ray.origin ) * invDir;

				let tMinHit = vec3f(
					min( tMinPlane.x, tMaxPlane.x ),
					min( tMinPlane.y, tMaxPlane.y ),
					min( tMinPlane.z, tMaxPlane.z )
				);

				let tMaxHit = vec3f(
					max( tMinPlane.x, tMaxPlane.x ),
					max( tMinPlane.y, tMaxPlane.y ),
					max( tMinPlane.z, tMaxPlane.z )
				);

				let t0 = max( max( tMinHit.x, tMinHit.y ), tMinHit.z );
				let t1 = min( min( tMaxHit.x, tMaxHit.y ), tMaxHit.z );

				let dist = max( t0, 0.0 );
				if ( t1 < dist ) {

					return 0u;

				} else if ( result.didHit && dist * ${ scratchRayScalar } >= result.dist ) {

					return 0u;

				} else {

					return 1u;

				}

			}

		`,
		intersectTriangleFn: wgslTagFn/* wgsl */`
			fn intersectTriangle( ray: ${ rayStruct }, a: vec3f, b: vec3f, c: vec3f, indices: vec4u, result: ptr<function, ${ rayIntersectionResultStruct }> ) -> bool {

				var triResult = ${ intersectRayTriangle }( ray, a, b, c, 0.0 );
				triResult.dist *= ${ scratchRayScalar };
				if ( triResult.didHit && ( ! result.didHit || triResult.dist < result.dist ) ) {

					result.didHit = true;
					result.dist = triResult.dist;
					result.normal = triResult.normal;
					result.side = triResult.side;
					result.barycoord = triResult.barycoord;
					result.indices = indices;

					return true;

				}

				return false;

			}
		`,
		transformShapeFn: wgslTagFn/* wgsl */`
			fn transformRay( ray: ptr<function, ${ rayStruct }>, objectIndex: u32 ) -> void {

				let toLocal = ${ transforms }[ objectIndex ].inverseMatrixWorld;
				ray.origin = ( toLocal * vec4f( ray.origin, 1.0 ) ).xyz;
				ray.direction = ( toLocal * vec4f( ray.direction, 0.0 ) ).xyz;

				let len = length( ray.direction );
				ray.direction /= len;
				${ scratchRayScalar } = 1.0 / len;

			}
		`,
		transformResultFn: wgslTagFn/* wgsl */`
			fn transformResult( hit: ptr<function, ${ rayIntersectionResultStruct }>, objectIndex: u32 ) -> void {

				let toLocal = ${ transforms }[ objectIndex ].inverseMatrixWorld;
				hit.normal = normalize( ( transpose( toLocal ) * vec4f( hit.normal, 0.0 ) ).xyz );
				hit.objectIndex = objectIndex;

			}
		`,
		resetShapeFn: wgslTagFn/* wgsl */`
			fn resetRayScalar( objectIndex: u32 ) -> void {

				${ scratchRayScalar } = 1.0;

			}
		`,
	} );

}
