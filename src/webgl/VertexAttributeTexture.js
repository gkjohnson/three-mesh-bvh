/** @import { BufferAttribute } from 'three' */
import {
	DataTexture,
	FloatType,
	IntType,
	UnsignedIntType,
	ByteType,
	UnsignedByteType,
	ShortType,
	UnsignedShortType,

	RedFormat,
	RGFormat,
	RGBAFormat,

	RedIntegerFormat,
	RGIntegerFormat,
	RGBAIntegerFormat,

	NearestFilter,
} from 'three';

function countToStringFormat( count ) {

	switch ( count ) {

		case 1: return 'R';
		case 2: return 'RG';
		case 3: return 'RGBA';
		case 4: return 'RGBA';

	}

	throw new Error();

}

function countToFormat( count ) {

	switch ( count ) {

		case 1: return RedFormat;
		case 2: return RGFormat;
		case 3: return RGBAFormat;
		case 4: return RGBAFormat;

	}

}

function countToIntFormat( count ) {

	switch ( count ) {

		case 1: return RedIntegerFormat;
		case 2: return RGIntegerFormat;
		case 3: return RGBAIntegerFormat;
		case 4: return RGBAIntegerFormat;

	}

}

/**
 * Float, Uint, and Int VertexAttributeTexture implementations are designed to simplify the
 * efficient packing of a three.js BufferAttribute into a texture. An instance can be treated as a
 * texture and when passing as a uniform to a shader they should be used as a `sampler2d`,
 * `usampler2d`, and `isampler2d` when using the Float, Uint, and Int texture types respectively.
 *
 * _extends THREE.DataTexture_
 *
 * @group Shader and Texture Packing API
 */
export class VertexAttributeTexture extends DataTexture {

	constructor() {

		super();
		this.minFilter = NearestFilter;
		this.magFilter = NearestFilter;
		this.generateMipmaps = false;

		/**
		 * Treats `BufferAttribute.itemSize` as though it were set to this value when packing the
		 * buffer attribute texture. Throws an error if the value does not divide evenly into the
		 * length of the BufferAttribute buffer (`count * itemSize % overrideItemSize`).
		 *
		 * Specifically used to pack geometry indices into an RGB texture rather than an Red texture.
		 * @type {number}
		 */
		this.overrideItemSize = null;
		this._forcedType = null;

	}

	/**
	 * Updates the texture to have the data contained in the passed BufferAttribute using the
	 * BufferAttribute `itemSize` field, `normalized` field, and TypedArray layout to determine
	 * the appropriate texture layout, format, and type. The texture dimensions will always be
	 * square. Because these are intended to be sampled as 1D arrays the width of the texture must
	 * be taken into account to derive a sampling uv. See `texelFetch1D` in shaderFunctions.
	 *
	 * @param {BufferAttribute} attribute
	 * @returns {void}
	 */
	updateFrom( attr ) {

		const overrideItemSize = this.overrideItemSize;
		const originalItemSize = attr.itemSize;
		const originalCount = attr.count;
		if ( overrideItemSize !== null ) {

			if ( ( originalItemSize * originalCount ) % overrideItemSize !== 0.0 ) {

				throw new Error( 'VertexAttributeTexture: overrideItemSize must divide evenly into buffer length.' );

			}

			attr.itemSize = overrideItemSize;
			attr.count = originalCount * originalItemSize / overrideItemSize;

		}

		const itemSize = attr.itemSize;
		const count = attr.count;
		const normalized = attr.normalized;
		const originalBufferCons = attr.array.constructor;
		const byteCount = originalBufferCons.BYTES_PER_ELEMENT;
		let targetType = this._forcedType;
		let finalStride = itemSize;

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
				format = countToFormat( itemSize );

				if ( normalized && byteCount === 1 ) {

					targetBufferCons = originalBufferCons;
					internalFormat += '8';

					if ( originalBufferCons === Uint8Array ) {

						type = UnsignedByteType;

					} else {

						type = ByteType;
						internalFormat += '_SNORM';

					}

				} else {

					targetBufferCons = Float32Array;
					internalFormat += '32F';
					type = FloatType;

				}

				break;

			case IntType:
				internalFormat += byteCount * 8 + 'I';
				normalizeValue = normalized ? Math.pow( 2, originalBufferCons.BYTES_PER_ELEMENT * 8 - 1 ) : 1.0;
				format = countToIntFormat( itemSize );

				if ( byteCount === 1 ) {

					targetBufferCons = Int8Array;
					type = ByteType;

				} else if ( byteCount === 2 ) {

					targetBufferCons = Int16Array;
					type = ShortType;

				} else {

					targetBufferCons = Int32Array;
					type = IntType;

				}

				break;

			case UnsignedIntType:
				internalFormat += byteCount * 8 + 'UI';
				normalizeValue = normalized ? Math.pow( 2, originalBufferCons.BYTES_PER_ELEMENT * 8 - 1 ) : 1.0;
				format = countToIntFormat( itemSize );

				if ( byteCount === 1 ) {

					targetBufferCons = Uint8Array;
					type = UnsignedByteType;

				} else if ( byteCount === 2 ) {

					targetBufferCons = Uint16Array;
					type = UnsignedShortType;

				} else {

					targetBufferCons = Uint32Array;
					type = UnsignedIntType;

				}

				break;

		}

		// there will be a mismatch between format length and final length because
		// RGBFormat and RGBIntegerFormat was removed
		if ( finalStride === 3 && ( format === RGBAFormat || format === RGBAIntegerFormat ) ) {

			finalStride = 4;

		}

		// copy the data over to the new texture array
		const dimension = Math.ceil( Math.sqrt( count ) ) || 1;
		const length = finalStride * dimension * dimension;
		const dataArray = new targetBufferCons( length );

		// temporarily set the normalized state to false since we have custom normalization logic
		const originalNormalized = attr.normalized;
		attr.normalized = false;
		for ( let i = 0; i < count; i ++ ) {

			const ii = finalStride * i;
			dataArray[ ii ] = attr.getX( i ) / normalizeValue;

			if ( itemSize >= 2 ) {

				dataArray[ ii + 1 ] = attr.getY( i ) / normalizeValue;

			}

			if ( itemSize >= 3 ) {

				dataArray[ ii + 2 ] = attr.getZ( i ) / normalizeValue;

				if ( finalStride === 4 ) {

					dataArray[ ii + 3 ] = 1.0;

				}

			}

			if ( itemSize >= 4 ) {

				dataArray[ ii + 3 ] = attr.getW( i ) / normalizeValue;

			}

		}

		attr.normalized = originalNormalized;

		this.internalFormat = internalFormat;
		this.format = format;
		this.type = type;
		this.image.width = dimension;
		this.image.height = dimension;
		this.image.data = dataArray;
		this.needsUpdate = true;
		this.dispose();

		attr.itemSize = originalItemSize;
		attr.count = originalCount;

	}

}

/**
 * A VertexAttributeTexture that forces the unsigned integer texture type.
 * @group Shader and Texture Packing API
 */
export class UIntVertexAttributeTexture extends VertexAttributeTexture {

	constructor() {

		super();
		this._forcedType = UnsignedIntType;

	}

}

/**
 * A VertexAttributeTexture that forces the signed integer texture type.
 * @group Shader and Texture Packing API
 */
export class IntVertexAttributeTexture extends VertexAttributeTexture {

	constructor() {

		super();
		this._forcedType = IntType;

	}


}

/**
 * A VertexAttributeTexture that forces the float texture type.
 * @group Shader and Texture Packing API
 */
export class FloatVertexAttributeTexture extends VertexAttributeTexture {

	constructor() {

		super();
		this._forcedType = FloatType;

	}

}
