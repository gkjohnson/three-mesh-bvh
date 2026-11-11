/** @import { BVHComputeData } from '../BVHComputeData.js' */
/** @import { AttributeLayout } from '../utils/packBVHBufferUtils.js' */
import { wgslTagFn } from '../nodes/WGSLTagFnNode.js';

/**
 * Builds the `getVertex` function: reads the attributes of a vertex from the packed attribute buffer
 * into the attribute struct. The body emits one line per attribute, so this must be built after
 * `update` has resolved the attribute layout.
 *
 * @private
 * @param {BVHComputeData} bvhData
 * @param {AttributeLayout} layout
 * @returns {Function} TSL function node.
 */
export function getVertexFn( bvhData, layout ) {

	const { storage, structs } = bvhData;

	const readBody = layout
		.members
		.map( ( { name, offset, size } ) => {

			const x = offset;
			const y = offset + 1;
			const z = offset + 2;
			const w = offset + 3;
			if ( size === 1 ) {

				return /* wgsl */`
					result.${ name } = bitcast<f32>( ( *attributes )[ base + ${ x }u ] );
				`;

			} else if ( size === 2 ) {

				return /* wgsl */`
					result.${ name } = bitcast<vec2f>( vec2u(
						( *attributes )[ base + ${ x }u ],
						( *attributes )[ base + ${ y }u ],
					) );
				`;

			} else if ( size === 3 ) {

				return /* wgsl */`
					result.${ name } = bitcast<vec3f>( vec3u(
						( *attributes )[ base + ${ x }u ],
						( *attributes )[ base + ${ y }u ],
						( *attributes )[ base + ${ z }u ],
					) );
				`;

			} else {

				return /* wgsl */`
					result.${ name } = bitcast<vec4f>( vec4u(
						( *attributes )[ base + ${ x }u ],
						( *attributes )[ base + ${ y }u ],
						( *attributes )[ base + ${ z }u ],
						( *attributes )[ base + ${ w }u ],
					) );
				`;

			}

		} )
		.join( '\n' );

	return wgslTagFn/* wgsl */`
		// fn
		fn bvh_getVertex( index: u32 ) -> ${ structs.attributes } {

			let attributes = &${ storage.attributes };
			let base = index * ${ layout.stride }u;

			var result: ${ structs.attributes };
			${ readBody }
			return result;

		}
	`;

}

/**
 * Builds the `getVertexPosition` function: reads only the position of a vertex from the packed
 * attribute buffer, so traversal doesn't unpack the whole attribute struct.
 *
 * @private
 * @param {BVHComputeData} bvhData
 * @param {AttributeLayout} layout
 * @returns {Function|null} TSL function node, or null if there is no vec3f or vec4f position.
 */
export function getVertexPositionFn( bvhData, layout ) {

	const { storage } = bvhData;

	const position = layout.members.find( member => member.name === 'position' );
	if ( ! position || position.size < 3 ) {

		// only the traversal fns need positions, so layouts without one still work through getVertex
		return null;

	}

	const { offset } = position;
	return wgslTagFn/* wgsl */`
		// fn
		fn bvh_getVertexPosition( index: u32 ) -> vec3f {

			let base = index * ${ layout.stride }u;
			return bitcast<vec3f>( vec3u(
				${ storage.attributes }[ base + ${ offset }u ],
				${ storage.attributes }[ base + ${ offset + 1 }u ],
				${ storage.attributes }[ base + ${ offset + 2 }u ],
			) );

		}
	`;

}
