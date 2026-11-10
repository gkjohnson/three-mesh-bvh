/** @import { BVHComputeData } from '../BVHComputeData.js' */
import { wgslTagFn } from '../nodes/WGSLTagFnNode.js';

// builds a tagged-template call from a list of strings and nodes, since the function body depends on
// the attribute layout
function buildFn( parts ) {

	const tokens = [ '' ];
	const args = [];
	for ( const part of parts ) {

		if ( typeof part === 'string' ) {

			tokens[ tokens.length - 1 ] += part;

		} else {

			args.push( part );
			tokens.push( '' );

		}

	}

	return wgslTagFn( tokens, ...args );

}

// returns the parts of a WGSL expression that reads one layout member from the u32 attribute buffer
function readMember( attributes, { type, offset, size } ) {

	const cast = /f$|^f32$/.test( type ) ? 'bitcast<f32>' : /i$|^i32$/.test( type ) ? 'bitcast<i32>' : '';
	const parts = size === 1 ? [] : [ `${ type }( ` ];
	for ( let c = 0; c < size; c ++ ) {

		parts.push( c === 0 ? `${ cast }( ` : `, ${ cast }( `, attributes, `[ base + ${ offset + c }u ] )` );

	}

	if ( size !== 1 ) parts.push( ' )' );
	return parts;

}

/**
 * Builds the `getVertex` function: reads all attributes of a vertex from the packed attribute buffer
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
	const parts = [ '\n\t\tfn bvh_getVertex( index: u32 ) -> ', structs.attributes, ' {\n\n' ];
	parts.push( `\t\t\tlet base = index * ${ layout.stride }u;\n\t\t\tvar result: `, structs.attributes, ';\n' );
	for ( const member of layout.members ) {

		parts.push( `\t\t\tresult.${ member.name } = `, ...readMember( storage.attributes, member ), ';\n' );

	}

	parts.push( '\t\t\treturn result;\n\n\t\t}\n' );
	return buildFn( parts );

}

/**
 * Builds the `getVertexPosition` function used by the traversal functions, which only read positions.
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

		return null;

	}

	const parts = [ '\n\t\tfn bvh_getVertexPosition( index: u32 ) -> vec3f {\n\n' ];
	parts.push( `\t\t\tlet base = index * ${ layout.stride }u;\n\t\t\treturn `, ...readMember( storage.attributes, { ...position, type: 'vec3f', size: 3 } ), ';\n' );
	parts.push( '\n\t\t}\n' );
	return buildFn( parts );

}
