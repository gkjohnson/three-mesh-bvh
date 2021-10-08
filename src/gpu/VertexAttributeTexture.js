import {
	DataTexture,
	FloatType,
	IntType,
	UnsignedIntType,

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

export class VertexAttributeTexture extends DataTexture {

	constructor() {

		this.minFilter = NearestFilter;
		this.magFilter = NearestFilter;
		this.generateMipmaps = false;

	}

	updateFrom( attr ) {

		const itemSize = attr.itemSize;
		const normalized = attr.normalized;
		const bufferCons = attr.array.constructor;
		const count = attr.count;

		let type, format, normalizeValue;
		let internalFormat = countToStringFormat( itemSize );
		switch ( bufferCons ) {

			case Float32Array:
				type = FloatType;
				format = countToFormat( itemSize );
				internalFormat += '32F';
				normalizeValue = 1.0;
				break;

			case Uint8Array:
			case Uint16Array:
			case Uint32Array:
				type = UnsignedIntType;
				format = countToIntFormat( itemSize );
				internalFormat += bufferCons.BYTES_PER_ELEMENT * 8 + 'UI';
				normalizeValue = Math.pow( 2, bufferCons.BYTES_PER_ELEMENT * 8 );
				break;

			case Int8Array:
			case Int16Array:
			case Int32Array:
				type = IntType;
				format = countToIntFormat( itemSize );
				internalFormat += bufferCons.BYTES_PER_ELEMENT * 8 + 'I';
				normalizeValue = Math.pow( 2, bufferCons.BYTES_PER_ELEMENT * 8 - 1 );
				break;

		}

		if ( normalized ) {

			type = FloatType;
			format = countToFormat( itemSize );
			internalFormat = `${ countToStringFormat( itemSize ) }32F`;

		} else {

			normalizeValue = 1.0;

		}

		const dimension = Math.ceil( Math.sqrt( count ) );
		const length = dimension * dimension;
		const dataArray = new bufferCons( length );
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
