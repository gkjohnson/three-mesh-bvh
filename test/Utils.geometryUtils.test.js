import { BufferGeometry, BufferAttribute, Raycaster, Mesh, DoubleSide, REVISION } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

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
