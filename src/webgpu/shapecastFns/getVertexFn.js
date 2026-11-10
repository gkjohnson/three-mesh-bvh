/** @import { BVHComputeData } from '../BVHComputeData.js' */
import { wgslTagFn } from '../nodes/WGSLTagFnNode.js';

// the function bodies depend on the attribute layout, so the tagged-template arguments are built up
// as a list of strings and nodes
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

function readMember( attributes, { type, scalar, offset, size } ) {

	const cast = scalar === 'f' ? 'bitcast<f32>' : scalar === 'i' ? 'bitcast<i32>' : '';
	const parts = size === 1 ? [] : [ `${ type }( ` ];
	for ( let c = 0; c < size; c ++ ) {

		const separator = c === 0 ? '' : ', ';
		parts.push( `${ separator }${ cast }( `, attributes, `[ base + ${ offset + c }u ] )` );

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
	if ( ! position || position.size < 3 || position.scalar !== 'f' ) {

		return null;

	}

	const parts = [ '\n\t\tfn bvh_getVertexPosition( index: u32 ) -> vec3f {\n\n' ];
	parts.push( `\t\t\tlet base = index * ${ layout.stride }u;\n\t\t\treturn `, ...readMember( storage.attributes, { ...position, type: 'vec3f', scalar: 'f', size: 3 } ), ';\n' );
	parts.push( '\n\t\t}\n' );
	return buildFn( parts );

}
