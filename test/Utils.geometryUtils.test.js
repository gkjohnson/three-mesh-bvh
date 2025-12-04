import { SphereGeometry, BoxGeometry, BufferGeometry, BufferAttribute, Raycaster, Mesh, DoubleSide, REVISION } from 'three';
import { getVertexCount, hasGroupGaps } from 'three-mesh-bvh/src/core/build/geometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';

describe( 'hasGroupGaps', () => {

	it( 'should not report a geometry with no groups.', () => {

		const geometry = new SphereGeometry();
		expect( hasGroupGaps( geometry ) ).toBe( false );

	} );

	it( 'should not report a geometry with properly formed groups.', () => {

		const geometry = new BoxGeometry();
		expect( hasGroupGaps( geometry ) ).toBe( false );

	} );

	it( 'should not report a geometry with final "infinite" group.', () => {

		const geometry = new SphereGeometry();
		geometry.addGroup( 0, Infinity, 0 );
		expect( hasGroupGaps( geometry ) ).toBe( false );

	} );

	it( 'should not report if range is "infinite".', () => {

		const geometry = new SphereGeometry();
		const range = { start: 0, count: Infinity };
		expect( hasGroupGaps( geometry, range ) ).toBe( false );

	} );

	it( 'should not report when range spans the entire vertex buffer while geometry.drawRange does not.', () => {

		const geometry = new SphereGeometry();
		geometry.setDrawRange( 10, getVertexCount( geometry ) - 11 );
		const range = { start: 0, count: getVertexCount( geometry ) };
		expect( hasGroupGaps( geometry, range ) ).toBe( false );

	} );

	it( 'should report when a geometry.drawRange does not span the whole vertex buffer.', () => {

		const geometry = new SphereGeometry();
		geometry.setDrawRange( 0, getVertexCount( geometry ) - 1, );
		expect( hasGroupGaps( geometry ) ).toBe( true );

	} );

	it( 'should report when a geometry has a group that does not span the whole vertex buffer.', () => {

		const geometry = new SphereGeometry();
		geometry.addGroup( 0, getVertexCount( geometry ) - 1, 0 );
		expect( hasGroupGaps( geometry ) ).toBe( true );

	} );

	it( 'should report when a geometry has two group that are not up against each other.', () => {

		const geometry = new SphereGeometry();
		geometry.addGroup( 0, 10, 0 );
		geometry.addGroup( 10, getVertexCount( geometry ) - 11, 0 );
		expect( hasGroupGaps( geometry ) ).toBe( true );

	} );

	it( 'should report when range does not span the whole vertex buffer.', () => {

		const geometry = new SphereGeometry();
		const range = { start: 0, count: getVertexCount( geometry ) - 1 };
		expect( hasGroupGaps( geometry, range ) ).toBe( true );

	} );

	it( 'should report when range does not span the whole vertex buffer while geometry groups do.', () => {

		const geometry = new BoxGeometry();
		const range = { start: 0, count: getVertexCount( geometry ) - 1 };
		expect( hasGroupGaps( geometry, range ) ).toBe( true );

	} );

	it( 'should report when a geometry has a group that does not span the whole vertex buffer while range does.', () => {

		const geometry = new SphereGeometry();
		geometry.addGroup( 0, getVertexCount( geometry ) - 1, 0 );
		const range = { start: 0, count: Infinity };
		expect( hasGroupGaps( geometry, range ) ).toBe( true );

	} );

} );

describe( 'intersectTri', () => {

	it( 'should comply with three.js return values in a degenerate case', () => {

		const raycaster = new Raycaster();
		raycaster.ray.origin.set( 0, 0, 1 );
		raycaster.ray.direction.set( 0, 0, - 1 );

		const position = new BufferAttribute( new Float32Array( [
			2, 0, 0,
			0, 0, 0,
			1, 1e-15, 0,
		] ), 3 );

		const normal = new BufferAttribute( new Float32Array( [
			0, 0, 1,
			0, 0, 1,
			0, 0, 1,
		] ), 3 );

		const uv = new BufferAttribute( new Float32Array( [
			1, 1,
			1, 1,
			1, 1,
		] ), 2 );

		const uv1 = new BufferAttribute( new Float32Array( [
			1, 1,
			1, 1,
			1, 1,
		] ), 2 );

		const degenerateGeometry = new BufferGeometry();
		degenerateGeometry.setAttribute( 'position', position );
		degenerateGeometry.setAttribute( 'normal', normal );
		degenerateGeometry.setAttribute( 'uv', uv );
		degenerateGeometry.setAttribute( 'uv1', uv1 );

		const mesh = new Mesh( degenerateGeometry );
		mesh.material.side = DoubleSide;
		const bvh = new MeshBVH( degenerateGeometry );

		const bvhHit = bvh.raycastFirst( raycaster.ray, DoubleSide );
		let threeHit;
		const getThreeHit = () => {

			threeHit = raycaster.intersectObject( mesh, true )[ 0 ];

		};

		const revision = parseInt( REVISION );
		/* eslint-disable vitest/no-conditional-expect */
		if ( 169 > revision && revision > 159 ) {

			expect( getThreeHit ).toThrow();

			expect( bvhHit.barycoord ).toBeUndefined();
			expect( bvhHit.normal ).toBeNull();
			expect( bvhHit.uv ).toBeNull();
			expect( bvhHit.uv1 ).toBeNull();

			if ( revision <= 161 ) {

				expect( bvhHit.uv2 ).toBeNull();

			} else {

				expect( bvhHit.uv2 ).toBeUndefined();

			}

		} else {

			getThreeHit();

			if ( 'object' in threeHit ) {

				delete threeHit.object;

			}

			expect( bvhHit ).toEqual( threeHit );

		}
		/* eslint-enable vitest/no-conditional-expect */

	} );

} );
