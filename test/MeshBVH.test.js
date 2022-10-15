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
} from 'three';
import {
	MeshBVH,
	acceleratedRaycast,
	computeBoundsTree,
	disposeBoundsTree,
	getBVHExtremes,
	validateBounds,
} from '../src/index.js';

Mesh.prototype.raycast = acceleratedRaycast;
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

// Returns the max tree depth of the BVH
function getMaxDepth( bvh ) {

	return getBVHExtremes( bvh )[ 0 ].depth.max;

}

describe( 'Bounds Tree', () => {

	it( 'should properly encapsulate all triangles and bounds.', () => {

		const geom = new SphereGeometry( 500, 50, 50 );
		const bvh = new MeshBVH( geom );

		expect( validateBounds( bvh ) ).toBeTruthy();

	} );

	it( 'should be generated when calling BufferGeometry.computeBoundsTree', () => {

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

describe( 'Serialization', () => {

	it( 'should serialize then deserialize to the same structure.', () => {

		const geom = new SphereGeometry( 1, 10, 10 );
		const bvh = new MeshBVH( geom );
		const serialized = MeshBVH.serialize( bvh );

		const deserializedBVH = MeshBVH.deserialize( serialized, geom );
		expect( deserializedBVH ).toEqual( bvh );

	} );

	it( 'should copy the index buffer from the target geometry unless copyIndex is set to false', () => {

		const geom = new SphereGeometry( 1, 10, 10 );
		const bvh = new MeshBVH( geom );

		const serialized1 = MeshBVH.serialize( bvh );
		expect( geom.index.array ).not.toBe( serialized1.index );
		expect( bvh._roots ).not.toBe( serialized1.roots );
		expect( bvh._roots[ 0 ] ).not.toBe( serialized1.roots[ 0 ] );
		expect( bvh._roots ).toEqual( serialized1.roots );

		const serialized2 = MeshBVH.serialize( bvh, { cloneBuffers: false } );
		expect( geom.index.array ).toBe( serialized2.index );
		expect( bvh._roots ).toBe( serialized2.roots );
		expect( bvh._roots[ 0 ] ).toBe( serialized2.roots[ 0 ] );
		expect( bvh._roots ).toEqual( serialized2.roots );

	} );

	it( 'should copy the index buffer onto the target geometry unless setIndex is set to false.', () => {

		const geom1 = new SphereGeometry( 1, 10, 10 );
		const geom2 = new SphereGeometry( 1, 10, 10 );
		const bvh = new MeshBVH( geom1 );
		const serialized = MeshBVH.serialize( bvh );

		expect( geom2.index.array ).not.toBe( serialized.index );
		expect( geom2.index.array ).not.toEqual( serialized.index );
		MeshBVH.deserialize( serialized, geom2, { setIndex: false } );

		expect( geom2.index.array ).not.toBe( serialized.index );
		expect( geom2.index.array ).not.toEqual( serialized.index );
		MeshBVH.deserialize( serialized, geom2, { setIndex: true } );

		expect( geom2.index.array ).not.toBe( serialized.index );
		expect( geom2.index.array ).toEqual( serialized.index );

	} );

	it( 'should create a new index if one does not exist when deserializing.', () => {

		const geom = new SphereGeometry( 1, 10, 10 );
		const bvh = new MeshBVH( geom );
		const serialized = MeshBVH.serialize( bvh );

		geom.index = null;

		MeshBVH.deserialize( serialized, geom );

		expect( geom.index ).toBeTruthy();

	} );

	it( 'should create an index buffer of the appropriate bit width.', () => {

		const geom1 = new BufferGeometry();
		geom1.setAttribute( 'position', new BufferAttribute( new Float32Array( 70000 * 3 ), 3, false ) );

		new MeshBVH( geom1 );
		expect( geom1.index.array instanceof Uint32Array ).toBe( true );

		const geom2 = new BufferGeometry();
		geom2.setAttribute( 'position', new BufferAttribute( new Float32Array( 60000 * 3 ), 3, false ) );

		new MeshBVH( geom2 );
		expect( geom2.index.array instanceof Uint32Array ).toBe( false );

	} );

} );

describe( 'Options', () => {

	let mesh = null;
	beforeAll( () => {

		const geometry = new TorusGeometry( 5, 5, 400, 100 );
		mesh = new Mesh( geometry, new MeshBasicMaterial() );

	} );

	describe( 'onProgress', () => {

		it( 'should provide a progress update for every leaf node', () => {

			let minProgress = Infinity;
			let maxProgress = - Infinity;
			let count = 0;

			const bvh = new MeshBVH( mesh.geometry, {

				onProgress( progress ) {

					minProgress = Math.min( minProgress, progress );
					maxProgress = Math.max( maxProgress, progress );
					count ++;

				}

			} );

			const leafNodeCount = getBVHExtremes( bvh )[ 0 ].leafNodeCount;
			expect( maxProgress ).toEqual( 1.0 );
			expect( minProgress ).toBeLessThan( 0.001 );
			expect( count ).toBe( leafNodeCount );

		} );

	} );

	describe( 'setBoundingBox', () => {

		it( 'should set the bounding box of the geometry when true.', () => {

			mesh.geometry.boundingBox = null;
			mesh.geometry.computeBoundsTree( { setBoundingBox: true } );

			expect( mesh.geometry.boundingBox ).not.toBe( null );

		} );

		it( 'should not set the bounding box of the geometry when false.', () => {

			mesh.geometry.boundingBox = null;
			mesh.geometry.computeBoundsTree( { setBoundingBox: false } );

			expect( mesh.geometry.boundingBox ).toBe( null );

		} );

	} );

	describe( 'maxDepth', () => {

		it( 'should not be limited by default', () => {

			mesh.geometry.computeBoundsTree();

			const depth = getMaxDepth( mesh.geometry.boundsTree );
			expect( depth ).toBeGreaterThan( 10 );

		} );

		it( 'should cap the depth of the bounds tree', () => {

			mesh.geometry.computeBoundsTree( { maxDepth: 10, verbose: false } );

			const depth = getMaxDepth( mesh.geometry.boundsTree );
			expect( depth ).toEqual( 10 );

		} );

		it( 'successfully raycast', () => {

			const raycaster = new Raycaster();
			raycaster.ray.origin.set( 0, 0, 10 );
			raycaster.ray.direction.set( 0, 0, - 1 );

			const bvh = new MeshBVH( mesh.geometry, { maxDepth: 3, verbose: false } );
			const ogHits = raycaster.intersectObject( mesh, true );

			mesh.geometry.boundsTree = bvh;
			const bvhHits = raycaster.intersectObject( mesh, true );

			raycaster.raycastFirst = true;
			const firstHit = raycaster.intersectObject( mesh, true );

			expect( ogHits ).toEqual( bvhHits );
			expect( firstHit[ 0 ] ).toEqual( ogHits[ 0 ] );

		} );

	} );

	describe( 'useSharedArrayBuffer', () => {

		it( 'should initialize with shared array buffers if true.', () => {

			const geometry = new TorusGeometry( 5, 5, 40, 10 );
			let bvh1, bvh2;

			geometry.setIndex( null );
			bvh1 = new MeshBVH( geometry, { useSharedArrayBuffer: true } );
			expect( bvh1._roots[ 0 ] instanceof SharedArrayBuffer ).toBe( true );
			expect( geometry.index.array.buffer instanceof SharedArrayBuffer ).toBe( true );

			geometry.setIndex( null );
			bvh2 = new MeshBVH( geometry, { useSharedArrayBuffer: false } );
			expect( bvh2._roots[ 0 ] instanceof SharedArrayBuffer ).toBe( false );
			expect( geometry.index.array.buffer instanceof SharedArrayBuffer ).toBe( false );

		} );

	} );

	describe( 'strategy', () => {

		it.todo( 'should set the split strategy' );

	} );

	afterEach( () => {

		mesh.geometry.boundsTree = null;

	} );

} );

describe( 'BoundsTree API', () => {

	it.todo( 'test bounds tree and node apis directly' );

} );
