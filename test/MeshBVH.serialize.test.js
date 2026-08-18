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

	describe( 'optimizeSize', () => {

		it( 'should only store the index range referenced by the BVH leaf nodes.', () => {

			const geometry = new SphereGeometry( 1, 32, 32 );
			const rangeStart = 300; // in vertex / index units
			const rangeCount = 600; // 200 triangles
			const bvh = new MeshBVH( geometry, { range: { start: rangeStart, count: rangeCount } } );

			const serialized = MeshBVH.serialize( bvh, { optimizeSize: true } );

			// the BVH only covers 600 indices starting at 300 so nothing else should be stored
			expect( serialized.indexOffset ).toBe( 300 );
			expect( serialized.index.length ).toBe( 600 );

			// the stored range must match the same slice of the live, reordered geometry index
			expect( Array.from( serialized.index ) ).toEqual( Array.from( geometry.index.array.slice( 300, 900 ) ) );

		} );

		it( 'should deserialize the stored range back into a matching BVH.', () => {

			const geometry = new SphereGeometry( 1, 32, 32 );
			const bvh = new MeshBVH( geometry, { range: { start: 300, count: 600 } } );

			const serialized = MeshBVH.serialize( bvh, { optimizeSize: true } );

			// a fresh geometry with the same shape still has its pristine index so the
			// reordered range referenced by the roots must be restored from the serialized data
			const target = new SphereGeometry( 1, 32, 32 );
			const deserialized = MeshBVH.deserialize( serialized, target );

			expect( target.index.array.slice( 300, 900 ) ).toEqual( serialized.index );
			expect( deserialized ).toEqualBVH( bvh );

		} );

		it( 'should not store an index buffer when the BVH is indirect.', () => {

			const geometry = new SphereGeometry( 1, 32, 32 );
			const bvh = new MeshBVH( geometry, { indirect: true, range: { start: 300, count: 600 } } );

			const serialized = MeshBVH.serialize( bvh, { optimizeSize: true } );

			expect( serialized.index ).toBe( null );
			expect( 'indexOffset' in serialized ).toBe( false );
			expect( serialized.indirectBuffer.length ).toBe( 200 );

			// deserialization requires no index data at all
			const deserialized = MeshBVH.deserialize( serialized, geometry.clone() );
			expect( deserialized ).toEqualBVH( bvh );

		} );

		it( 'should throw when deserializing a subrange into a geometry without an index.', () => {

			const geometry = new SphereGeometry( 5, 32, 32 );
			const bvh = new MeshBVH( geometry, { range: { start: 300, count: 600 } } );

			const serialized = MeshBVH.serialize( bvh, { optimizeSize: true } );
			expect( serialized.indexOffset ).toBeGreaterThan( 0 );

			const unindexed = new BufferGeometry();
			unindexed.setAttribute( 'position', new BufferAttribute( new Float32Array( 60000 * 3 ), 3, false ) );

			expect( () => MeshBVH.deserialize( serialized, unindexed ) ).toThrow();

		} );

		it( 'should throw when the geometry index buffer is too small for the stored range.', () => {

			const geometry = new SphereGeometry( 1, 64, 64 );
			const bvh = new MeshBVH( geometry, { range: { start: 300, count: 600 } } );

			const serialized = MeshBVH.serialize( bvh, { optimizeSize: true } );

			// a geometry whose index only holds 300 indices cannot accept a 600 index range
			const small = new BufferGeometry();
			small.setIndex( new BufferAttribute( new Uint16Array( 300 ), 1, false ) );

			expect( () => MeshBVH.deserialize( serialized, small ) ).toThrow( /larger than the geometry index buffer/ );

		} );

		it( 'should default to storing the full index when optimizeSize is not set.', () => {

			const geometry = new SphereGeometry( 1, 32, 32 );
			const bvh = new MeshBVH( geometry, { range: { start: 300, count: 600 } } );

			const serialized = MeshBVH.serialize( bvh );

			expect( 'indexOffset' in serialized ).toBe( false );
			expect( serialized.index.length ).toBe( geometry.index.count );

		} );

		it( 'should preserve the legacy serialized shape when optimizeSize is not set.', () => {

			const geometry = new SphereGeometry( 1, 32, 32 );
			const bvh = new MeshBVH( geometry );

			const serialized = MeshBVH.serialize( bvh );

			// the default output must keep the exact key shape serialized data has
			// always had so downstream consumers (JSON, key iteration) are unaffected
			expect( Object.keys( serialized ) ).toEqual( [ 'version', 'roots', 'index', 'indirectBuffer' ] );

		} );

		it( 'should deserialize data without an indexOffset field (legacy serialized data).', () => {

			const geometry = new SphereGeometry( 1, 32, 32 );
			const bvh = new MeshBVH( geometry );

			const serialized = MeshBVH.serialize( bvh );

			// data written before this option existed has no indexOffset field at all
			const legacyData = { ...serialized };
			delete legacyData.indexOffset;

			const deserialized = MeshBVH.deserialize( legacyData, geometry.clone() );
			expect( deserialized ).toEqualBVH( bvh );

		} );

		it( 'should not share buffers with the live BVH when cloneBuffers is true.', () => {

			const geometry = new SphereGeometry( 1, 32, 32 );
			const bvh = new MeshBVH( geometry, { range: { start: 300, count: 600 } } );

			const cloned = MeshBVH.serialize( bvh, { optimizeSize: true, cloneBuffers: true } );
			expect( cloned.index ).not.toBe( geometry.index.array );
			expect( cloned.roots[ 0 ] ).not.toBe( bvh._roots[ 0 ] );

			const shared = MeshBVH.serialize( bvh, { optimizeSize: true, cloneBuffers: false } );
			expect( shared.index.buffer ).toBe( geometry.index.array.buffer );
			expect( shared.roots[ 0 ] ).toBe( bvh._roots[ 0 ] );

		} );

	} );

	describe( 'backwards compatibility', () => {

		it( 'should deserialize version 0 data (old byte offset format) correctly', () => {

			// create a serialized version of the file
			const geometry = new SphereGeometry( 1, 16, 16 );
			const bvh = new MeshBVH( geometry, { targetLeafSize: 5 } );
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
