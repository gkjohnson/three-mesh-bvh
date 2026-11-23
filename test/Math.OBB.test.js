import { Vector3, Triangle, Plane, Box3, Euler } from 'three';
import { OrientedBox } from 'three-mesh-bvh';
import { setRandomVector, getRandomOrientation } from './utils.js';

describe( 'OBB Intersections', () => {

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

	it( 'should not intersect a box that is only separated along an edge cross axis', () => {

		// The boxes overlap when projected onto the three world axes and the three oriented box
		// axes, so only an axis built from the cross product of two edges separates them.
		const aabb = new Box3( new Vector3( - 1, - 1, - 1 ), new Vector3( 1, 1, 1 ) );
		const obb = new OrientedBox( new Vector3( - 1, - 1, - 1 ), new Vector3( 1, 1, 1 ) );
		obb.matrix
			.makeRotationFromEuler( new Euler( Math.PI / 4, Math.PI / 4, 0 ) )
			.setPosition( 2.2, 2.2, 0 );
		obb.needsUpdate = true;

		expect( obb.intersectsBox( aabb ) ).toBe( false );
		expect( obb.distanceToBox( aabb ) ).toBeGreaterThan( 0.2 );

		obb.matrix.setPosition( 1.8, 1.8, 0 );
		obb.needsUpdate = true;

		expect( obb.intersectsBox( aabb ) ).toBe( true );
		expect( obb.distanceToBox( aabb ) ).toBe( 0 );

	} );

} );

describe( 'OBB Distance', () => {

	it( 'should measure the distance to an AABB edge that sits on the max side of the third axis', () => {

		// Use a box with a different size on each axis so that mixing up the max values of
		// two axes produces a different edge.
		const aabb = new Box3(
			new Vector3( 0, 0, 0 ),
			new Vector3( 1, 2, 3 ),
		);

		// Orient a cube so that one of its edges points at the AABB edge running along x at
		// y = 2, z = 3, crossing it at a right angle. The closest points are then in the middle
		// of both edges rather than on a corner of either box.
		const edgeDirection = new Vector3( 0, 1, - 1 ).normalize();
		const outward = new Vector3( 0, 1, 1 ).normalize();
		const xAxis = new Vector3( 1, 0, 0 );
		const axis2 = xAxis.clone().add( outward ).normalize();
		const axis3 = xAxis.clone().sub( outward ).normalize();

		const halfSize = 0.5;
		const distance = 1;
		const center = new Vector3( 0.5, 2, 3 )
			.addScaledVector( outward, distance + halfSize * Math.SQRT2 );

		const box = new OrientedBox();
		box.min.setScalar( - halfSize );
		box.max.setScalar( halfSize );
		box.matrix.makeBasis( edgeDirection, axis2, axis3 ).setPosition( center );
		box.needsUpdate = true;

		expect( box.distanceToBox( aabb ) ).toBeCloseTo( distance, 5 );

	} );

	it( 'should set the target points when the boxes intersect', () => {

		const aabb = new Box3(
			new Vector3( 0, 0, 0 ),
			new Vector3( 2, 2, 2 ),
		);

		const box = new OrientedBox();
		box.min.setScalar( - 0.5 );
		box.max.setScalar( 0.5 );
		box.matrix.makeRotationY( Math.PI / 4 ).setPosition( 2, 1, 1 );
		box.needsUpdate = true;

		const target1 = new Vector3();
		const target2 = new Vector3();
		expect( box.distanceToBox( aabb, 0, target1, target2 ) ).toBe( 0 );

		// target1 is on this box and target2 is inside the AABB
		expect( box.distanceToPoint( target1 ) ).toBeCloseTo( 0, 5 );
		expect( aabb.containsPoint( target2 ) ).toBe( true );

	} );

} );
