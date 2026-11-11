/** @import { BVHComputeData } from '../BVHComputeData.js' */
/** @import { AttributeLayout } from '../utils/packBVHBufferUtils.js' */
/** @import { Node } from 'three/webgpu' */
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
 * @param {Node} attributesOffset - Uniform with the start of the attribute data in the geometry buffer, in 32-bit words.
 * @returns {Function} TSL function node.
 */
export function getVertexFn( bvhData, layout, attributesOffset ) {

	const { storage, structs } = bvhData;

	const readBody = layout
		.members
		.map( ( { name, type, offset, size } ) => {

			const x = offset;
			const y = offset + 1;
			const z = offset + 2;
			const w = offset + 3;
			if ( type === 'oct16' ) {

				// see "packOct16": u is snorm16, v is a sign-extended 15-bit snorm, the top bit is the sign of w
				return /* wgsl */`
					{
						let word = ( *attributes )[ base + ${ x }u ];
						let u = unpack2x16snorm( word ).x;
						let v = max( f32( bitcast<i32>( word << 1u ) >> 17u ) / 16383.0, - 1.0 );
						var n = vec3f( u, v, 1.0 - abs( u ) - abs( v ) );
						let t = max( - n.z, 0.0 );
						n.x += select( t, - t, n.x >= 0.0 );
						n.y += select( t, - t, n.y >= 0.0 );
						result.${ name } = vec4f( normalize( n ), select( 1.0, - 1.0, ( word & 0x80000000u ) != 0u ) );
					}
				`;

			} else if ( type === '2x16float' ) {

				return /* wgsl */`
					result.${ name } = vec4f(
						unpack2x16float( ( *attributes )[ base + ${ x }u ] ),
						unpack2x16float( ( *attributes )[ base + ${ y }u ] ),
					);
				`;

			} else if ( size === 1 ) {

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
			let base = ${ attributesOffset } + index * ${ layout.stride }u;

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
 * @param {Node} attributesOffset - Uniform with the start of the attribute data in the geometry buffer, in 32-bit words.
 * @returns {Function|null} TSL function node, or null if there is no vec3f or vec4f position.
 */
export function getVertexPositionFn( bvhData, layout, attributesOffset ) {

	const { storage } = bvhData;

	const position = layout.members.find( member => member.name === 'position' );
	if ( ! position || ( position.type !== 'vec3f' && position.type !== 'vec4f' ) ) {

		// only the traversal fns need positions, so layouts without one still work through getVertex
		return null;

	}

	const { offset } = position;
	return wgslTagFn/* wgsl */`
		// fn
		fn bvh_getVertexPosition( index: u32 ) -> vec3f {

			let base = ${ attributesOffset } + index * ${ layout.stride }u;
			return bitcast<vec3f>( vec3u(
				${ storage.geometry }[ base + ${ offset }u ],
				${ storage.geometry }[ base + ${ offset + 1 }u ],
				${ storage.geometry }[ base + ${ offset + 2 }u ],
			) );

		}
	`;

}
