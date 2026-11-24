import { copyAttributeArray, offsetArray } from '../../utils/BufferUtils.js';
import { getFullPrimitiveRange } from '../../core/build/geometryUtils.js';

// Copies the triangles in the range and the vertices they span, with the indices shifted to start at the
// first vertex.
export function copyRange( geometry, range ) {

	const indexAttribute = geometry.index;
	const { offset, count } = getFullPrimitiveRange( geometry, range, 3 );
	const indexStart = offset * 3;
	let vertexStart = indexStart;
	let vertexEnd = indexStart + count * 3;

	let index = null;
	if ( indexAttribute && count > 0 ) {

		index = copyAttributeArray( indexAttribute, ArrayBuffer, indexStart, count * 3 );
		vertexStart = index.reduce( ( min, v ) => Math.min( min, v ) );
		vertexEnd = index.reduce( ( max, v ) => Math.max( max, v ) ) + 1;
		offsetArray( index, - vertexStart );

	}

	const position = copyAttributeArray( geometry.attributes.position, ArrayBuffer, vertexStart, vertexEnd - vertexStart );
	return { index, position, indexStart, vertexStart };

}

// Shifts a bvh built from a copied range to where the range is in the geometry
export function shiftRange( bvh, range, indexStart ) {

	// the shifted triangle indices may not fit in 16 bits
	const indirectBuffer = bvh._indirectBuffer;
	if ( indirectBuffer && indirectBuffer.BYTES_PER_ELEMENT === 2 && ( indexStart + range.count ) / 3 > 2 ** 16 ) {

		bvh._indirectBuffer = new Uint32Array( new indirectBuffer.buffer.constructor( 4 * indirectBuffer.length ) );
		bvh._indirectBuffer.set( indirectBuffer );

	}

	bvh.shiftPrimitiveOffsets( indexStart / 3 );

}
