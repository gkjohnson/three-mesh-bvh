/** @import { BVHComputeData } from '../BVHComputeData.js' */
import { wgslTagFn } from '../nodes/WGSLTagFnNode.js';

/**
 * Builds the `getVertex` function: reads the attributes of a vertex from the packed attribute buffer
 * into the attribute struct. The body emits one line per attribute, so this must be built after
 * `update` has resolved the attribute layout.
 *
 * @private
 * @param {BVHComputeData} bvhData
 * @param {{members:Array<Object>,stride:number}} layout
 * @returns {Function} TSL function node.
 */
export function getVertexFn( bvhData, layout ) {

	const { storage, structs } = bvhData;

	const readBody = layout
		.members
		.map( ( { name, offset, size } ) => {

			const words = [];
			for ( let c = 0; c < size; c ++ ) {

				words.push( `( *attributes )[ base + ${ offset + c }u ]` );

			}

			const type = size === 1 ? 'f32' : `vec${ size }f`;
			const value = size === 1 ? words[ 0 ] : `vec${ size }u( ${ words.join( ', ' ) } )`;
			return `result.${ name } = bitcast<${ type }>( ${ value } );`;

		} ).join( '\n' );

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
 * @param {{members:Array<Object>,stride:number}} layout
 * @returns {Function} TSL function node.
 */
export function getVertexPositionFn( bvhData, layout ) {

	const { storage } = bvhData;

	const position = layout.members.find( member => member.name === 'position' );
	if ( ! position || position.size < 3 ) {

		throw new Error( 'BVHComputeData: The "position" attribute must be "vec3f" or "vec4f".' );

	}

	const { offset } = position;
	return wgslTagFn/* wgsl */`
		// fn
		fn bvh_getVertexPosition( index: u32 ) -> vec3f {

			let attributes = &${ storage.attributes };
			let base = index * ${ layout.stride }u;
			return bitcast<vec3f>( vec3u(
				( *attributes )[ base + ${ offset }u ],
				( *attributes )[ base + ${ offset + 1 }u ],
				( *attributes )[ base + ${ offset + 2 }u ]
			) );

		}
	`;

}
