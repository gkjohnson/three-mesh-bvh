import { convertToBufferType, copyAttributeArray } from '../../utils/BufferUtils.js';
import { getFullPrimitiveRange } from '../../core/build/geometryUtils.js';

// Returns the data a worker needs to build the geometry's bvh. With a "range" it only includes the
// triangles in the range and the vertices they span, so the index and groups are shifted to start at 0.
// The buffers are copied, except that a position already using the requested shared buffer type is not.
export function getBuildData( geometry, range, BufferConstructor = ArrayBuffer ) {

	const { index, groups } = geometry;
	const { position } = geometry.attributes;
	if ( ! range ) {

		return {
			index: index ? copyAttributeArray( index, BufferConstructor ) : null,
			position: getPosition( position, BufferConstructor, 0, position.count ),
			groups,
			triangleOffset: 0,
			triangleCount: 0,
			vertexOffset: 0,
		};

	}

	const { offset: triangleOffset, count: triangleCount } = getFullPrimitiveRange( geometry, range, 3 );
	const start = triangleOffset * 3;
	const count = triangleCount * 3;

	let indexArray = null;
	let vertexOffset = start;
	let vertexCount = count;
	if ( index ) {

		indexArray = copyAttributeArray( index, BufferConstructor, start, count );

		// find the vertices used by the range
		let min = Infinity;
		let max = - Infinity;
		for ( let i = 0; i < count; i ++ ) {

			min = Math.min( min, indexArray[ i ] );
			max = Math.max( max, indexArray[ i ] );

		}

		vertexOffset = count > 0 ? min : 0;
		vertexCount = count > 0 ? max - min + 1 : 0;
		for ( let i = 0; i < count; i ++ ) {

			indexArray[ i ] -= vertexOffset;

		}

	}

	return {
		index: indexArray,
		position: getPosition( position, BufferConstructor, vertexOffset, vertexCount ),
		groups: groups.map( group => ( { ...group, start: group.start - start } ) ),
		triangleOffset,
		triangleCount,
		vertexOffset,
	};

}

// Writes the index reordered by the worker back to the geometry's index
export function writeBuildIndex( indexAttribute, buildIndex, buildData ) {

	const { array } = indexAttribute;
	const { triangleOffset, vertexOffset } = buildData;
	for ( let i = 0, l = buildIndex.length; i < l; i ++ ) {

		array[ triangleOffset * 3 + i ] = buildIndex[ i ] + vertexOffset;

	}

}

// Shifts the triangles of a bvh built by the worker to where they are in the geometry
export function shiftBuildTriangles( bvh, buildData ) {

	const { triangleOffset, triangleCount } = buildData;
	if ( triangleOffset === 0 ) {

		return;

	}

	// the shifted triangle indices may not fit the original type
	const indirectBuffer = bvh._indirectBuffer;
	if ( indirectBuffer instanceof Uint16Array && triangleOffset + triangleCount > 2 ** 16 ) {

		const BufferConstructor = indirectBuffer.buffer.constructor;
		bvh._indirectBuffer = new Uint32Array( new BufferConstructor( indirectBuffer.length * 4 ) );
		bvh._indirectBuffer.set( indirectBuffer );

	}

	bvh.shiftTriangleOffsets( triangleOffset );

}

function getPosition( attribute, BufferConstructor, start, count ) {

	const { array, itemSize } = attribute;
	if ( BufferConstructor === ArrayBuffer || attribute.isInterleavedBufferAttribute ) {

		return copyAttributeArray( attribute, BufferConstructor, start, count );

	} else {

		return convertToBufferType( array.subarray( start * itemSize, ( start + count ) * itemSize ), BufferConstructor );

	}

}
