/** @import { BVHComputeData } from '../BVHComputeData.js' */
import { wgslTagFn } from '../nodes/WGSLTagFnNode.js';

/**
 * Builds the `sampleTrianglePoint` function: interpolates the per-vertex attributes of a triangle
 * at the given barycentric coordinate. The body emits one line per attribute, so this must be built
 * after `update` has resolved the attribute layout.
 *
 * @private
 * @param {BVHComputeData} bvhData
 * @param {{members:Array<Object>,stride:number}} layout
 * @returns {Function} TSL function node.
 */
export function getSampleTrianglePointFn( bvhData, layout ) {

	const { fns, structs } = bvhData;

	const interpolateBody = layout
		.members
		.map( ( { name, scalar } ) => {

			// integers can't be blended, so take the value of the nearest corner
			if ( scalar !== 'f' ) {

				return `result.${ name } = select( select( a2.${ name }, a1.${ name }, barycoord.y >= barycoord.z ), a0.${ name }, barycoord.x >= max( barycoord.y, barycoord.z ) );`;

			}

			return `result.${ name } = a0.${ name } * barycoord.x + a1.${ name } * barycoord.y + a2.${ name } * barycoord.z;`;

		} ).join( '\n' );

	return wgslTagFn/* wgsl */`
		// fn
		fn bvh_sampleTrianglePoint( barycoord: vec3f, indices: vec3u ) -> ${ structs.attributes } {

			var result: ${ structs.attributes };
			var a0 = ${ fns.getVertex }( indices.x );
			var a1 = ${ fns.getVertex }( indices.y );
			var a2 = ${ fns.getVertex }( indices.z );
			${ interpolateBody }
			return result;

		}
	`;

}
