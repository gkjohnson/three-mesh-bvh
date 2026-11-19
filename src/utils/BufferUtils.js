export function isSharedArrayBufferSupported() {

	return typeof SharedArrayBuffer !== 'undefined';

}

export function convertToBufferType( array, BufferConstructor ) {

	if ( array === null ) {

		return array;

	} else if ( array.buffer ) {

		const buffer = array.buffer;
		if ( buffer.constructor === BufferConstructor ) {

			return array;

		}

		const ArrayConstructor = array.constructor;
		const result = new ArrayConstructor( new BufferConstructor( buffer.byteLength ) );
		result.set( array );
		return result;

	} else {

		if ( array.constructor === BufferConstructor ) {

			return array;

		}

		const result = new BufferConstructor( array.byteLength );
		new Uint8Array( result ).set( new Uint8Array( array ) );
		return result;

	}

}

// Returns a tightly packed copy of the attribute's array, pulling the components out of
// the interleaved buffer if needed.
export function copyAttributeArray( attribute, BufferConstructor = ArrayBuffer ) {

	const { itemSize, count } = attribute;
	const interleaved = attribute.isInterleavedBufferAttribute;
	const source = interleaved ? attribute.data.array : attribute.array;
	const stride = interleaved ? attribute.data.stride : itemSize;
	const offset = interleaved ? attribute.offset : 0;

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
