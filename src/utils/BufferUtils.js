export function isSharedArrayBufferSupported() {

	return typeof SharedArrayBuffer !== 'undefined';

}

// Adds a value to every item in the array
export function offsetArray( array, offset ) {

	for ( let i = 0, l = array.length; i < l; i ++ ) {

		array[ i ] += offset;

	}

}

// Returns a tightly packed copy of the attribute's array, pulling the components out of
// the interleaved buffer if needed.
export function copyAttributeArray( attribute, BufferConstructor = ArrayBuffer, start = 0, count = attribute.count ) {

	const { itemSize } = attribute;
	const interleaved = attribute.isInterleavedBufferAttribute;
	const source = interleaved ? attribute.data.array : attribute.array;
	const stride = interleaved ? attribute.data.stride : itemSize;
	const offset = start * stride + ( interleaved ? attribute.offset : 0 );

	const length = count * itemSize;
	const result = new source.constructor( new BufferConstructor( length * source.BYTES_PER_ELEMENT ) );
	if ( stride === itemSize ) {

		result.set( source.subarray( offset, offset + length ) );

	} else {

		for ( let i = 0; i < count; i ++ ) {

			for ( let c = 0; c < itemSize; c ++ ) {

				result[ i * itemSize + c ] = source[ i * stride + offset + c ];

			}

		}

	}

	return result;

}

// The same as "copyAttributeArray" except the array is not copied if it already uses the buffer type
export function convertAttributeArray( attribute, BufferConstructor = ArrayBuffer, start = 0, count = attribute.count ) {

	const { array, itemSize } = attribute;
	if ( ! attribute.isInterleavedBufferAttribute && array.buffer.constructor === BufferConstructor ) {

		return array.subarray( start * itemSize, ( start + count ) * itemSize );

	}

	return copyAttributeArray( attribute, BufferConstructor, start, count );

}
