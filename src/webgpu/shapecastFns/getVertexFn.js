/** @import { BVHComputeData } from '../BVHComputeData.js' */
/** @import { AttributeLayout } from '../utils/packBVHBufferUtils.js' */
import { wgslTagFn } from '../nodes/WGSLTagFnNode.js';

/**
 * Builds the `getTriangleIndices` function: reads the vertex indices of a triangle from the index
 * data at the start of the geometry buffer.
 *
 * @private
 * @param {BVHComputeData} bvhData
 * @returns {Function} TSL function node.
 */
export function getTriangleIndicesFn( bvhData ) {

	const { storage } = bvhData;
	return wgslTagFn/* wgsl */`
		// fn
		fn bvh_getTriangleIndices( triIndex: u32 ) -> vec3u {

			let base = triIndex * 3u;
			return vec3u(
				${ storage.geometry }[ base ],
				${ storage.geometry }[ base + 1u ],
				${ storage.geometry }[ base + 2u ],
			);

		}
	`;

}

/**
 * Builds the `getVertex` function: reads the attributes of a vertex from the packed attribute data
 * into the attribute struct. The body emits one line per attribute, so this must be built after
 * `update` has resolved the attribute layout.
 *
 * @private
 * @param {BVHComputeData} bvhData
 * @param {AttributeLayout} layout
 * @param {number} attributesOffset - Start of the attribute data in the geometry buffer, in 32-bit words.
 * @returns {Function} TSL function node.
 */
export function getVertexFn( bvhData, layout, attributesOffset ) {

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

			let attributes = &${ storage.geometry };
			let base = ${ attributesOffset }u + index * ${ layout.stride }u;

			var result: ${ structs.attributes };
			${ readBody }
			return result;

		}
	`;

}

/**
 * Builds the `getVertexPosition` function: reads only the position of a vertex from the packed
 * attribute data, so traversal doesn't unpack the whole attribute struct.
 *
 * @private
 * @param {BVHComputeData} bvhData
 * @param {AttributeLayout} layout
 * @param {number} attributesOffset - Start of the attribute data in the geometry buffer, in 32-bit words.
 * @returns {Function|null} TSL function node, or null if there is no vec3f or vec4f position.
 */
export function getVertexPositionFn( bvhData, layout, attributesOffset ) {

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

			let base = ${ attributesOffset }u + index * ${ layout.stride }u;
			return bitcast<vec3f>( vec3u(
				${ storage.geometry }[ base + ${ offset }u ],
				${ storage.geometry }[ base + ${ offset + 1 }u ],
				${ storage.geometry }[ base + ${ offset + 2 }u ],
			) );

		}
	`;

}
