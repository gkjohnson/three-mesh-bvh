import { convertAttributeArray, copyAttributeArray, offsetArray } from '../../utils/BufferUtils.js';
import { getFullPrimitiveRange } from '../../core/build/geometryUtils.js';

// Copies the triangles in the range and the vertices they span, with the indices shifted to start at the
// first vertex. The position is not copied if it already uses a requested SharedArrayBuffer.
export function copyRange( geometry, range, BufferConstructor = ArrayBuffer ) {

	const indexAttribute = geometry.index;
	const { offset, count } = getFullPrimitiveRange( geometry, range, 3 );
	const indexStart = offset * 3;
	let vertexStart = indexStart;
	let vertexEnd = indexStart + count * 3;

	let index = null;
	if ( indexAttribute ) {

		index = copyAttributeArray( indexAttribute, BufferConstructor, indexStart, count * 3 );
		vertexStart = count > 0 ? Infinity : 0;
		vertexEnd = 0;
		for ( let i = 0, l = index.length; i < l; i ++ ) {

			vertexStart = Math.min( vertexStart, index[ i ] );
			vertexEnd = Math.max( vertexEnd, index[ i ] + 1 );

		}

		offsetArray( index, - vertexStart );

	}

	// an ArrayBuffer is transferred to the worker so it must be a copy
	const getArray = BufferConstructor === ArrayBuffer ? copyAttributeArray : convertAttributeArray;
	const position = getArray( geometry.attributes.position, BufferConstructor, vertexStart, vertexEnd - vertexStart );
	return { index, position, indexStart, vertexStart };

}
