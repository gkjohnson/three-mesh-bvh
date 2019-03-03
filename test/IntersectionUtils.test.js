/* global
    describe it beforeAll beforeEach afterEach expect
*/

import * as THREE from 'three';
import { sphereIntersectTriangle, boxToObbPlanes, boxIntersectsTriangle, boxToObbPoints } from '../src/BoundsUtilities.js';

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

// TODO: re-enable the rotation here and address issues in the tests
function getRandomOrientation( matrix, range ) {

	const pos = new THREE.Vector3();
	const quat = new THREE.Quaternion();
	const sca = new THREE.Vector3( 1, 1, 1 );

	setRandomVector( pos, range );
	quat.setFromEuler( new THREE.Euler( Math.random() * 180, Math.random() * 180, Math.random() * 180 ) );
	matrix.compose( pos, quat, sca );
	return matrix;

}

describe( 'Sphere Intersections', () => {

	it( 'Should intersect triangles with a vertex inside', () => {

		const sphere = new THREE.Sphere();
		sphere.radius = 1;
		setRandomVector( sphere.center, 10 );

		const triangle = new THREE.Triangle();
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

	it( 'Should intersect triangles with two vertices inside', () => {

		const sphere = new THREE.Sphere();
		sphere.radius = 1;
		setRandomVector( sphere.center, 10 );

		const triangle = new THREE.Triangle();
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

	it( 'Should intersect triangles with all vertices inside', () => {

		const sphere = new THREE.Sphere();
		sphere.radius = 1;
		setRandomVector( sphere.center, 10 );

		const triangle = new THREE.Triangle();
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

	it( 'Should intersect triangles that only intersect the middle', () => {

		const sphere = new THREE.Sphere();
		sphere.radius = 1;
		setRandomVector( sphere.center, 10 );

		const triangle = new THREE.Triangle();
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

	it( 'Should not intersect triangles outside sphere', () => {

		const sphere = new THREE.Sphere();
		sphere.radius = 1;
		setRandomVector( sphere.center, 10 );

		const plane = new THREE.Plane();
		const vec = new THREE.Vector3();

		const triangle = new THREE.Triangle();
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

	const obbPlanes = new Array( 6 ).fill().map( () => new THREE.Plane() );
	const obbPoints = new Array( 8 ).fill().map( () => new THREE.Vector3() );

	let box, boxToWorld, invMat, center;
	beforeEach( () => {

		box = new THREE.Box3();
		box.min.set( - 1, - 1, - 1 );
		box.max.set( 1, 1, 1 );

		// TODO: understand the inversion and what matrix is needed to pass into
		// functions -- is an inverted matrix needed?
		boxToWorld = getRandomOrientation( new THREE.Matrix4(), 10 );
		// const invMat = new THREE.Matrix4().getInverse( boxToWorld );
		boxToObbPlanes( box, boxToWorld, obbPlanes );
		boxToObbPoints( box, boxToWorld, obbPoints );

		center = new THREE.Vector3();
		center.setFromMatrixPosition( boxToWorld );

	} );

	it( 'Should intersect triangles with a vertex inside', () => {

		const triangle = new THREE.Triangle();
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

			expect( boxIntersectsTriangle( obbPlanes, obbPoints, triangle ) ).toBe( true );

		}

	} );

	it( 'Should intersect triangles with two vertices inside', () => {

		const triangle = new THREE.Triangle();
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

			expect( boxIntersectsTriangle( obbPlanes, obbPoints, triangle ) ).toBe( true );

		}

	} );

	it( 'Should intersect triangles with all vertices inside', () => {

		const triangle = new THREE.Triangle();
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

			expect( boxIntersectsTriangle( obbPlanes, obbPoints, triangle ) ).toBe( true );

		}

	} );


	it( 'Should intersect triangles that cut across', () => {

		const triangle = new THREE.Triangle();
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

			expect( boxIntersectsTriangle( obbPlanes, obbPoints, triangle ) ).toBe( true );

		}

	} );

	// TODO: Fix this test
	it( 'Should not intersect triangles outside sphere', () => {

		const center = new THREE.Vector3();
		center.setFromMatrixPosition( boxToWorld );

		const plane = new THREE.Plane();
		const vec = new THREE.Vector3();

		const triangle = new THREE.Triangle();
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
				.set( center );
			plane.projectPoint( vec, triangle[ fields[ i0 ] ] );

			setRandomVector( vec, 10 * Math.random() )
				.set( center );
			plane.projectPoint( vec, triangle[ fields[ i1 ] ] );

			setRandomVector( vec, 10 * Math.random() )
				.set( center );
			plane.projectPoint( vec, triangle[ fields[ i2 ] ] );

			expect( boxIntersectsTriangle( obbPlanes, obbPoints, triangle ) ).toBe( false );

		}

	} );

} );
