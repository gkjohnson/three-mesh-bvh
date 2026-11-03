/** @import { BVHComputeData } from '../BVHComputeData.js' */
import { float } from 'three/tsl';
import { wgslTagFn } from '../nodes/WGSLTagFnNode.js';
import { rayStruct, bvhNodeBoundsStruct } from '../tsl/structs.js';
import { intersectRayTriangle } from '../tsl/fns.js';
import { NOT_INTERSECTED, STOP_TRAVERSAL } from '../../core/Constants.js';
import { rayBoundsDistance } from './rayShapecastUtils.js';

/**
 * Builds the `raycastAnyHit` shapecast function: returns whether the ray hits any triangle, ending
 * the traversal at the first hit found.
 *
 * @private
 * @param {BVHComputeData} bvhData
 * @returns {Function} TSL function node for the TLAS traversal.
 */
export function getRaycastAnyHitFn( bvhData ) {

	// these are proxy nodes, so they can be referenced before the storage buffers exist
	const { index, attributes, transforms } = bvhData.storage;

	const scratchRayScalar = float( 1.0 ).toVar( 'bvh_rayScalarAnyHit' );

	return bvhData.getShapecastFn( {
		name: 'bvh_RaycastAnyHit',
		shapeStruct: rayStruct,

		intersectsBoundsFn: wgslTagFn/* wgsl */`
			fn rayIntersectsBoundsAnyHit( ray: ${ rayStruct }, bounds: ${ bvhNodeBoundsStruct } ) -> u32 {

				let dist = ${ rayBoundsDistance }( ray, bounds ) * ${ scratchRayScalar };
				return u32( dist >= 0.0 && ( ray.maxDist <= 0.0 || dist < ray.maxDist ) );

			}
		`,
		intersectRangeFn: wgslTagFn/* wgsl */`
			fn intersectRangeAnyHit( ray: ${ rayStruct }, offset: u32, count: u32 ) -> u32 {

				for ( var ti = offset; ti < offset + count; ti = ti + 1u ) {

					let a = ${ attributes }[ ${ index }[ ti * 3u ] ].position.xyz;
					let b = ${ attributes }[ ${ index }[ ti * 3u + 1u ] ].position.xyz;
					let c = ${ attributes }[ ${ index }[ ti * 3u + 2u ] ].position.xyz;

					let triResult = ${ intersectRayTriangle }( ray, a, b, c, 0.0 );
					if ( triResult.didHit && ( ray.maxDist <= 0.0 || triResult.dist * ${ scratchRayScalar } < ray.maxDist ) ) {

						return ${ STOP_TRAVERSAL }u;

					}

				}

				return ${ NOT_INTERSECTED }u;

			}
		`,
		transformShapeFn: wgslTagFn/* wgsl */`
			fn transformRayAnyHit( ray: ptr<function, ${ rayStruct }>, objectIndex: u32 ) -> void {

				let toLocal = ${ transforms }[ objectIndex ].inverseMatrixWorld;
				ray.origin = ( toLocal * vec4f( ray.origin, 1.0 ) ).xyz;
				ray.direction = ( toLocal * vec4f( ray.direction, 0.0 ) ).xyz;

				let len = length( ray.direction );
				ray.direction /= len;
				${ scratchRayScalar } = 1.0 / len;

			}
		`,
		resetShapeFn: wgslTagFn/* wgsl */`
			fn resetRayScalarAnyHit( objectIndex: u32 ) -> void {

				${ scratchRayScalar } = 1.0;

			}
		`,
	} );

}
