/** @import { BVHComputeData } from '../BVHComputeData.js' */
import { wgslTagFn } from '../nodes/WGSLTagFnNode.js';

/**
 * Builds the `sampleTrianglePoint` function: interpolates the per-vertex attributes of a triangle
 * at the given barycentric coordinate. The body emits one line per attribute, so this must be built
 * after `update` has resolved the attribute struct.
 *
 * @private
 * @param {BVHComputeData} bvhData
 * @returns {Function} TSL function node.
 */
export function getSampleTrianglePointFn( bvhData ) {

	const { storage, structs } = bvhData;

	const interpolateBody = structs
		.attributes
		.membersLayout
		.map( ( { name } ) => {

			return `result.${ name } = a0.${ name } * barycoord.x + a1.${ name } * barycoord.y + a2.${ name } * barycoord.z;`;

		} ).join( '\n' );

	return wgslTagFn/* wgsl */`
		// fn
		fn bvh_sampleTrianglePoint( barycoord: vec3f, indices: vec3u ) -> ${ structs.attributes } {

			var result: ${ structs.attributes };
			var a0 = ${ storage.attributes }[ indices.x ];
			var a1 = ${ storage.attributes }[ indices.y ];
			var a2 = ${ storage.attributes }[ indices.z ];
			${ interpolateBody }
			return result;

		}
	`;

}
