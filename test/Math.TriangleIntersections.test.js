import { Triangle, Line3 } from 'three';
import { ExtendedTriangle } from '../src/math/ExtendedTriangle.js';

describe( 'Triangle Intersections', () => {

	const t1 = new ExtendedTriangle();
	const t2 = new Triangle();

	it( 'should return false if they are at different angles but not intersecting', () => {

		t1.a.set( - 1, - 1, 0 );
		t1.b.set( 1, - 1, 0 );
		t1.c.set( 0, 1, 0 );
		t1.needsUpdate = true;

		t2.a.set( - 1, 0, 0 );
		t2.b.set( 0, 0, 1 );
		t2.c.set( - 2, 0, 1 );
		t2.needsUpdate = true;

		expect( t1.intersectsTriangle( t2 ) ).toBe( false );

	} );

	it( 'should return true if just one vertex is in the middle of a triangle', () => {

		t1.a.set( - 1, 0, 0 );
		t1.b.set( 1, 0, 0 );
		t1.c.set( 0, 1, 0 );
		t1.needsUpdate = true;

		t2.a.set( 0, 0.5, 0 );
		t2.b.set( - 1, 0.5, 1 );
		t2.c.set( 1, 0.5, 1 );

		expect( t1.intersectsTriangle( t2 ) ).toBe( true );

	} );

	it( 'should return true if just one vertex is overlapping', () => {

		t1.a.set( - 1, 0, 0 );
		t1.b.set( 1, 0, 0 );
		t1.c.set( 0, 1, 0 );
		t1.needsUpdate = true;

		t2.a.set( - 1, 0, 0 );
		t2.b.set( - 3, 0, 0 );
		t2.c.set( - 2, 0, 1 );

		expect( t1.intersectsTriangle( t2 ) ).toBe( true );

	} );

	it( 'should return true if the triangles are intersecting at an angle', () => {

		t1.a.set( - 1, 0, 0 );
		t1.b.set( 1, 0, 0 );
		t1.c.set( 0, 1, 0 );
		t1.needsUpdate = true;

		t2.a.set( 0, 0.5, 0.5 );
		t2.b.set( 0.5, 0.5, - 0.5 );
		t2.c.set( - 0.5, 0.5, - 0.5 );

		expect( t1.intersectsTriangle( t2 ) ).toBe( true );

	} );

	// coplanar cases
	it( 'should return false if the triangles are on the same plane but separated', () => {

		t1.a.set( - 1, 0, 0 );
		t1.b.set( 1, 0, 0 );
		t1.c.set( 0, 1, 0 );
		t1.needsUpdate = true;

		t2.a.set( - 3, 0, 0 );
		t2.b.set( - 1.001, 0, 0 );
		t2.c.set( - 2, 1, 0 );

		expect( t1.intersectsTriangle( t2 ) ).toBe( false );

	} );

	it( 'should return true if the triangles are the same', () => {

		t1.a.set( - 1, 0, 0 );
		t1.b.set( 1, 0, 0 );
		t1.c.set( 0, 1, 0 );
		t1.needsUpdate = true;

		t2.a.set( - 1, 0, 0 );
		t2.b.set( 1, 0, 0 );
		t2.c.set( 0, 1, 0 );

		expect( t1.intersectsTriangle( t2 ) ).toBe( true );

	} );

	it( 'should return true if the triangles are on the same plane and overlapping', () => {

		t1.a.set( - 1, 0, 0 );
		t1.b.set( 1, 0, 0 );
		t1.c.set( 0, 1, 0 );
		t1.needsUpdate = true;

		t2.a.set( - 2, 0, 0 );
		t2.b.set( 0, 0, 0 );
		t2.c.set( - 1, 1, 0 );

		expect( t1.intersectsTriangle( t2 ) ).toBe( true );

	} );

	it( 'should return true if one triangle is completely inside the other', () => {

		t1.a.set( - 1, 0, 0 );
		t1.b.set( 1, 0, 0 );
		t1.c.set( 0, 1, 0 );
		t1.needsUpdate = true;

		t2.a.set( - 0.5, 0.25, 0 );
		t2.b.set( 0.5, 0.25, 0 );
		t2.c.set( 0, 0.75, 0 );

		expect( t1.intersectsTriangle( t2 ) ).toBe( true );

	} );

	it( 'should return false if they the same but offset on one axis', () => {

		t1.a.set( - 1, 0, 0 );
		t1.b.set( 1, 0, 0 );
		t1.c.set( 0, 1, 0 );
		t1.needsUpdate = true;

		t2.a.set( - 1, 0, 0.01 );
		t2.b.set( 1, 0, 0.01 );
		t2.c.set( 0, 1, 0.01 );

		expect( t1.intersectsTriangle( t2 ) ).toBe( false );

	} );

	it( 'should return false when triangles are disconnected with aligned vertices on y.', () => {

		t1.a.set( - 0.5, 0.5, 1.5 );
		t1.b.set( - 0.5, 0.5, 2.5 );
		t1.c.set( 0.5, 0.5, 1.5 );
		t1.needsUpdate = true;

		t2.a.set( 0.5, 0.5, 0.5 );
		t2.b.set( 0.5, - 0.5, 0.5 );
		t2.c.set( 0.5, 0.5, - 0.5 );
		t2.needsUpdate = true;

		expect( t1.intersectsTriangle( t2 ) ).toBe( false );

	} );

	it( 'triangles should return a correct intersection (issue #655)', () => {

		t1.a.set( 32.22699737548828, 1.2630000114440918, - 11.8149995803833 );
		t1.b.set( 31.316997528076172, 1.2630000114440918, - 11.739999771118164 );
		t1.c.set( 32.22699737548828, 1.2630000114440918, - 11.739999771118164 );
		t1.needsUpdate = true;

		t2.a.set( 31.316997528076172, 1.933000087738037, - 7.585000038146973 );
		t2.b.set( 31.316997528076172, - 0.8669999837875366, - 7.295000076293945 );
		t2.c.set( 31.316997528076172, - 0.8669999837875366, - 7.585000038146973 );
		t2.needsUpdate = true;

		expect( t1.intersectsTriangle( t2 ) ).toBe( false );

		t2.a.set( 32.22699737548828, 1.2630000114440918, - 11.8149995803833 );
		t2.b.set( 31.316997528076172, 1.2630000114440918, - 11.739999771118164 );
		t2.c.set( 32.22699737548828, 1.2630000114440918, - 11.739999771118164 );
		t2.needsUpdate = true;

		t1.a.set( 31.316997528076172, 1.933000087738037, - 7.585000038146973 );
		t1.b.set( 31.316997528076172, - 0.8669999837875366, - 7.295000076293945 );
		t1.c.set( 31.316997528076172, - 0.8669999837875366, - 7.585000038146973 );
		t1.needsUpdate = true;

		expect( t1.intersectsTriangle( t2 ) ).toBe( false );

	} );

	it( 'coplanar triangles should be separated by an axis orthogonal to edge', () => {

		t1.a.set( 1, 4, 0 );
		t1.b.set( 3, 2, 0 );
		t1.c.set( 4, 4, 0 );
		t1.needsUpdate = true;

		t2.a.set( 4, 3, 0 );
		t2.b.set( 5, 1, 0 );
		t2.c.set( 6, 3, 0 );
		t2.needsUpdate = true;

		expect( t1.intersectsTriangle( t2 ) ).toBe( false );

	} );

	it( 'Triangle-segment intersection parallel to edge', () => {

		t1.a.set( 1, 4, 0 );
		t1.b.set( 3, 2, 0 );
		t1.c.set( 4, 4, 0 );
		t1.needsUpdate = true;

		t2.a.set( 1, 5, 0 );
		t2.b.set( 1, 5 + 1e-16, 0 );
		t2.c.set( 5, 5, 0 );
		t2.needsUpdate = true;

		expect( t1.intersectsTriangle( t2 ) ).toBe( false );

	} );

	it( 'Triangle-segment intersection intersecting edge', () => {

		t1.a.set( 1, 4, 0 );
		t1.b.set( 3, 2, 0 );
		t1.c.set( 4, 4, 0 );
		t1.needsUpdate = true;

		t2.a.set( 3, 5, 0 );
		t2.b.set( 3, 5 + 1e-16, 0 );
		t2.c.set( 3, 3, 0 );
		t2.needsUpdate = true;

		expect( t1.intersectsTriangle( t2 ) ).toBe( true );

	} );

	it( 'Triangle-segment intersection; segment separating axis', () => {

		t1.a.set( 1, 4, 0 );
		t1.b.set( 3, 2, 0 );
		t1.c.set( 5, 4, 0 );
		t1.needsUpdate = true;

		t2.a.set( 0, 1, 0 );
		t2.b.set( 20, 6, 0 );
		t2.c.set( 20, 6, 0 );
		t2.needsUpdate = true;

		expect( t1.intersectsTriangle( t2 ) ).toBe( false );

	} );

	it( 'Triangle-segment intersection; Non-coplanar', () => {

		t1.a.set( 1, 4, 0 );
		t1.b.set( 3, 2, 0 );
		t1.c.set( 5, 4, 0 );
		t1.needsUpdate = true;

		t2.a.set( 3, 3, 2 );
		t2.b.set( 3, 3, 2 );
		t2.c.set( 3, 3, - 2 );
		t2.needsUpdate = true;

		expect( t1.intersectsTriangle( t2 ) ).toBe( true );

	} );

	it( 'Segment-point intersection false', () => {

		t1.a.set( 0.157, 0.062, 0.211 );
		t1.b.set( 0.277, 0.386, 0.535 );
		t1.c.set( 0.277, 0.386, 0.535 );
		t1.needsUpdate = true;

		t2.a.set( 0.463, 0.382, 0.150 );
		t2.b.set( 0.463, 0.382, 0.150 );
		t2.c.set( 0.463, 0.382, 0.150 );
		t2.needsUpdate = true;

		expect( t1.intersectsTriangle( t2 ) ).toBe( false );

	} );

	it( 'Segment-point intersection true', () => {

		t1.a.set( 0.157, 0.062, 0.211 );
		t1.b.set( 0.277, 0.386, 0.535 );
		t1.c.set( 0.277, 0.386, 0.535 );
		t1.needsUpdate = true;

		// Midpoint
		t2.a.set( 0.217, 0.224, 0.373 );
		t2.b.set( 0.217, 0.224, 0.373 );
		t2.c.set( 0.217, 0.224, 0.373 );
		t2.needsUpdate = true;

		expect( t1.intersectsTriangle( t2 ) ).toBe( true );

	} );

	it( 'Segment-segment intersection false', () => {

		t1.a.set( 0.157, 0.062, 0.211 );
		t1.b.set( 0.277, 0.386, 0.535 );
		t1.c.set( 0.277, 0.386, 0.535 );
		t1.needsUpdate = true;

		t2.a.set( 0.147, 0.062, 0.211 );
		t2.b.set( 0.077, 0.860, 0.135 );
		t2.c.set( 0.077, 0.860, 0.135 );
		t2.needsUpdate = true;

		expect( t1.intersectsTriangle( t2 ) ).toBe( false );

	} );

	it( 'Segment-segment intersection true', () => {

		t1.a.set( 0.157, 0.062, 0.211 );
		t1.b.set( 0.277, 0.386, 0.535 );
		t1.c.set( 0.277, 0.386, 0.535 );
		t1.needsUpdate = true;

		// Intersect at midpoint ( 0.217, 0.224, 0.373 );

		t2.a.set( 0.217, 0.324, 0.373 );
		t2.b.set( 0.217, 0.124, 0.373 );
		t2.c.set( 0.217, 0.124, 0.373 );
		t2.needsUpdate = true;

		expect( t1.intersectsTriangle( t2 ) ).toBe( true );

	} );

} );

describe( 'Triangle Intersection line', () => {

	const t1 = new ExtendedTriangle();
	const t2 = new ExtendedTriangle();
	const target = new Line3();
	const expected = new Line3();

	const expectVerticesToBeClose = ( a, b ) => {

		expect( a.x ).toBeCloseTo( b.x );
		expect( a.y ).toBeCloseTo( b.y );
		expect( a.z ).toBeCloseTo( b.z );

	};

	const expectLinesToBeClose = ( a, b ) => {

		// Try both line orientations
		try {

			expectVerticesToBeClose( a.start, b.start );
			expectVerticesToBeClose( a.end, b.end );

		} catch {

			expectVerticesToBeClose( a.end, b.start );
			expectVerticesToBeClose( a.start, b.end );

		}

	};

	it( 'should intersect on point', () => {

		t1.a.set( 0, 0, 0 );
		t1.b.set( 0, 0, 2 );
		t1.c.set( 2, 0, 0 );
		t1.needsUpdate = true;

		t2.a.set( 1, - 1, 0 );
		t2.b.set( 1, 1, 0 );
		t2.c.set( 1, 0, - 1 );
		t2.needsUpdate = true;

		expected.start.set( 1, 0, 0 );
		expected.end.set( 1, 0, 0 );

		expect( t1.intersectsTriangle( t2, target ) ).toBe( true );
		expectLinesToBeClose( target, expected );

	} );

	it( 'should intersect', () => {

		t1.a.set( 0, 0, 0 );
		t1.b.set( 0, 0, 5 );
		t1.c.set( 5, 0, 0 );
		t1.needsUpdate = true;

		t2.a.set( 1, - 1, 1 );
		t2.b.set( 1, - 1, - 1 );
		t2.c.set( 1, 1, 1 );
		t2.needsUpdate = true;

		expected.start.set( 1, 0, 0 );
		expected.end.set( 1, 0, 1 );

		expect( t1.intersectsTriangle( t2, target ) ).toBe( true );
		expectLinesToBeClose( target, expected );

	} );

	it( 'should intersect on common side', () => {

		t1.a.set( 0, 0, 0 );
		t1.b.set( 3, 0, 0 );
		t1.c.set( 0, 1, 2 );
		t1.needsUpdate = true;

		t2.a.set( 1, 0, 0 );
		t2.b.set( 2, 0, 0 );
		t2.c.set( 0, 1, - 2 );
		t2.needsUpdate = true;

		expected.start.set( 1, 0, 0 );
		expected.end.set( 2, 0, 0 );

		expect( t1.intersectsTriangle( t2, target ) ).toBe( true );
		expectLinesToBeClose( target, expected );

	} );

	// coplanar cases
	it( 'should support triangles that intersect along a coplanar edge.', () => {

		t1.b.set( - 1, 0, 0 );
		t1.c.set( 2, 0, 0 );
		t1.a.set( 2, 0, 2 );
		t1.needsUpdate = true;

		t2.a.set( 1, 0, 0 );
		t2.b.set( - 2, - 2, 0 );
		t2.c.set( - 2, 2, 0 );
		t2.needsUpdate = true;

		expected.start.set( - 1, 0, 0 );
		expected.end.set( 1, 0, 0 );

		expect( t1.intersectsTriangle( t2, target ) ).toBe( true );
		expectLinesToBeClose( target, expected );

	} );

	it( 'should be coplanar and line is zero', () => {

		t1.a.set( 0, 0, 0 );
		t1.b.set( 3, 0, 0 );
		t1.c.set( 0, 0, 2 );
		t1.needsUpdate = true;

		t2.a.set( 1, 0, 0 );
		t2.b.set( 2, 0, 0 );
		t2.c.set( 0, 0, - 2 );
		t2.needsUpdate = true;

		expected.start.set( 0, 0, 0 );
		expected.end.set( 0, 0, 0 );

		expect( t1.intersectsTriangle( t2, target ) ).toBe( true );
		expectLinesToBeClose( target, expected );

	} );

	it( 'triangles almost coplanar should intersect on point', () => {

		t1.a.set( 0.0720, 0.2096, 0.3220 );
		t1.b.set( 0.0751, 0.2148, 0.3234 );
		t1.c.set( 0.0693, 0.2129, 0.3209 );
		t1.needsUpdate = true;

		t2.a.set( 0.0677, 0.2170, 0.3196 );
		t2.b.set( 0.0607, 0.2135, 0.3165 );
		t2.c.set( 0.0693, 0.2129, 0.3209 );
		t2.needsUpdate = true;

		expected.start.set( 0.0693, 0.2129, 0.3209 );
		expected.end.set( 0.0693, 0.2129, 0.3209 );

		expect( t1.intersectsTriangle( t2, target ) ).toBe( true );
		expectLinesToBeClose( target, expected );

		expect( t2.intersectsTriangle( t1, target ) ).toBe( true );
		expectLinesToBeClose( target, expected );

	} );

	// this test fails due to a bug in the intersection function. It only intersects
	// on one triangle intersection order.
	it( 'triangles should return a correct intersection (issue #538)', () => {

		t1.a.set( - 5.781455993652344, - 7.291503906249993, - 30 );
		t1.b.set( - 5.781455993652344, - 7.291503906250007, 30 );
		t1.c.set( 0, - 7.291503906249993, - 30 );
		t1.needsUpdate = true;

		t2.a.set( - 5.781455993652344, - 7.29150390625, - 4.098872661590576 );
		t2.b.set( - 6.386039733886719, - 11.163619995117188, - 4.485982418060303 );
		t2.c.set( 13.468360900878906, - 6.142303466796875, - 4.028029918670654 );
		t2.needsUpdate = true;

		expected.start.set( - 2.4950, - 7.2915, - 4.1065 );
		expected.end.set( - 5.7815, - 7.2915, - 4.0989 );

		expect( t1.intersectsTriangle( t2, target ) ).toBe( true );
		expectLinesToBeClose( target, expected );

		expect( t2.intersectsTriangle( t1, target ) ).toBe( true );
		expectLinesToBeClose( target, expected );

	} );

	it( 'triangles should return a correct intersection (issue #543)', () => {

		t1.a.set( - 15.430519104003906, 29.432968139648445, - 25 );
		t1.b.set( - 15.430519104003906, 29.43296813964843, 25 );
		t1.c.set( 0, 29.432968139648445, - 25 );
		t1.needsUpdate = true;

		t2.a.set( - 4.854911804199219, 36.03794860839844, 0.0777292251586914 );
		t2.b.set( - 15.430519104003906, 29.432968139648438, - 1.905876636505127 );
		t2.c.set( - 16.118995666503906, 26.96272277832031, - 2.8487582206726074 );
		t2.needsUpdate = true;

		expected.start.set( - 15.4305, 29.433, - 1.9059 );
		expected.end.set( - 13.053, 29.4323, - 2.0522 );

		expect( t1.intersectsTriangle( t2, target ) ).toBe( true );
		expectLinesToBeClose( target, expected );

		expect( t2.intersectsTriangle( t1, target ) ).toBe( true );
		expectLinesToBeClose( target, expected );

	} );

	it( 'triangles should not intersect (issue #762)', () => {

		t1.a.set( - 8.367500305175781, - 7.513999938964844, 34.45796585083008 );
		t1.b.set( - 8.367500305175781, - 7.513999938964844, 34.45796585083008 );
		t1.c.set( - 7.6875, - 6.870999813079834, 8.499966621398926 );
		t1.needsUpdate = true;

		t2.a.set( 110.03839111328125, - 110.03839111328125, 220.1000061035156 );
		t2.b.set( - 110.03839111328125, - 110.03839111328125, 220.1000061035156 );
		t2.c.set( 110.07498931884766, - 110.07498931884766, 220.17320251464844 );
		t2.needsUpdate = true;

		expect( t1.intersectsTriangle( t2 ) ).toBe( false );
		expect( t2.intersectsTriangle( t1 ) ).toBe( false );

	} );

} );
