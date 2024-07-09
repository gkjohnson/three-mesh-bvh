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

	// SHOULD WE ADD NEW TEST WITH RANGE?

} );
