import {
	DataTexture,
	FloatType,
	IntType,
	UnsignedIntType,
	ByteType,
	UnsignedByteType,

	RedFormat,
	RGFormat,
	RGBFormat,
	RGBAFormat,

	RedIntegerFormat,
	RGIntegerFormat,
	RGBIntegerFormat,
	RGBAIntegerFormat,

	NearestFilter,
} from 'three';

function countToStringFormat( count ) {

	switch ( count ) {

		case 1: return 'R';
		case 2: return 'RG';
		case 3: return 'RGB';
		case 4: return 'RGBA';

	}

	throw new Error();

}

function countToFormat( count ) {

	switch ( count ) {

		case 1: return RedFormat;
		case 2: return RGFormat;
		case 3: return RGBFormat;
		case 4: return RGBAFormat;

	}

}

function countToIntFormat( count ) {

	switch ( count ) {

		case 1: return RedIntegerFormat;
		case 2: return RGIntegerFormat;
		case 3: return RGBIntegerFormat;
		case 4: return RGBAIntegerFormat;

	}

}

export class UnsignedIntVertexAttributeTexture extends VertexAttributeTexture {

	constructor() {

		super();
		this._forcedType = UnsignedIntType;

	}

}

export class IntVertexAttributeTexture extends VertexAttributeTexture {

	constructor() {

		super();
		this._forcedType = IntType;

	}


}

export class FloatVertexAttributeTexture extends VertexAttributeTexture {

	constructor() {

		super();
		this._forcedType = FloatType;

	}

}

export class VertexAttributeTexture extends DataTexture {

	constructor() {

		this.minFilter = NearestFilter;
		this.magFilter = NearestFilter;
		this.generateMipmaps = false;
		this._forcedType = null;

	}

	updateFrom( attr ) {

		const itemSize = attr.itemSize;
		const normalized = attr.normalized;
		const originalBufferCons = attr.array.constructor;
		const count = attr.count;
		const byteCount = originalBufferCons.BYTES_PER_ELEMENT;
		let targetType = this._forcedType;

		// derive the type of texture this should be in the shader
		if ( targetType === null ) {

			switch ( originalBufferCons ) {

				case Float32Array:
					targetType = FloatType;
					break;

				case Uint8Array:
				case Uint16Array:
				case Uint32Array:
					targetType = UnsignedIntType;
					break;

				case Int8Array:
				case Int16Array:
				case Int32Array:
					targetType = IntType;
					break;

			}

		}

		// get the target format to store the texture as
		let type, format, normalizeValue, targetBufferCons;
		let internalFormat = countToStringFormat( itemSize );
		switch ( targetType ) {

			case FloatType:
				normalizeValue = 1.0;
				format = countToFormat( byteCount );

				if ( normalized && byteCount === 1 ) {

					targetBufferCons = originalBufferCons;
					internalFormat += '8';

					if ( originalBufferCons === Uint8Array ) {

						type = UnsignedByteType;
						internalFormat += '_SNORM';

					} else {

						type = ByteType;

					}

				} else {

					targetBufferCons = Float32Array;
					internalFormat += '32F';
					type = FloatType;

				}

				break;

			case IntType:
				internalFormat += byteCount * 8 + 'I';
				type = IntType;
				normalizeValue = normalized ? Math.pow( 2, originalBufferCons.BYTES_PER_ELEMENT * 8 - 1 ) : 1.0;
				format = countToIntFormat( byteCount );

				if ( byteCount === 1 ) {

					targetBufferCons = Int8Array;

				} else if ( targetBufferCons === 2 ) {

					targetBufferCons = Int16Array;

				} else {

					targetBufferCons = Int32Array;

				}

				break;

			case UnsignedIntType:
				internalFormat += byteCount * 8 + 'UI';
				type = UnsignedIntType;
				normalizeValue = normalized ? Math.pow( 2, originalBufferCons.BYTES_PER_ELEMENT * 8 - 1 ) : 1.0;
				format = countToIntFormat( byteCount );

				if ( byteCount === 1 ) {

					targetBufferCons = Uint8Array;

				} else if ( targetBufferCons === 2 ) {

					targetBufferCons = Uint16Array;

				} else {

					targetBufferCons = Uint32Array;

				}

				break;

		}

		// copy the data over to the new texture array
		const dimension = Math.ceil( Math.sqrt( count ) );
		const length = dimension * dimension;
		const dataArray = new originalBufferCons( length );
		for ( let i = 0; i < count; i ++ ) {

			const ii = itemSize * i;
			dataArray[ ii ] = attr.getX( i ) / normalizeValue;

			if ( itemSize >= 2 ) {

				dataArray[ ii + 1 ] = attr.getY( i ) / normalizeValue;

			}

			if ( itemSize >= 3 ) {

				dataArray[ ii + 2 ] = attr.getZ( i ) / normalizeValue;

			}

			if ( itemSize >= 4 ) {

				dataArray[ ii + 3 ] = attr.getW( i ) / normalizeValue;

			}

		}

		this.internalFormat = internalFormat;
		this.format = format;
		this.type = type;
		this.image.width = dimension;
		this.image.height = dimension;
		this.image.data = dataArray;
		this.needsUpdate = true;

	}

}
