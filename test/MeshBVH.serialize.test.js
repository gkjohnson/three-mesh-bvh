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
		delete testObj.resolveTriangleIndex;
		expect( deserializedBVH ).toMatchObject( testObj );

	} );

	it( 'should serialize then deserialize to the same structure with indirect = true.', () => {

		const bvh = new MeshBVH( geometry, { indirect: true } );
		const serialized = MeshBVH.serialize( bvh );
		const deserializedBVH = MeshBVH.deserialize( serialized, geometry );

		// use a custom object since anonymous functions cause the
		// test function to fail
		const testObj = { ...bvh };
		delete testObj.resolveTriangleIndex;
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

} );
