/** @import { BVHComputeData } from '../BVHComputeData.js' */
import { wgslTagFn } from '../nodes/WGSLTagFnNode.js';
import { rayStruct, rayIntersectionResultStruct } from '../tsl/structs.js';
import { getRaycastFirstHitFn } from './getRaycastFirstHitFn.js';

/**
 * Builds an occlusion query that returns immediately after the first triangle hit.
 * Uses the same two-sided triangle and exclusive maxDist conventions as raycastFirstHit.
 * No material or alpha acceptance test is applied.
 * @private
 * @param {BVHComputeData} bvhData
 * @returns {Function}
 */
export function getRaycastAnyHitFn( bvhData ) {

	const traversal = getRaycastFirstHitFn( bvhData, true );
	return wgslTagFn`
		fn bvh_RaycastAnyHit( ray: ${ rayStruct } ) -> bool {

			var hit: ${ rayIntersectionResultStruct };
			return ${ traversal }( ray, &hit );

		}
	`;

}
