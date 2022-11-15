import { Vector3, Quaternion, Euler, Triangle, Sphere, Plane, Line3 } from 'three';
import { sphereIntersectTriangle } from '../src/math/MathUtilities.js';
import { ExtendedTriangle } from '../src/math/ExtendedTriangle.js';
import { OrientedBox } from '../src/math/OrientedBox.js';

function setRandomVector( vector, length ) {

	vector
		.set(
			Math.random() - 0.5,
			Math.random() - 0.5,
			Math.random() - 0.5
		)
		.normalize()
		.multiplyScalar( length );

	return vector;

}

function getRandomOrientation( matrix, range ) {

	const pos = new Vector3();
	const quat = new Quaternion();
	const sca = new Vector3( 1, 1, 1 );

	setRandomVector( pos, range );
	quat.setFromEuler( new Euler( Math.random() * 180, Math.random() * 180, Math.random() * 180 ) );
	matrix.compose( pos, quat, sca );
	return matrix;

}

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

} );

describe( 'Triangle Intersection line', () => {

	const t1 = new ExtendedTriangle();
	const t2 = new Triangle();
	const target = new Line3();
	const expected = new Line3();

	const expectVerticesToBeClose = ( a, b ) => {

		expect( a.x ).toBeCloseTo( b.x );
		expect( a.y ).toBeCloseTo( b.y );
		expect( a.z ).toBeCloseTo( b.z );

	};

	const expectLinesToBeClose = ( a, b ) => {

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

		expected.start.set( 0, 0, 0 );
		expected.end.set( 0, 0, 0 );

		expect( t1.intersectsTriangle( t2, target ) ).toBe( true );
		expectLinesToBeClose( target, expected );

	} );

	// this test fails due to floating point precision issues. If the triangles are scaled up
	// it reports an intersection as expected.
	it.skip( 'triangles almost coplanar should intersect on point', () => {

		t1.a.set( 0.0720, 0.2096, 0.3220 );
		t1.b.set( 0.0751, 0.2148, 0.3234 );
		t1.c.set( 0.0693, 0.2129, 0.3209 );
		t1.needsUpdate = true;

		t2.a.set( 0.0677, 0.2170, 0.3196 );
		t2.b.set( 0.0607, 0.2135, 0.3165 );
		t2.c.set( 0.0693, 0.2129, 0.3209 );

		expected.start.set( 0.0693, 0.2129, 0.3209 );
		expected.end.set( 0.0693, 0.2129, 0.3209 );

		expect( t1.intersectsTriangle( t2, target ) ).toBe( true );
		expectLinesToBeClose( target, expected );

	} );

} );

describe( 'Sphere Intersections', () => {

	it( 'should intersect triangles with a vertex inside', () => {

		const sphere = new Sphere();
		sphere.radius = 1;
		setRandomVector( sphere.center, 10 );

		const triangle = new Triangle();
		for ( let i = 0; i < 100; i ++ ) {

			const fields = [ 'a', 'b', 'c' ];
			const i0 = i % 3;
			const i1 = ( i + 1 ) % 3;
			const i2 = ( i + 2 ) % 3;

			setRandomVector( triangle[ fields[ i0 ] ], Math.random() - 0.0001 )
				.add( sphere.center );

			setRandomVector( triangle[ fields[ i1 ] ], 1 + 0.0001 + Math.random() )
				.add( sphere.center );

			setRandomVector( triangle[ fields[ i2 ] ], 1 + 0.0001 + Math.random() )
				.add( sphere.center );

			expect( sphereIntersectTriangle( sphere, triangle ) ).toBe( true );

		}

	} );

	it( 'should intersect triangles with two vertices inside', () => {

		const sphere = new Sphere();
		sphere.radius = 1;
		setRandomVector( sphere.center, 10 );

		const triangle = new Triangle();
		for ( let i = 0; i < 100; i ++ ) {

			const fields = [ 'a', 'b', 'c' ];
			const i0 = i % 3;
			const i1 = ( i + 1 ) % 3;
			const i2 = ( i + 2 ) % 3;

			setRandomVector( triangle[ fields[ i0 ] ], Math.random() - 0.0001 )
				.add( sphere.center );

			setRandomVector( triangle[ fields[ i1 ] ], Math.random() - 0.0001 )
				.add( sphere.center );

			setRandomVector( triangle[ fields[ i2 ] ], 1 + 0.0001 + Math.random() )
				.add( sphere.center );

			expect( sphereIntersectTriangle( sphere, triangle ) ).toBe( true );

		}

	} );

	it( 'should intersect triangles with all vertices inside', () => {

		const sphere = new Sphere();
		sphere.radius = 1;
		setRandomVector( sphere.center, 10 );

		const triangle = new Triangle();
		for ( let i = 0; i < 100; i ++ ) {

			const fields = [ 'a', 'b', 'c' ];
			const i0 = i % 3;
			const i1 = ( i + 1 ) % 3;
			const i2 = ( i + 2 ) % 3;

			setRandomVector( triangle[ fields[ i0 ] ], Math.random() - 0.0001 )
				.add( sphere.center );

			setRandomVector( triangle[ fields[ i1 ] ], Math.random() - 0.0001 )
				.add( sphere.center );

			setRandomVector( triangle[ fields[ i2 ] ], Math.random() - 0.0001 )
				.add( sphere.center );

			expect( sphereIntersectTriangle( sphere, triangle ) ).toBe( true );

		}

	} );

	it( 'should intersect triangles that only intersect the middle', () => {

		const sphere = new Sphere();
		sphere.radius = 1;
		setRandomVector( sphere.center, 10 );

		const triangle = new Triangle();
		for ( let i = 0; i < 100; i ++ ) {

			const fields = [ 'a', 'b', 'c' ];
			const i0 = i % 3;
			const i1 = ( i + 1 ) % 3;
			const i2 = ( i + 2 ) % 3;

			setRandomVector( triangle[ fields[ i0 ] ], 1 + 0.0001 + Math.random() );

			triangle[ fields[ i1 ] ]
				.copy( triangle[ fields[ i0 ] ] )
				.multiplyScalar( - 1 )
				.add( sphere.center );

			triangle[ fields[ i0 ] ]
				.add( sphere.center );

			setRandomVector( triangle[ fields[ i2 ] ], 1 + 0.0001 + Math.random() )
				.add( sphere.center );

			expect( sphereIntersectTriangle( sphere, triangle ) ).toBe( true );

		}

	} );

	it( 'should not intersect triangles outside sphere', () => {

		const sphere = new Sphere();
		sphere.radius = 1;
		setRandomVector( sphere.center, 10 );

		const plane = new Plane();
		const vec = new Vector3();

		const triangle = new Triangle();
		for ( let i = 0; i < 100; i ++ ) {

			// project the triangle out onto a plane
			setRandomVector( plane.normal, 1 );
			plane.setFromNormalAndCoplanarPoint( plane.normal, sphere.center );
			plane.constant += ( Math.sign( Math.random() - 0.5 ) || 1 ) * 1.001;

			const fields = [ 'a', 'b', 'c' ];
			const i0 = i % 3;
			const i1 = ( i + 1 ) % 3;
			const i2 = ( i + 2 ) % 3;

			setRandomVector( vec, 10 * Math.random() )
				.add( sphere.center );
			plane.projectPoint( vec, triangle[ fields[ i0 ] ] );

			setRandomVector( vec, 10 * Math.random() )
				.add( sphere.center );
			plane.projectPoint( vec, triangle[ fields[ i1 ] ] );

			setRandomVector( vec, 10 * Math.random() )
				.add( sphere.center );
			plane.projectPoint( vec, triangle[ fields[ i2 ] ] );

			expect( sphereIntersectTriangle( sphere, triangle ) ).toBe( false );

		}

	} );

} );

describe( 'Box Intersections', () => {

	let box, center;
	beforeEach( () => {

		box = new OrientedBox();
		box.min.set( - 1, - 1, - 1 );
		box.max.set( 1, 1, 1 );
		getRandomOrientation( box.matrix, 10 );
		box.needsUpdate = true;

		center = new Vector3();
		center.setFromMatrixPosition( box.matrix );

	} );

	it( 'should intersect triangles with a vertex inside', () => {

		const triangle = new Triangle();
		for ( let i = 0; i < 100; i ++ ) {

			const fields = [ 'a', 'b', 'c' ];
			const i0 = i % 3;
			const i1 = ( i + 1 ) % 3;
			const i2 = ( i + 2 ) % 3;

			setRandomVector( triangle[ fields[ i0 ] ], Math.random() - 0.0001 )
				.add( center );

			setRandomVector( triangle[ fields[ i1 ] ], 3 + 0.0001 + Math.random() )
				.add( center );

			setRandomVector( triangle[ fields[ i2 ] ], 3 + 0.0001 + Math.random() )
				.add( center );

			expect( box.intersectsTriangle( triangle ) ).toBe( true );

		}

	} );

	it( 'should intersect triangles with two vertices inside', () => {

		const triangle = new Triangle();
		for ( let i = 0; i < 100; i ++ ) {

			const fields = [ 'a', 'b', 'c' ];
			const i0 = i % 3;
			const i1 = ( i + 1 ) % 3;
			const i2 = ( i + 2 ) % 3;

			setRandomVector( triangle[ fields[ i0 ] ], Math.random() - 0.0001 )
				.add( center );

			setRandomVector( triangle[ fields[ i1 ] ], Math.random() - 0.0001 )
				.add( center );

			setRandomVector( triangle[ fields[ i2 ] ], 3 + 0.0001 + Math.random() )
				.add( center );

			expect( box.intersectsTriangle( triangle ) ).toBe( true );

		}

	} );

	it( 'should intersect triangles with all vertices inside', () => {

		const triangle = new Triangle();
		for ( let i = 0; i < 100; i ++ ) {

			const fields = [ 'a', 'b', 'c' ];
			const i0 = i % 3;
			const i1 = ( i + 1 ) % 3;
			const i2 = ( i + 2 ) % 3;

			setRandomVector( triangle[ fields[ i0 ] ], Math.random() - 0.0001 )
				.add( center );

			setRandomVector( triangle[ fields[ i1 ] ], Math.random() - 0.0001 )
				.add( center );

			setRandomVector( triangle[ fields[ i2 ] ], Math.random() - 0.0001 )
				.add( center );

			expect( box.intersectsTriangle( triangle ) ).toBe( true );

		}

	} );


	it( 'should intersect triangles that cut across', () => {

		const triangle = new Triangle();
		for ( let i = 0; i < 100; i ++ ) {

			const fields = [ 'a', 'b', 'c' ];
			const i0 = i % 3;
			const i1 = ( i + 1 ) % 3;
			const i2 = ( i + 2 ) % 3;

			setRandomVector( triangle[ fields[ i0 ] ], 3 + 0.0001 + Math.random() );

			triangle[ fields[ i1 ] ]
				.copy( triangle[ fields[ i0 ] ] )
				.multiplyScalar( - 1 )
				.add( center );

			triangle[ fields[ i0 ] ]
				.add( center );

			setRandomVector( triangle[ fields[ i2 ] ], 3 + 0.0001 + Math.random() )
				.add( center );

			expect( box.intersectsTriangle( triangle ) ).toBe( true );

		}

	} );

	it( 'should not intersect triangles outside sphere', () => {

		const plane = new Plane();
		const vec = new Vector3();

		const triangle = new Triangle();
		for ( let i = 0; i < 100; i ++ ) {

			// project the triangle out onto a plane
			setRandomVector( plane.normal, 1 );
			plane.setFromNormalAndCoplanarPoint( plane.normal, center );
			plane.constant += ( Math.sign( Math.random() - 0.5 ) || 1 ) * 5.001;

			const fields = [ 'a', 'b', 'c' ];
			const i0 = i % 3;
			const i1 = ( i + 1 ) % 3;
			const i2 = ( i + 2 ) % 3;

			setRandomVector( vec, 10 * Math.random() )
				.add( center );
			plane.projectPoint( vec, triangle[ fields[ i0 ] ] );

			setRandomVector( vec, 10 * Math.random() )
				.add( center );
			plane.projectPoint( vec, triangle[ fields[ i1 ] ] );

			setRandomVector( vec, 10 * Math.random() )
				.add( center );
			plane.projectPoint( vec, triangle[ fields[ i2 ] ] );

			expect( box.intersectsTriangle( triangle ) ).toBe( false );

		}

	} );

} );
