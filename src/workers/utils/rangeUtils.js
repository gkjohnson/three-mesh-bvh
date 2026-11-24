import { convertToBufferType, copyAttributeArray, offsetArray } from '../../utils/BufferUtils.js';
import { getFullPrimitiveRange } from '../../core/build/geometryUtils.js';

// Copies the triangles in the range and the vertices they span, with the indices shifted to start at the
// first vertex. The position is shared rather than copied if it already uses the requested shared buffer.
export function copyRange( geometry, range, BufferConstructor = ArrayBuffer ) {

	const indexAttribute = geometry.index;
	const positionAttribute = geometry.attributes.position;
	const { offset, count } = getFullPrimitiveRange( geometry, range, 3 );
	const indexStart = offset * 3;
	let vertexStart = indexStart;
	let vertexEnd = indexStart + count * 3;

	let index = null;
	if ( indexAttribute && count > 0 ) {

		index = copyAttributeArray( indexAttribute, BufferConstructor, indexStart, count * 3 );
		vertexStart = index.reduce( ( min, v ) => Math.min( min, v ) );
		vertexEnd = index.reduce( ( max, v ) => Math.max( max, v ) ) + 1;
		offsetArray( index, - vertexStart );

	}

	let position;
	if ( BufferConstructor === ArrayBuffer || positionAttribute.isInterleavedBufferAttribute ) {

		position = copyAttributeArray( positionAttribute, BufferConstructor, vertexStart, vertexEnd - vertexStart );

	} else {

		position = convertToBufferType( positionAttribute.array.subarray( vertexStart * 3, vertexEnd * 3 ), BufferConstructor );

	}

	return { index, position, indexStart, vertexStart };

}
