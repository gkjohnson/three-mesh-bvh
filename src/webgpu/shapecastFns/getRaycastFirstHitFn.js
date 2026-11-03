/** @import { BVHComputeData } from '../BVHComputeData.js' */
import { float } from 'three/tsl';
import { wgslTagFn } from '../nodes/WGSLTagFnNode.js';
import { rayStruct, rayIntersectionResultStruct, bvhNodeStruct, bvhNodeBoundsStruct } from '../tsl/structs.js';
import { intersectRayTriangle } from '../tsl/fns.js';
import { rayBoundsDistance } from './rayShapecastUtils.js';

/**
 * Builds the `raycastFirstHit` shapecast function: traverses the BVH front to back and returns the
 * closest ray / triangle intersection.
 *
 * @private
 * @param {BVHComputeData} bvhData
 * @returns {Function} TSL function node for the TLAS traversal.
 */
export function getRaycastFirstHitFn( bvhData ) {

	// these are proxy nodes, so they can be referenced before the storage buffers exist
	const { index, attributes, transforms } = bvhData.storage;

	const scratchRayScalar = float( 1.0 ).toVar( 'bvh_rayScalar' );

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

				let dist = ${ rayBoundsDistance }( ray, bounds ) * ${ scratchRayScalar };
				if ( dist < 0.0 ) {

					return 0u;

				} else if ( ray.maxDist > 0.0 && dist >= ray.maxDist ) {

					return 0u;

				} else if ( result.didHit && dist >= result.dist ) {

					return 0u;

				} else {

					return 1u;

				}

			}

		`,
		intersectRangeFn: wgslTagFn/* wgsl */`
			fn intersectRange( ray: ${ rayStruct }, offset: u32, count: u32, result: ptr<function, ${ rayIntersectionResultStruct }> ) -> bool {

				var didHit = false;
				for ( var ti = offset; ti < offset + count; ti = ti + 1u ) {

					let i0 = ${ index }[ ti * 3u ];
					let i1 = ${ index }[ ti * 3u + 1u ];
					let i2 = ${ index }[ ti * 3u + 2u ];

					let a = ${ attributes }[ i0 ].position.xyz;
					let b = ${ attributes }[ i1 ].position.xyz;
					let c = ${ attributes }[ i2 ].position.xyz;

					var triResult = ${ intersectRayTriangle }( ray, a, b, c, 0.0 );
					triResult.dist *= ${ scratchRayScalar };
					if ( triResult.didHit && ( ray.maxDist <= 0.0 || triResult.dist < ray.maxDist ) && ( ! result.didHit || triResult.dist < result.dist ) ) {

						result.didHit = true;
						result.dist = triResult.dist;
						result.normal = triResult.normal;
						result.side = triResult.side;
						result.barycoord = triResult.barycoord;
						result.indices = vec4u( i0, i1, i2, ti );

						didHit = true;

					}

				}

				return didHit;

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
