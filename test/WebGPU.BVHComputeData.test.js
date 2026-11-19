import {
	Bone,
	BoxGeometry,
	BufferAttribute,
	BufferGeometry,
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
import { MeshBVH } from '../src/index.js';

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

// the attribute data follows the index data in the geometry buffer
function getPackedAttributes( data, indexCount ) {

	return new Float32Array( data.storage.geometry.value.array.buffer, indexCount * 4 );

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

		const packed = getPackedAttributes( data, geometry.index.count );
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
		const packed = new Float32Array( ( writeOffset + vertexCount ) * stride );

		appendGeometryData( { geometry, mesh }, { vertexStart, vertexCount }, writeOffset, packed, layout, data );

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
			weight: 'f32',
		} );

		expect( layout.members.map( m => [ m.name, m.offset, m.size ] ) ).toEqual( [
			[ 'position', 0, 3 ],
			[ 'normal', 3, 3 ],
			[ 'tangent', 6, 4 ],
			[ 'color', 10, 3 ],
			[ 'uv', 13, 2 ],
			[ 'uv1', 15, 2 ],
			[ 'weight', 17, 1 ],
		] );
		expect( layout.stride ).toBe( 18 );
		expect( () => getAttributeLayout( { position: 'mat3x3f' } ) ).toThrow( 'Unsupported attribute type' );
		expect( () => getAttributeLayout( { id: 'u32' } ) ).toThrow( 'Unsupported attribute type' );

	} );

	it( 'reports the packed attribute layout after update.', () => {

		const data = new BVHComputeData( new Mesh( createGeometry() ), { attributes: { position: 'vec3f', normal: 'oct16', uv: 'vec2f' } } );
		expect( data.attributeLayout ).toBe( null );

		data.update();
		expect( data.attributeLayout.stride ).toBe( 6 );
		expect( data.attributeLayout.members.map( m => [ m.name, m.type, m.offset, m.size ] ) ).toEqual( [
			[ 'position', 'vec3f', 0, 3 ],
			[ 'normal', 'oct16', 3, 1 ],
			[ 'uv', 'vec2f', 4, 2 ],
		] );

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

		const packed = getPackedAttributes( data, geometry.index.count );
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

	it( 'packs "oct16" directions, "2x16float" uvs and "4x16float" colors.', () => {

		// the path tracer layout from #961 with "2x16float" uvs comes to 36 bytes per vertex
		const layout = getAttributeLayout( { position: 'vec3f', normal: 'oct16', tangent: 'oct16', color: '4x16float', uv: '2x16float', uv1: '2x16float' } );
		expect( layout.members.map( m => [ m.name, m.offset, m.size, m.structType ] ) ).toEqual( [
			[ 'position', 0, 3, 'vec3f' ],
			[ 'normal', 3, 1, 'vec4f' ],
			[ 'tangent', 4, 1, 'vec4f' ],
			[ 'color', 5, 2, 'vec4f' ],
			[ 'uv', 7, 1, 'vec2f' ],
			[ 'uv1', 8, 1, 'vec2f' ],
		] );
		expect( layout.stride * 4 ).toBe( 36 );

		const geometry = new BufferGeometry();
		geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( [ 0, 0, 0, 1, 0, 0, 0, 1, 0 ] ), 3 ) );
		geometry.setAttribute( 'normal', new BufferAttribute( new Float32Array( [ 0, 0, 1, 0, 0, - 1, 2, 0, 0 ] ), 3 ) );
		geometry.setAttribute( 'tangent', new BufferAttribute( new Float32Array( [ 1, 0, 0, - 1, 0, 1, 0, 1, 0, 0, - 1, - 1 ] ), 4 ) );
		geometry.setAttribute( 'color', new BufferAttribute( new Float32Array( [ 0.5, 1, 2, 1, 0, 0, 0, 0, 1e5, - 1, 0.25, 4 ] ), 4 ) );
		geometry.setAttribute( 'uv', new BufferAttribute( new Float32Array( [ 0.5, 1, 0, 0, 0.25, - 2 ] ), 2 ) );

		const data = new BVHComputeData( new Mesh( geometry ), { attributes: { position: 'vec3f', normal: 'oct16', tangent: 'oct16', color: '4x16float', uv: '2x16float' } } );
		const warn = vi.spyOn( console, 'warn' );
		try {

			data.update();
			expect( warn ).not.toHaveBeenCalled();

		} finally {

			warn.mockRestore();

		}

		const words = data.storage.geometry.value.array.slice( 3, 3 + 3 * 8 );
		const vertex = i => [ ...words.slice( i * 8 + 3, i * 8 + 8 ) ];

		// u is snorm16 in the low bits, v a 15-bit snorm above it, the top bit is the sign of w
		expect( vertex( 0 ) ).toEqual( [ 0x00000000, 0x80007fff, 0x3c003800, 0x3c004000, 0x3c003800 ] );
		expect( vertex( 1 ) ).toEqual( [ 0x3fff7fff, 0x3fff0000, 0x00000000, 0x00000000, 0x00000000 ] );
		expect( vertex( 2 ) ).toEqual( [ 0x00007fff, 0xbfff7fff, 0xbc007bff, 0x44003400, 0xc0003400 ] );

		// a missing direction is written as word 0, which unpacks to ( 0, 0, 1, 1 )
		geometry.deleteAttribute( 'tangent' );
		const missingLayout = getAttributeLayout( { position: 'vec3f', tangent: 'oct16' } );
		const missing = new Uint32Array( 3 * missingLayout.stride ).fill( 0xffffffff );
		appendGeometryData( { geometry }, { vertexStart: 0, vertexCount: 3 }, 0, new Float32Array( missing.buffer ), missingLayout, data );
		expect( [ ...missing ].filter( ( w, i ) => i % 4 === 3 ) ).toEqual( [ 0, 0, 0 ] );

	} );

	it( 'packs the index data of every geometry before its attributes, relative to the geometry\'s vertices.', () => {

		const indexed = new BoxGeometry();
		const nonIndexed = new BoxGeometry( 2, 2, 2 ).toNonIndexed();
		const data = new BVHComputeData( [ new Mesh( indexed ), new Mesh( nonIndexed ) ], { attributes: { position: 'vec3f' } } );
		data.update();

		const indexCount = indexed.index.count + nonIndexed.attributes.position.count;
		const vertexCount = indexed.attributes.position.count + nonIndexed.attributes.position.count;
		const geometry = data.storage.geometry.value.array;
		expect( geometry.length ).toBe( indexCount + vertexCount * 3 );

		// every object record gives the start of its geometry's index and attributes, shared by the
		// records of one geometry's bvh roots
		const records = data.storage.objects.value.array;
		const recordLength = data.structs.objectRecord.getLength();
		const blocks = new Map();
		for ( let i = 0; i < records.length; i += recordLength ) {

			blocks.set( records[ i + 33 ], records[ i + 34 ] );

		}

		// one block per geometry, in either order
		expect( blocks.size ).toBe( 2 );
		expect( blocks.has( 0 ) ).toBe( true );

		// the bvh reorders each geometry's triangles, so compare each triangle's positions as a set
		const packed = new Float32Array( geometry.buffer );
		const toKey = ( x, y, z ) => [ x, y, z ].join();
		const packedTriangles = [];
		blocks.forEach( ( attributesOffset, indexOffset ) => {

			for ( let i = indexOffset; i < attributesOffset; i += 3 ) {

				const triangle = [ 0, 1, 2 ].map( k => {

					const vertexOffset = attributesOffset + geometry[ i + k ] * 3;
					return toKey( ...packed.slice( vertexOffset, vertexOffset + 3 ) );

				} );
				packedTriangles.push( triangle.join( '|' ) );

			}

		} );

		const expectedTriangles = [];
		[ indexed, nonIndexed ].forEach( geo => {

			const { position } = geo.attributes;
			const count = geo.index ? geo.index.count : position.count;
			for ( let i = 0; i < count; i += 3 ) {

				const triangle = [ 0, 1, 2 ].map( k => {

					const v = geo.index ? geo.index.getX( i + k ) : i + k;
					return toKey( ...[ position.getX( v ), position.getY( v ), position.getZ( v ) ].map( Math.fround ) );

				} );
				expectedTriangles.push( triangle.join( '|' ) );

			}

		} );

		expect( packedTriangles.sort() ).toEqual( expectedTriangles.sort() );

	} );

	it( 'throws when the BVH is deeper than the traversal stack.', () => {

		// triangles spaced exponentially split off one at a time, giving a tree as deep as the count
		const count = 80;
		const positions = new Float32Array( count * 9 );
		for ( let i = 0; i < count; i ++ ) {

			const x = 2 ** i;
			positions.set( [ x, 0, 0, x, 1, 0, x, 0, 1 ], i * 9 );

		}

		const geometry = new BufferGeometry();
		geometry.setAttribute( 'position', new BufferAttribute( positions, 3 ) );
		geometry.boundsTree = new MeshBVH( geometry, { maxDepth: 100, targetLeafSize: 1 } );

		const data = new BVHComputeData( new Mesh( geometry ) );
		expect( () => data.update() ).toThrow( 'BVH depth overruns the compute stack depth' );

	} );

	it( 'returns where each object and geometry group was packed from getObjectInfo.', () => {

		// a box has one group, and so one packed object, per side
		const grouped = new BoxGeometry();
		const single = new BoxGeometry( 2, 2, 2 );
		single.clearGroups();

		const groupedMesh = new Mesh( grouped );
		const singleMesh = new Mesh( single );
		const data = new BVHComputeData( [ groupedMesh, singleMesh ], { attributes: { position: 'vec3f' } } );
		expect( data.getObjectInfo( groupedMesh ) ).toBe( null );
		data.update();

		const geometry = data.storage.geometry.value.array;
		const packed = new Float32Array( geometry.buffer );
		const toKey = ( x, y, z ) => [ x, y, z ].join();

		// the positions of every triangle of an object, read the way a shader does
		const readTriangles = info => {

			const triangles = [];
			for ( let t = info.primitiveOffset, l = info.primitiveOffset + info.primitiveCount; t < l; t ++ ) {

				const triangle = [ 0, 1, 2 ].map( k => {

					const vertexOffset = info.attributesOffset + geometry[ info.indexOffset + t * 3 + k ] * 3;
					return toKey( ...packed.slice( vertexOffset, vertexOffset + 3 ) );

				} );
				triangles.push( triangle.join( '|' ) );

			}

			return triangles.sort();

		};

		// the positions of a range of a geometry's triangles
		const expectedTriangles = ( geo, start, count ) => {

			const { position } = geo.attributes;
			const triangles = [];
			for ( let i = start; i < start + count; i += 3 ) {

				const triangle = [ 0, 1, 2 ].map( k => {

					const v = geo.index.getX( i + k );
					return toKey( ...[ position.getX( v ), position.getY( v ), position.getZ( v ) ].map( Math.fround ) );

				} );
				triangles.push( triangle.join( '|' ) );

			}

			return triangles.sort();

		};

		// the source index is read before it is compared since the bvh reorders it within each group
		const objectIndices = new Set();
		grouped.groups.forEach( ( group, g ) => {

			const info = data.getObjectInfo( groupedMesh, 0, g );
			objectIndices.add( info.objectIndex );
			expect( info.primitiveCount ).toBe( group.count / 3 );
			expect( readTriangles( info ) ).toEqual( expectedTriangles( grouped, group.start, group.count ) );

		} );

		const singleInfo = data.getObjectInfo( singleMesh );
		objectIndices.add( singleInfo.objectIndex );
		expect( singleInfo.primitiveOffset ).toBe( 0 );
		expect( singleInfo.primitiveCount ).toBe( single.index.count / 3 );
		expect( readTriangles( singleInfo ) ).toEqual( expectedTriangles( single, 0, single.index.count ) );

		// every group is its own object, and all of a geometry's groups share its block
		expect( objectIndices.size ).toBe( grouped.groups.length + 1 );
		expect( data.getObjectInfo( groupedMesh, 0, 1 ).indexOffset ).toBe( data.getObjectInfo( groupedMesh ).indexOffset );
		expect( singleInfo.indexOffset ).not.toBe( data.getObjectInfo( groupedMesh ).indexOffset );

		expect( data.getObjectInfo( new Mesh( grouped ) ) ).toBe( null );
		expect( data.getObjectInfo( groupedMesh, 0, grouped.groups.length ) ).toBe( null );

		// every object's info, in object index order
		const allInfo = data.getAllObjectInfo();
		expect( allInfo ).toHaveLength( grouped.groups.length + 1 );
		allInfo.forEach( ( info, i ) => {

			expect( info.objectIndex ).toBe( i );
			expect( data.getObjectInfo( info.object, info.instanceId, info.group ) ).toEqual( info );

		} );

	} );

} );
