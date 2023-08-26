import {
	Mesh,
	Raycaster,
	MeshBasicMaterial,
	TorusGeometry,
} from 'three';
import {
	MeshBVH,
	getBVHExtremes,
} from '../src/index.js';
import { getMaxDepth } from './utils.js';

describe( 'Options', () => {

	let mesh, geometry;

	beforeEach( () => {

		geometry = new TorusGeometry( 5, 5, 400, 100 );
		mesh = new Mesh( geometry, new MeshBasicMaterial() );

	} );

	describe( 'onProgress', () => {

		it( 'should provide a progress update for every leaf node.', () => {

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

			const bvh = new MeshBVH( geometry, { setBoundingBox: true } );
			expect( geometry.boundingBox ).not.toBe( null );
			expect( bvh ).toBeTruthy();

		} );

		it( 'should not set the bounding box of the geometry when false.', () => {

			const bvh = new MeshBVH( geometry, { setBoundingBox: false } );
			expect( mesh.geometry.boundingBox ).toBe( null );
			expect( bvh ).toBeTruthy();

		} );

	} );

	describe( 'maxDepth', () => {

		it( 'should not be limited by default.', () => {

			const bvh = new MeshBVH( geometry );
			const depth = getMaxDepth( bvh );
			expect( depth ).toBeGreaterThan( 10 );

		} );

		it( 'should cap the depth of the bounds tree.', () => {

			const bvh = new MeshBVH( geometry, { maxDepth: 10, verbose: false } );
			const depth = getMaxDepth( bvh );
			expect( depth ).toEqual( 10 );

		} );

		it( 'should successfully raycast.', () => {

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

			const geo = geometry.toNonIndexed();
			const bvh = new MeshBVH( geo, { useSharedArrayBuffer: true } );
			expect( bvh._roots[ 0 ] instanceof SharedArrayBuffer ).toBe( true );
			expect( geo.index.array.buffer instanceof SharedArrayBuffer ).toBe( true );

		} );

		it( 'should initialize with regular array buffers if false.', () => {

			const geo = geometry.toNonIndexed();
			const bvh = new MeshBVH( geo, { useSharedArrayBuffer: false } );
			expect( bvh._roots[ 0 ] instanceof SharedArrayBuffer ).toBe( false );
			expect( geo.index.array.buffer instanceof SharedArrayBuffer ).toBe( false );

		} );

		it( 'should initialize the indirect buffer with shared array buffers if true.', () => {

			const geo = geometry.toNonIndexed();
			const bvh = new MeshBVH( geo, { useSharedArrayBuffer: true, indirect: true } );
			expect( bvh._indirectBuffer.buffer instanceof SharedArrayBuffer ).toBe( true );

		} );

	} );

	describe( 'indirect', () => {

		it( 'should not create an indirect buffer if false.', () => {

			const bvh = new MeshBVH( geometry, { indirect: false } );
			expect( bvh._indirectBuffer ).not.toBeTruthy();

		} );

		it( 'should not adjust the index buffer if false.', () => {

			const clone = geometry.clone();
			const bvh = new MeshBVH( geometry, { indirect: true } );
			expect( geometry.index.array ).not.toBe( clone.index.array );
			expect( geometry.index.array ).toEqual( clone.index.array );
			expect( bvh ).toBeTruthy();

		} );

		it( 'should unpack to the same rearranged index buffer.', () => {

			const geometry = new TorusGeometry( 5, 5, 40, 10 );
			const bvh = new MeshBVH( geometry.clone(), { indirect: false } );
			const bvhIndirect = new MeshBVH( geometry.clone(), { indirect: true } );

			const indexArray = bvhIndirect.geometry.index.array;
			const indirectBuffer = bvhIndirect._indirectBuffer;
			const unpacked = bvhIndirect.geometry.index.array.slice();
			indirectBuffer.forEach( ( v, i ) => {

				for ( let c = 0; c < 3; c ++ ) {

					unpacked[ 3 * i + c ] = indexArray[ 3 * v + c ];

				}

			} );

			expect( bvh.geometry.index.array ).not.toEqual( bvhIndirect.geometry.index.array );
			expect( bvh.geometry.index.array ).toEqual( unpacked );

		} );

		it( 'should create an indirect buffer the same length as the number of triangles.', () => {

			const bvh = new MeshBVH( geometry, { indirect: true } );
			expect( bvh._indirectBuffer ).toHaveLength( geometry.index.count / 3 );

		} );

		it( 'should not generate an index buffer if it does not exist.', () => {

			const geo = geometry.toNonIndexed();
			const bvh = new MeshBVH( geo, { indirect: true } );
			expect( bvh._indirectBuffer ).toBeTruthy();
			expect( bvh.indirect ).toBe( true );
			expect( geo.index ).not.toBeTruthy();

		} );

	} );

	describe( 'strategy', () => {

		it.todo( 'should set the split strategy' );

	} );

} );
