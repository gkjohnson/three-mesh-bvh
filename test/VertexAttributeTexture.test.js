import {
	FloatVertexAttributeTexture,
	UIntVertexAttributeTexture,
	IntVertexAttributeTexture,
} from '../src/index.js';
import {
	BufferAttribute,
	RedFormat,
	RGFormat,
	RGBAFormat,
	RGIntegerFormat,
	RGBAIntegerFormat,
	FloatType,
	UnsignedShortType,
	IntType,
	UnsignedByteType,
	ByteType,
} from 'three';

describe( 'FloatVertexAttributeTexture', () => {

	it( 'should be able to take a normalized uint8 array.', () => {

		const arr = new Uint8Array( 4 );
		arr.fill( 255 );

		const ba = new BufferAttribute( arr, 1, true );
		const tex = new FloatVertexAttributeTexture();
		tex.updateFrom( ba );

		expect( tex.source.data.data ).toEqual( new Uint8Array( [ 255, 255, 255, 255 ] ) );

	} );

	it( 'should be able to take a normalized int8 array.', () => {

		const arr = new Int8Array( 4 );
		arr.fill( - 127 );

		const ba = new BufferAttribute( arr, 1, true );
		const tex = new FloatVertexAttributeTexture();
		tex.updateFrom( ba );

		expect( tex.source.data.data ).toEqual( new Int8Array( [ - 127, - 127, - 127, - 127 ] ) );

	} );

} );

describe( 'VertexAttributeTexture', () => {

	describe( 'overrideItemSize', () => {

		it( 'should reset the itemSize if it is set.', () => {

			const ba = new BufferAttribute( new Uint8Array( 8 ), 1, false );
			const tex = new UIntVertexAttributeTexture();
			tex.overrideItemSize = 4;
			tex.updateFrom( ba );

			expect( tex.type ).toBe( UnsignedByteType );
			expect( tex.format ).toBe( RGBAIntegerFormat );
			expect( tex.internalFormat ).toBe( 'RGBA8UI' );
			expect( ba.itemSize ).toBe( 1 );
			expect( ba.count ).toBe( 8 );
			expect( tex.image.width ).toBe( 2 );

		} );

		it( 'should throw an error if it does not divide evenly into buffer length.', () => {

			const ba = new BufferAttribute( new Uint8Array( 8 ), 1, false );
			const tex = new UIntVertexAttributeTexture();
			tex.overrideItemSize = 3;

			let caught = false;
			try {

				tex.updateFrom( ba );

			} catch {

				caught = true;

			}

			expect( caught ).toBe( true );

		} );

	} );

	it( 'should automatically use RGBAFormat when passing in an attribute with a stride of 3.', () => {

		{

			const ba = new BufferAttribute( new Float32Array( 6 ), 3, false );
			const tex = new FloatVertexAttributeTexture();
			tex.updateFrom( ba );

			expect( tex.image.data ).toHaveLength( 16 );
			expect( tex.image.data ).toEqual( new Float32Array( [ 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0 ] ) );
			expect( tex.format ).toBe( RGBAFormat );
			expect( tex.internalFormat ).toBe( 'RGBA32F' );

		}

		{

			const ba = new BufferAttribute( new Uint8Array( 6 ), 3, false );
			const tex = new UIntVertexAttributeTexture();
			tex.updateFrom( ba );

			expect( tex.image.data ).toHaveLength( 16 );
			expect( tex.image.data ).toEqual( new Uint8Array( [ 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0 ] ) );
			expect( tex.format ).toBe( RGBAIntegerFormat );
			expect( tex.internalFormat ).toBe( 'RGBA8UI' );

		}

	} );

	it( 'should create a large enough texture to store all data.', () => {

		{

			const ba = new BufferAttribute( new Float32Array( 6 ), 2, false );
			const tex = new FloatVertexAttributeTexture();
			tex.updateFrom( ba );

			expect( tex.image.data ).toHaveLength( 8 );
			expect( tex.image.width ).toBe( 2 );
			expect( tex.image.height ).toBe( 2 );

		}

		{

			const ba = new BufferAttribute( new Uint8Array( 20 ), 2, false );
			const tex = new UIntVertexAttributeTexture();
			tex.updateFrom( ba );

			expect( tex.image.data ).toHaveLength( 32 );
			expect( tex.image.width ).toBe( 4 );
			expect( tex.image.height ).toBe( 4 );

		}

	} );

	it( 'should choose correct type, format, and internal format based on attribute parameters.', () => {

		{

			const ba = new BufferAttribute( new Float32Array( 6 ), 2, false );
			const tex = new FloatVertexAttributeTexture();
			tex.updateFrom( ba );

			expect( tex.type ).toBe( FloatType );
			expect( tex.format ).toBe( RGFormat );
			expect( tex.internalFormat ).toBe( 'RG32F' );

		}

		{

			const ba = new BufferAttribute( new Uint8Array( 6 ), 1, true );
			const tex = new FloatVertexAttributeTexture();
			tex.updateFrom( ba );

			expect( tex.type ).toBe( UnsignedByteType );
			expect( tex.format ).toBe( RedFormat );
			expect( tex.internalFormat ).toBe( 'R8' );

		}

		{

			const ba = new BufferAttribute( new Int8Array( 6 ), 4, true );
			const tex = new FloatVertexAttributeTexture();
			tex.updateFrom( ba );

			expect( tex.type ).toBe( ByteType );
			expect( tex.format ).toBe( RGBAFormat );
			expect( tex.internalFormat ).toBe( 'RGBA8_SNORM' );

		}

		{

			const ba = new BufferAttribute( new Uint16Array( 6 ), 2, false );
			const tex = new UIntVertexAttributeTexture();
			tex.updateFrom( ba );

			expect( tex.type ).toBe( UnsignedShortType );
			expect( tex.format ).toBe( RGIntegerFormat );
			expect( tex.internalFormat ).toBe( 'RG16UI' );

		}

		{

			const ba = new BufferAttribute( new Int32Array( 6 ), 4, false );
			const tex = new IntVertexAttributeTexture();
			tex.updateFrom( ba );

			expect( tex.type ).toBe( IntType );
			expect( tex.format ).toBe( RGBAIntegerFormat );
			expect( tex.internalFormat ).toBe( 'RGBA32I' );

		}

	} );

} );
