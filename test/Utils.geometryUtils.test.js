import { SphereGeometry, BoxGeometry, Ray, Vector3, BufferGeometry, DoubleSide, REVISION, BufferAttribute } from 'three';
import { getVertexCount, hasGroupGaps } from '../src/core/build/geometryUtils.js';
import { intersectTri } from '../src/utils/ThreeRayIntersectUtilities.js';

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

		const ray = new Ray();
		ray.origin.set( 0, 0, 1 );
		ray.direction.set( 0, 0, - 1 );

		const position = new BufferAttribute( new Float32Array( [
			2, 0, 0,
			0, 0, 0,
			1, 1e-20, 0,
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

		const geo = new BufferGeometry();
		geo.setAttribute( 'position', position );
		geo.setAttribute( 'normal', normal );
		geo.setAttribute( 'uv', uv );
		geo.setAttribute( 'uv1', uv1 );

		const intersection = intersectTri( geo, DoubleSide, ray, 0, undefined, 0, 10 );

		expect( intersection !== null ).toBe( true );

		if ( parseInt( REVISION ) >= 169 ) {

			expect( intersection.barycoord.equals( new Vector3() ) ).toBe( true );
			expect( intersection.uv.equals( new Vector3() ) ).toBe( true );
			expect( intersection.uv1.equals( new Vector3() ) ).toBe( true );
			expect( intersection.normal.equals( new Vector3() ) ).toBe( true );

		} else {

			expect( intersection.barycoord === undefined ).toBe( true );
			expect( intersection.uv === null ).toBe( true );
			expect( intersection.uv1 === null ).toBe( true );
			expect( intersection.normal === null ).toBe( true );

		}

	} );

} );
