import { Vector3, Triangle, Plane, Box3 } from 'three';
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

	describe( 'intersecting boxes', () => {

		const aabb = new Box3(
			new Vector3( 0, 0, 0 ),
			new Vector3( 2, 2, 2 ),
		);

		// Long thin boxes whose closest point to the center of the AABB is outside of the AABB,
		// so clamping that point into the AABB gives a different point. `elements` is the matrix
		// in column-major order.
		const cases = [
			{
				halfLength: 1.297891540338603,
				elements: [ - 0.2408, - 0.3106, - 0.9195, 0, 0.1718, 0.9188, - 0.3554, 0, 0.9552, - 0.2436, - 0.1679, 0, 2.6699, 0.353, 1.1805, 1 ],
			},
			{
				halfLength: 0.9700240171976482,
				elements: [ 0.9091, - 0.2925, 0.2965, 0, 0.4165, 0.6318, - 0.6537, 0, 0.0039, 0.7178, 0.6963, 0, 2.3746, 0.7247, - 0.2438, 1 ],
			},
			{
				halfLength: 0.8014836062417139,
				elements: [ - 0.9198, 0.3774, - 0.1077, 0, - 0.326, - 0.8875, - 0.3255, 0, - 0.2185, - 0.2643, 0.9394, 0, 0.3406, - 0.3798, 0.6031, 1 ],
			},
		];

		cases.forEach( ( { halfLength, elements }, i ) => {

			it( `should return one point that is in both boxes (${ i })`, () => {

				const box = new OrientedBox();
				box.min.set( - halfLength, - halfLength * 0.3, - halfLength * 0.3 );
				box.max.set( halfLength, halfLength * 0.3, halfLength * 0.3 );
				box.matrix.fromArray( elements );
				box.needsUpdate = true;

				const target1 = new Vector3();
				const target2 = new Vector3();
				expect( box.distanceToBox( aabb, 0, target1, target2 ) ).toBe( 0 );

				expect( target2.distanceTo( target1 ) ).toBeCloseTo( 0, 5 );
				expect( box.distanceToPoint( target1 ) ).toBeCloseTo( 0, 3 );
				expect( aabb.distanceToPoint( target1 ) ).toBeCloseTo( 0, 5 );

			} );

		} );

		it( 'should still set both targets when the boxes are close but have no point in common', () => {

			// "intersectsBox" does not test the cross products of edges for separation, so this pair
			// reports an intersection although no point is in both boxes
			const box = new OrientedBox();
			box.min.setScalar( - 1 );
			box.max.setScalar( 1 );
			box.matrix.set(
				0.5644121856571941, - 0.5573632585911242, - 0.6089212450344894, 1.4011524042995989,
				- 0.7934259307774998, - 0.16268110373783445, - 0.586523785414111, 2.4665965963772534,
				0.227846828047983, 0.8141750772771932, - 0.5340456595546389, 3.4375762589279804,
				0, 0, 0, 1,
			);
			box.needsUpdate = true;
			expect( box.intersectsBox( aabb ) ).toBe( true );

			const target1 = new Vector3( NaN, NaN, NaN );
			const target2 = new Vector3( NaN, NaN, NaN );
			expect( box.distanceToBox( aabb, 0, target1, target2 ) ).toBe( 0 );
			expect( target1.toArray().every( Number.isFinite ) ).toBe( true );
			expect( target2.toArray().every( Number.isFinite ) ).toBe( true );

		} );

	} );

} );
