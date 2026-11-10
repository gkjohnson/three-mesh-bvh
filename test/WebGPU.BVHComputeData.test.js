import {
	Bone,
	BufferAttribute,
	Float16BufferAttribute,
	InterleavedBuffer,
	InterleavedBufferAttribute,
	Mesh,
	REVISION,
	Skeleton,
	SkinnedMesh,
	TorusKnotGeometry,
	Vector4,
} from 'three';
import { appendGeometryData, getAttributeLayout } from '../src/webgpu/utils/packBVHBufferUtils.js';

const attributes = {
	position: 'vec4f',
	normal: 'vec4f',
	uv: 'vec4f',
	tangent: 'vec4f',
	color: 'vec4f',
	interleaved: 'vec4f',
	half: 'vec4f',
	id: 'vec4f',
	missing: 'vec4f',
};
const names = Object.keys( attributes );

// BVHComputeData requires r185. Before that "three/webgpu" is either missing (0.159) or fails to load
// in node (0.168), so BVHComputeData is only imported when the tests run.
const IS_REVISION_185 = parseInt( REVISION ) >= 185;

let BVHComputeData;

function createGeometry() {

	const geometry = new TorusKnotGeometry( 1, 0.4, 40, 8 );
	const count = geometry.attributes.position.count;

	const tangent = new Float32Array( count * 4 ).map( ( v, i ) => Math.sin( i ) );
	geometry.setAttribute( 'tangent', new BufferAttribute( tangent, 4 ) );

	const color = new Uint8Array( count * 4 ).map( ( v, i ) => ( i * 37 ) % 256 );
	geometry.setAttribute( 'color', new BufferAttribute( color, 4, true ) );

	const interleaved = new InterleavedBuffer( new Float32Array( count * 5 ).map( ( v, i ) => i * 0.25 ), 5 );
	geometry.setAttribute( 'interleaved', new InterleavedBufferAttribute( interleaved, 3, 1 ) );

	const half = new Uint16Array( count * 2 ).map( ( v, i ) => 0x3c00 + i % 1024 );
	geometry.setAttribute( 'half', new Float16BufferAttribute( half, 2 ) );

	const id = new Uint16Array( count ).map( ( v, i ) => i );
	geometry.setAttribute( 'id', new BufferAttribute( id, 1 ) );

	return geometry;

}

// packs the range the way the accessor path does, as the reference for the copy path
function getExpected( data, geometry, vertexStart, vertexCount, mesh = null ) {

	const expected = new Float32Array( vertexCount * names.length * 4 );
	const def = new Vector4();
	const vec = new Vector4();
	for ( let i = 0; i < vertexCount; i ++ ) {

		names.forEach( ( name, m ) => {

			const attr = geometry.attributes[ name ];
			data.getDefaultAttributeValue( name, def );
			if ( attr ) {

				vec.fromBufferAttribute( attr, i + vertexStart );
				for ( let c = attr.itemSize; c < 4; c ++ ) {

					vec.setComponent( c, def.getComponent( c ) );

				}

				if ( mesh && ( name === 'position' || name === 'normal' || name === 'tangent' ) ) {

					mesh.applyBoneTransform( i + vertexStart, vec );

				}

			} else {

				vec.copy( def );

			}

			vec.toArray( expected, ( i * names.length + m ) * 4 );

		} );

	}

	return expected;

}

describe.skipIf( ! IS_REVISION_185 )( 'BVHComputeData', () => {

	beforeAll( async () => {

		( { BVHComputeData } = await import( '../src/webgpu/BVHComputeData.js' ) );

	} );

	it( 'packs every attribute layout the same as Vector4.fromBufferAttribute.', () => {

		const geometry = createGeometry();
		const count = geometry.attributes.position.count;
		const data = new BVHComputeData( new Mesh( geometry ), { attributes } );
		data.update();

		const packed = new Float32Array( data.storage.attributes.value.array.buffer );
		expect( packed.slice( 0, count * names.length * 4 ) ).toEqual( getExpected( data, geometry, 0, count ) );

	} );

	it( 'packs a vertex range at a write offset, and skins positions, normals and tangents.', () => {

		const geometry = createGeometry();
		const count = geometry.attributes.position.count;
		geometry.setAttribute( 'skinIndex', new BufferAttribute( new Uint16Array( count * 4 ).map( ( v, i ) => i % 4 === 0 ? ( i >> 2 ) % 2 : 0 ), 4 ) );
		geometry.setAttribute( 'skinWeight', new BufferAttribute( new Float32Array( count * 4 ).map( ( v, i ) => i % 4 === 0 ? 1 : 0 ), 4 ) );

		const bones = [ new Bone(), new Bone() ];
		bones[ 0 ].add( bones[ 1 ] );
		const mesh = new SkinnedMesh( geometry );
		mesh.add( bones[ 0 ] );
		mesh.bind( new Skeleton( bones ) );
		bones[ 1 ].position.set( 1, 2, 3 );
		bones[ 1 ].rotation.set( 0.3, 0.5, 0.7 );
		mesh.updateMatrixWorld( true );
		mesh.skeleton.update();

		const data = new BVHComputeData( mesh, { attributes } );
		const layout = getAttributeLayout( attributes );
		const stride = layout.stride;
		const vertexStart = 17;
		const vertexCount = 50;
		const writeOffset = 9;
		const target = new ArrayBuffer( ( writeOffset + vertexCount ) * stride * 4 );

		appendGeometryData( { geometry, mesh }, { vertexStart, vertexCount }, writeOffset, target, layout, data );

		const packed = new Float32Array( target );
		expect( packed.slice( 0, writeOffset * stride ).every( v => v === 0 ) ).toBe( true );
		expect( packed.slice( writeOffset * stride ) ).toEqual( getExpected( data, geometry, vertexStart, vertexCount, mesh ) );

	} );

	it( 'lays out attributes in declaration order without padding.', () => {

		const layout = getAttributeLayout( {
			position: 'vec3f',
			normal: 'vec3f',
			tangent: 'vec4f',
			color: 'vec3f',
			uv: 'vec2f',
			uv1: 'vec2f',
			id: 'u32',
		} );

		expect( layout.members.map( m => [ m.name, m.offset, m.size ] ) ).toEqual( [
			[ 'position', 0, 3 ],
			[ 'normal', 3, 3 ],
			[ 'tangent', 6, 4 ],
			[ 'color', 10, 3 ],
			[ 'uv', 13, 2 ],
			[ 'uv1', 15, 2 ],
			[ 'id', 17, 1 ],
		] );
		expect( layout.stride ).toBe( 18 );
		expect( () => getAttributeLayout( { position: 'mat3x3f' } ) ).toThrow( 'Unsupported attribute type' );
		expect( () => getAttributeLayout( { position: undefined } ) ).toThrow( 'Unsupported attribute type' );

		const aliases = getAttributeLayout( { position: 'vec3', id: 'uint', offset: 'int', weight: 'float', cell: 'ivec2', mask: 'uvec4' } );
		expect( aliases.members.map( m => m.type ) ).toEqual( [ 'vec3f', 'u32', 'i32', 'f32', 'vec2i', 'vec4u' ] );
		expect( aliases.stride ).toBe( 12 );

	} );

	it( 'packs attributes smaller than vec4f at their own offsets.', () => {

		const geometry = createGeometry();
		const uv1 = geometry.attributes.uv.clone();
		uv1.array.forEach( ( v, i, arr ) => arr[ i ] = v + 100 );
		geometry.setAttribute( 'uv1', uv1 );

		const count = geometry.attributes.position.count;
		// color ( normalized ) and half ( float16 ) take the accessor path
		const data = new BVHComputeData( new Mesh( geometry ), { attributes: { position: 'vec3f', uv: 'vec2f', uv1: 'vec2f', color: 'vec3f', half: 'vec2f' } } );
		data.update();

		const packed = new Float32Array( data.storage.attributes.value.array.buffer );
		const { position, uv, color, half } = geometry.attributes;
		for ( let i = 0; i < count; i ++ ) {

			const o = i * 12;
			expect( [ ...packed.slice( o, o + 12 ) ] ).toEqual( [
				position.getX( i ), position.getY( i ), position.getZ( i ),
				uv.getX( i ), uv.getY( i ),
				uv1.getX( i ), uv1.getY( i ),
				color.getX( i ), color.getY( i ), color.getZ( i ),
				half.getX( i ), half.getY( i ),
			].map( Math.fround ) );

		}

	} );

	it( 'packs integer attributes as integers.', () => {

		const geometry = createGeometry();
		const count = geometry.attributes.position.count;
		const ids = new Uint16Array( count ).map( ( v, i ) => i * 3 + 1 );
		const offsets = new Int8Array( count ).map( ( v, i ) => i % 2 ? - 2 : 5 );
		geometry.setAttribute( 'id', new BufferAttribute( ids, 1 ) );
		geometry.setAttribute( 'offset', new BufferAttribute( offsets, 1 ) );
		const tags = new Uint8Array( count ).map( ( v, i ) => i % 2 ? 255 : 128 );
		geometry.setAttribute( 'tag', new BufferAttribute( tags, 1, true ) );

		const data = new BVHComputeData( new Mesh( geometry ), { attributes: { position: 'vec3f', id: 'u32', offset: 'i32', tag: 'u32' } } );
		data.update();

		const { buffer } = data.storage.attributes.value.array;
		const packedU32 = new Uint32Array( buffer );
		const packedI32 = new Int32Array( buffer );
		for ( let i = 0; i < count; i ++ ) {

			expect( packedU32[ i * 6 + 3 ] ).toBe( ids[ i ] );
			expect( packedI32[ i * 6 + 4 ] ).toBe( offsets[ i ] );
			expect( packedU32[ i * 6 + 5 ] ).toBe( tags[ i ] );

		}

	} );

} );
