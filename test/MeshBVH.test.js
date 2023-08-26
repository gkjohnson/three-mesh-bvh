import {
	Mesh,
	BufferGeometry,
	SphereGeometry,
	InterleavedBufferAttribute,
	InterleavedBuffer,
	BoxGeometry,
	Raycaster,
	MeshBasicMaterial,
	TorusGeometry,
	BufferAttribute,
	Vector3,
	Box3,
} from 'three';
import {
	MeshBVH,
	acceleratedRaycast,
	computeBoundsTree,
	disposeBoundsTree,
	validateBounds,
} from '../src/index.js';

Mesh.prototype.raycast = acceleratedRaycast;
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

// TODO: clean this up
describe( 'Bounds Tree', () => {

	it( 'should provide a bounding box that matches the built in one.', () => {

		const geom = new SphereGeometry();
		geom.translate( 2, 2, 2 );
		geom.computeBoundingBox();

		const bvh = new MeshBVH( geom );
		const box = new Box3();
		bvh.getBoundingBox( box );

		expect( box ).toEqual( geom.boundingBox );

	} );

	it( 'should properly encapsulate all triangles and bounds.', () => {

		const geom = new SphereGeometry( 500, 50, 50 );
		const bvh = new MeshBVH( geom );

		expect( validateBounds( bvh ) ).toBeTruthy();

	} );

	it( 'should be generated when calling BufferGeometry.computeBoundsTree.', () => {

		const geom = new SphereGeometry( 1, 1, 1 );
		expect( geom.boundsTree ).not.toBeDefined();

		geom.computeBoundsTree();
		expect( geom.boundsTree ).toBeDefined();

	} );

	it( 'should return a MeshBVH', () => {

		const geom = new SphereGeometry( 1, 1, 1 );

		expect( geom.computeBoundsTree() ).toBeInstanceOf( MeshBVH );

	} );

	it( 'should throw an error if InterleavedBufferAttributes are used', () => {

		const indexAttr = new InterleavedBufferAttribute( new InterleavedBuffer( new Uint32Array( [ 1, 2, 3 ] ), 1 ), 4, 0, false );
		let geometry;
		let indexErrorThrown = false;

		geometry = new BoxGeometry();
		geometry.setIndex( indexAttr );
		try {

			new MeshBVH( geometry, { verbose: false } );

		} catch ( e ) {

			indexErrorThrown = true;

		}

		expect( indexErrorThrown ).toBe( true );

	} );

	it( 'should use the boundsTree when raycasting if available', () => {

		const geom = new SphereGeometry( 1, 1, 1 );
		const mesh = new Mesh( geom, new MeshBasicMaterial() );
		const raycaster = new Raycaster();

		raycaster.ray.origin.set( 0, 0, 10 );
		raycaster.ray.direction.set( 0, 0, - 1 );

		let calledRaycast = false;
		let calledRaycastFirst = false;
		geom.boundsTree = {

			raycast: () => {

				calledRaycast = true;
				return {
					point: new Vector3(),
				};

			},
			raycastFirst: () => {

				calledRaycastFirst = true;
				return {
					point: new Vector3(),
				};

			},

		};

		mesh.raycast( raycaster, [] );
		expect( calledRaycast ).toBeTruthy();

		raycaster.firstHitOnly = true;
		mesh.raycast( raycaster, [] );
		expect( calledRaycastFirst ).toBeTruthy();

	} );

	it( 'should respect index group invariants', () => {

		const geo = new TorusGeometry( 5, 5, 400, 100 );
		const groupCount = 10;
		const groupSize = geo.index.array.length / groupCount;

		for ( let g = 0; g < groupCount; g ++ ) {

			const groupStart = g * groupSize;
			geo.addGroup( groupStart, groupSize, 0 );

		}

		const indicesByGroup = () => {

			const result = {};

			for ( let g = 0; g < geo.groups.length; g ++ ) {

				result[ g ] = new Set();
				const { start, count } = geo.groups[ g ];
				for ( let i = start; i < start + count; i ++ ) {

					result[ g ].add( geo.index.array[ i ] );

				}

			}

			return result;

		};

		const before = indicesByGroup();
		geo.computeBoundsTree();
		const after = indicesByGroup();

		for ( let g in before ) {

			expect( before[ g ] ).toEqual( after[ g ] );

		}

	} );

	it( 'should create a correctly sized and typed index if one does not exist', () => {

		const geom = new BufferGeometry();
		const smallPosAttr = new BufferAttribute( new Float32Array( 3 * Math.pow( 2, 16 ) - 3 ), 3, false );
		const largePosAttr = new BufferAttribute( new Float32Array( 3 * Math.pow( 2, 16 ) + 3 ), 3, false );

		geom.setAttribute( 'position', smallPosAttr );

		expect( geom.index ).toBe( null );
		new MeshBVH( geom );
		expect( geom.index ).not.toBe( null );
		expect( geom.index.count ).toBe( smallPosAttr.count );
		expect( geom.index.array.BYTES_PER_ELEMENT ).toBe( 2 );

		geom.index = null;
		geom.setAttribute( 'position', largePosAttr );
		new MeshBVH( geom );
		expect( geom.index ).not.toBe( null );
		expect( geom.index.count ).toBe( largePosAttr.count );
		expect( geom.index.array.BYTES_PER_ELEMENT ).toBe( 4 );

	} );

	describe( 'refit', () => {

		it( 'should resize the bounds to fit any updated triangles.', () => {

			const geom = new SphereGeometry( 1, 10, 10 );
			geom.computeBoundsTree();

			expect( validateBounds( geom.boundsTree ) ).toBe( true );

			geom.attributes.position.setX( 0, 10 );
			expect( validateBounds( geom.boundsTree ) ).toBe( false );

			geom.boundsTree.refit();
			expect( validateBounds( geom.boundsTree ) ).toBe( true );

		} );

	} );

} );

describe( 'BoundsTree API', () => {

	it.todo( 'test bounds tree and node apis directly' );

} );
