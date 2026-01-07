import {
	BufferGeometry,
	SphereGeometry,
	BufferAttribute,
} from 'three';
import {
	MeshBVH,
} from 'three-mesh-bvh';

describe( 'Serialization', () => {

	let geometry;
	beforeEach( () => {

		geometry = new SphereGeometry( 1, 10, 10 );

	} );

	it( 'should serialize then deserialize to the same structure.', () => {

		const bvh = new MeshBVH( geometry );
		const serialized = MeshBVH.serialize( bvh );
		const deserializedBVH = MeshBVH.deserialize( serialized, geometry );

		// use a custom object since anonymous functions cause the
		// test function to fail
		const testObj = { ...bvh };
		delete testObj.resolvePrimitiveIndex;
		expect( deserializedBVH ).toMatchObject( testObj );

	} );

	it( 'should serialize then deserialize to the same structure with indirect = true.', () => {

		const bvh = new MeshBVH( geometry, { indirect: true } );
		const serialized = MeshBVH.serialize( bvh );
		const deserializedBVH = MeshBVH.deserialize( serialized, geometry );

		// use a custom object since anonymous functions cause the
		// test function to fail
		const testObj = { ...bvh };
		delete testObj.resolvePrimitiveIndex;
		expect( deserializedBVH ).toMatchObject( testObj );
		expect( bvh.resolveTriangleIndex( 0 ) ).toEqual( deserializedBVH.resolveTriangleIndex( 0 ) );

	} );

	it( 'should create a new index if one does not exist when deserializing.', () => {

		const bvh = new MeshBVH( geometry );
		const serialized = MeshBVH.serialize( bvh );

		geometry.setIndex( null );
		MeshBVH.deserialize( serialized, geometry );

		expect( geometry.index ).toBeTruthy();

	} );

	it( 'should create an index buffer with Uint16Array if the geometry is small enough.', () => {

		const geometry = new BufferGeometry();
		geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( 60000 * 3 ), 3, false ) );

		const bvh = new MeshBVH( geometry );
		expect( geometry.index.array instanceof Uint16Array ).toBe( true );
		expect( bvh ).toBeTruthy();

	} );

	it( 'should create an index buffer with Uint32Array if the geometry is large enough.', () => {

		const geometry = new BufferGeometry();
		geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( 70000 * 3 ), 3, false ) );

		const bvh = new MeshBVH( geometry );
		expect( geometry.index.array instanceof Uint32Array ).toBe( true );
		expect( bvh ).toBeTruthy();

	} );

	describe( 'cloneBuffers', () => {

		it( 'should clone the index buffer from the target geometry when true.', () => {

			const bvh = new MeshBVH( geometry );
			const serialized = MeshBVH.serialize( bvh, { cloneBuffers: true, indirect: true } );
			expect( geometry.index.array ).not.toBe( serialized.index );
			expect( bvh._roots ).not.toBe( serialized.roots );
			expect( bvh._roots[ 0 ] ).not.toBe( serialized.roots[ 0 ] );
			expect( bvh._roots ).toEqual( serialized.roots );
			expect( bvh._indirectBuffer ).toBe( serialized.indirectBuffer );

		} );

		it( 'should clone the index buffer from the target geometry when false.', () => {

			const bvh = new MeshBVH( geometry );
			const serialized = MeshBVH.serialize( bvh, { cloneBuffers: false, indirect: true } );
			expect( geometry.index.array ).toBe( serialized.index );
			expect( bvh._roots ).toBe( serialized.roots );
			expect( bvh._roots[ 0 ] ).toBe( serialized.roots[ 0 ] );
			expect( bvh._roots ).toEqual( serialized.roots );
			expect( bvh._indirectBuffer ).toBe( serialized.indirectBuffer );

		} );

	} );

	describe( 'setIndex', () => {

		it( 'should not copy the index buffer onto the target geometry if setIndex is false.', () => {

			const cloned = geometry.clone();
			const bvh = new MeshBVH( geometry );
			const serialized = MeshBVH.serialize( bvh, { cloneBuffers: true } );

			expect( cloned.index.array ).not.toBe( serialized.index );
			expect( cloned.index.array ).not.toEqual( serialized.index );

			MeshBVH.deserialize( serialized, cloned, { setIndex: false } );
			expect( cloned.index.array ).not.toBe( serialized.index );
			expect( cloned.index.array ).not.toEqual( serialized.index );

		} );

		it( 'should copy the index buffer onto the target geometry if setIndex is true.', () => {

			const cloned = geometry.clone();
			const bvh = new MeshBVH( geometry );
			const serialized = MeshBVH.serialize( bvh, { cloneBuffers: true } );

			expect( cloned.index.array ).not.toBe( serialized.index );
			expect( cloned.index.array ).not.toEqual( serialized.index );

			MeshBVH.deserialize( serialized, cloned, { setIndex: true } );
			expect( cloned.index.array ).not.toBe( serialized.index );
			expect( cloned.index.array ).toEqual( serialized.index );

		} );

	} );

	describe( 'indirect', () => {

		it( 'should correctly deserialize the bvh.', () => {

			const cloned = geometry.clone();
			const bvh = new MeshBVH( geometry, { indirect: true } );
			const serialized = MeshBVH.serialize( bvh );

			const deserialized = MeshBVH.deserialize( serialized, cloned );
			expect( deserialized.indirect ).toBe( true );
			expect( () => {

				deserialized.resolveTriangleIndex( 0 );

			} ).not.toThrow();

		} );

	} );

	describe( 'backwards compatibility', () => {

		it( 'should deserialize version 0 data (old byte offset format) correctly', () => {

			// create a serialized version of the file
			const geometry = new SphereGeometry( 1, 16, 16 );
			const bvh = new MeshBVH( geometry, { maxLeafTris: 5 } );
			const serialized = MeshBVH.serialize( bvh );

			// construct an old version of the json
			const oldSerialized = { ...serialized };

			// remove the version field
			delete oldSerialized.version;

			// convert to old format: uint32 absolute offsets
			oldSerialized.roots = oldSerialized.roots.map( root => {

				const clonedRoot = root.slice();
				const uint32Array = new Uint32Array( clonedRoot );
				const uint16Array = new Uint16Array( clonedRoot );
				const BYTES_PER_NODE = 32;
				const UINT32_PER_NODE = BYTES_PER_NODE / 4;
				const IS_LEAFNODE_FLAG = 0xFFFF;

				// revert the node indices to uint32 absolute indices rather than node indices
				for ( let node = 0, l = root.byteLength / BYTES_PER_NODE; node < l; node ++ ) {

					const node32Index = UINT32_PER_NODE * node;
					const node16Index = 2 * node32Index;
					const isLeaf = uint16Array[ node16Index + 15 ] === IS_LEAFNODE_FLAG;
					if ( ! isLeaf ) {

						uint32Array[ node32Index + 6 ] = ( node + uint32Array[ node32Index + 6 ] ) * UINT32_PER_NODE;

					}

				}

				return clonedRoot;

			} );

			// deserialize the old data to compare the structure
			const deserializedBVH = MeshBVH.deserialize( oldSerialized, geometry.clone() );
			expect( deserializedBVH ).toEqualBVH( bvh );

		} );

	} );

} );
