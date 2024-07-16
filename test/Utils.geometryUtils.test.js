import { SphereGeometry, BoxGeometry } from 'three';
import { getVertexCount, hasGroupGaps } from '../src/core/build/geometryUtils.js';

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
