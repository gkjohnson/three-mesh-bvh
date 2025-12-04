import { SphereGeometry } from 'three';
import { MeshBVH, MeshBVHUniformStruct, getBVHExtremes } from 'three-mesh-bvh';

describe( 'MeshBVHUniformStruct', () => {

	let struct, geometry;
	beforeEach( () => {

		struct = new MeshBVHUniformStruct();
		geometry = new SphereGeometry( 1, 30, 30 );

	} );

	it( 'should fail if more than one group is present.', () => {

		geometry.addGroup( 0, 300, 0 );
		geometry.addGroup( 300, 600, 1 );

		const bvh = new MeshBVH( geometry );
		let error;

		try {

			struct.updateFrom( bvh );

		} catch ( e ) {

			error = e;

		}

		expect( error ).toBeTruthy();

	} );

	it( 'should create textures allocated for each element.', () => {

		const bvh = new MeshBVH( geometry );
		struct.updateFrom( bvh );

		const posAttr = geometry.attributes.position;
		const indexAttr = geometry.index;
		const bvhData = getBVHExtremes( bvh )[ 0 ];

		expect( posAttr.count ).toBeLessThanOrEqual( struct.position.image.width * struct.position.image.height );
		expect( indexAttr.count / 3 ).toBeLessThan( struct.index.image.width * struct.index.image.height );
		expect( bvhData.nodeCount ).toBeLessThan( struct.bvhBounds.image.width * struct.bvhBounds.image.height / 2 );
		expect( bvhData.nodeCount ).toBeLessThan( struct.bvhContents.image.width * struct.bvhContents.image.height );

	} );

	it( 'should create textures allocated for each element with indirect enabled.', () => {

		const bvh = new MeshBVH( geometry, { indirect: true } );
		struct.updateFrom( bvh );

		const posAttr = geometry.attributes.position;
		const indexAttr = geometry.index;
		const bvhData = getBVHExtremes( bvh )[ 0 ];

		expect( posAttr.count ).toBeLessThanOrEqual( struct.position.image.width * struct.position.image.height );
		expect( indexAttr.count / 3 ).toBeLessThan( struct.index.image.width * struct.index.image.height );
		expect( bvhData.nodeCount ).toBeLessThan( struct.bvhBounds.image.width * struct.bvhBounds.image.height / 2 );
		expect( bvhData.nodeCount ).toBeLessThan( struct.bvhContents.image.width * struct.bvhContents.image.height );

	} );

	it( 'should produce the same textures with indirect enabled.', () => {

		const bvh = new MeshBVH( geometry.clone(), { indirect: false } );
		const struct = new MeshBVHUniformStruct();
		struct.updateFrom( bvh );

		const bvhIndirect = new MeshBVH( geometry.clone(), { indirect: true } );
		const structIndirect = new MeshBVHUniformStruct();
		structIndirect.updateFrom( bvhIndirect );

		expect( struct.position.image ).toEqual( structIndirect.position.image );
		expect( struct.index.image ).toEqual( structIndirect.index.image );
		expect( struct.bvhBounds.image ).toEqual( structIndirect.bvhBounds.image );
		expect( struct.bvhContents.image ).toEqual( structIndirect.bvhContents.image );

	} );

	it( 'should produce the same textures even with indirect enabled and no index.', () => {

		const bvh = new MeshBVH( geometry.toNonIndexed(), { indirect: false } );
		const struct = new MeshBVHUniformStruct();
		struct.updateFrom( bvh );

		const bvhIndirect = new MeshBVH( geometry.toNonIndexed(), { indirect: true } );
		const structIndirect = new MeshBVHUniformStruct();
		structIndirect.updateFrom( bvhIndirect );

		expect( struct.position.image ).toEqual( structIndirect.position.image );
		expect( struct.index.image ).toEqual( structIndirect.index.image );
		expect( struct.bvhBounds.image ).toEqual( structIndirect.bvhBounds.image );
		expect( struct.bvhContents.image ).toEqual( structIndirect.bvhContents.image );

	} );

} );
