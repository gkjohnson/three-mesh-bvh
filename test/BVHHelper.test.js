import { Mesh, BufferGeometry, BufferAttribute, SphereGeometry } from 'three';
import { MeshBVH, BVHHelper } from 'three-mesh-bvh';

describe( 'BVHHelper', () => {

	it( 'should not generate non-finite positions for a BVH with empty bounds.', () => {

		const geometry = new BufferGeometry();
		geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( 0 ), 3 ) );
		geometry.boundsTree = new MeshBVH( geometry );

		const helper = new BVHHelper( new Mesh( geometry ) );
		expect( helper.children ).toHaveLength( 1 );

		const rootGeometry = helper.children[ 0 ].geometry;
		expect( rootGeometry.attributes.position.count ).toBe( 0 );

		rootGeometry.computeBoundingSphere();
		expect( rootGeometry.boundingSphere.radius ).not.toBeNaN();

	} );

	it( 'should generate bounds for a non-empty BVH.', () => {

		const geometry = new SphereGeometry();
		geometry.boundsTree = new MeshBVH( geometry );

		const helper = new BVHHelper( new Mesh( geometry ), 1 );
		const position = helper.children[ 0 ].geometry.attributes.position;
		expect( position.count ).toBe( 8 );
		expect( position.array.every( v => Number.isFinite( v ) ) ).toBe( true );

	} );

} );
