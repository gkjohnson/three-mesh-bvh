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
	RGBIntegerFormat,
	RGBAIntegerFormat,
	FloatType,
	UnsignedShortType,
	IntType,
	UnsignedByteType,
	ByteType,
} from 'three';

describe( 'VertexAttributeTexture', () => {

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

			const ba = new BufferAttribute( new Uint8Array( 18 ), 3, false );
			const tex = new UIntVertexAttributeTexture();
			tex.updateFrom( ba );

			expect( tex.image.data ).toHaveLength( 27 );
			expect( tex.image.width ).toBe( 3 );
			expect( tex.image.height ).toBe( 3 );

		}

	} );

	it( 'should choose correct type, format, and internal format based on attribute parameters.', () => {

		// TODO
		// - R, RG, RGB, RGBA
		// - Uint, Int, Float

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

			const ba = new BufferAttribute( new Uint16Array( 6 ), 3, false );
			const tex = new UIntVertexAttributeTexture();
			tex.updateFrom( ba );

			expect( tex.type ).toBe( UnsignedShortType );
			expect( tex.format ).toBe( RGBIntegerFormat );
			expect( tex.internalFormat ).toBe( 'RGB16UI' );

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
