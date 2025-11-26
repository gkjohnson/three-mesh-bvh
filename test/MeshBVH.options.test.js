import {
	Mesh,
	Raycaster,
	MeshBasicMaterial,
	TorusGeometry,
} from 'three';
import {
	MeshBVH,
	getBVHExtremes,
	acceleratedRaycast,
	validateBounds,
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

		it( 'should produce valid bounds when true.', () => {

			const bvh = new MeshBVH( geometry, { indirect: true } );
			expect( validateBounds( bvh ) ).toBeTruthy();

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

		it( 'should produce an indirect buffer that would contain the index buffer.', () => {

			const bvhIndexed = new MeshBVH( geometry.clone(), { indirect: false } );
			const bvhNonIndexed = new MeshBVH( geometry.toNonIndexed(), { indirect: false } );
			const bvhIndexedIndirect = new MeshBVH( geometry.clone(), { indirect: true } );
			const bvhNonIndexedIndirect = new MeshBVH( geometry.toNonIndexed(), { indirect: true } );

			const triCount = bvhIndexed.geometry.index.count / 3;
			expect( bvhIndexed.geometry.index.count / 3 ).toEqual( triCount );
			expect( bvhNonIndexed.geometry.index.count / 3 ).toEqual( triCount );
			expect( bvhIndexedIndirect._indirectBuffer ).toHaveLength( triCount );
			expect( bvhNonIndexedIndirect._indirectBuffer ).toHaveLength( triCount );

		} );

		it( 'should respect the draw range.', () => {

			geometry.setDrawRange( 300, 600 );

			const bvh = new MeshBVH( geometry, { indirect: true } );

			let start = Infinity;
			let end = 0;
			bvh.traverse( ( depth, isLeaf, box, offset, count ) => {

				if ( isLeaf ) {

					start = Math.min( start, offset );
					end = Math.max( end, offset + count );

				}

			} );

			expect( start ).toBe( 100 );
			expect( end ).toBe( 300 );

		} );

		it( 'should successfully raycast with no index buffer.', () => {

			const geo = geometry.toNonIndexed();
			const bvh = new MeshBVH( geo, { indirect: true } );
			geo.boundsTree = bvh;
			mesh.geometry = geo;
			mesh.raycast = acceleratedRaycast;

			const raycaster = new Raycaster();
			raycaster.ray.origin.set( 0, 10, 0 );
			raycaster.ray.direction.set( 0, - 1, 0 );

			const results = raycaster.intersectObject( mesh );
			expect( results.length ).toBeGreaterThan( 0 );

		} );

		it( 'should handle overlapping groups.', () => {

			geometry.clearGroups();
			geometry.addGroup( 0, 300, 0 ); // triangles 0-99
			geometry.addGroup( 150, 300, 1 ); // triangles 50-149 (overlaps with first)

			const bvh = new MeshBVH( geometry, { indirect: true } );
			expect( validateBounds( bvh ) ).toBeTruthy();

		} );

		it( 'should serialize and deserialize with indirect buffer.', () => {

			const bvh = new MeshBVH( geometry, { indirect: true } );
			const serialized = MeshBVH.serialize( bvh );

			expect( serialized.indirectBuffer ).toBeTruthy();

			const deserialized = MeshBVH.deserialize( serialized, geometry );

			expect( deserialized.indirect ).toBe( true );
			expect( deserialized._indirectBuffer ).toBeTruthy();
			expect( deserialized._indirectBuffer ).toHaveLength( bvh._indirectBuffer.length );
			expect( deserialized._indirectBuffer ).toEqual( bvh._indirectBuffer );

		} );

	} );

	describe( 'strategy', () => {

		it.todo( 'should set the split strategy' );

	} );

	describe( 'range', () => {

		let geometry;
		beforeEach( () => {

			geometry = new TorusGeometry( 5, 5, 400, 100 );

		} );

		it( 'should respect the range option without groups.', () => {

			const options = { range: { start: 300, count: 600 } };
			const bvh = new MeshBVH( geometry, options );
			let start = Infinity;
			let end = 0;
			bvh.traverse( ( depth, isLeaf, box, offset, count ) => {

				if ( isLeaf ) {

					start = Math.min( start, offset );
					end = Math.max( end, offset + count );

				}

			} );

			expect( start ).toBe( options.range.start / 3 );
			expect( end ).toBe( ( options.range.start + options.range.count ) / 3 );

		} );

		it( 'should respect the range option with groups.', () => {

			// [-------------------------------------------------------------]
			// |__________________|
			//   g0 = [0, 20]  |______________________||_____________________|
			//                      g1 = [16, 40]           g2 = [41, 60]
			//
			// we would need four BVH roots: [0, 15], [16, 20], [21, 40], [41, 60].

			geometry.addGroup( 0 * 3, ( 20 - 0 + 1 ) * 3 );
			geometry.addGroup( 16 * 3, ( 40 - 16 + 1 ) * 3 );
			geometry.addGroup( 41 * 3, ( 60 - 41 + 1 ) * 3 );

			const options = { range: { start: 10 * 3, count: 45 * 3 } }; // range [10, 55]
			const bvh = new MeshBVH( geometry, options );
			const start = [];
			const end = [];
			const bvhCount = bvh._roots.length;

			expect( bvhCount ).toBe( 4 );

			for ( let i = 0, l = bvhCount; i < l; i ++ ) {

				start[ i ] = Infinity;
				end[ i ] = 0;

				bvh.traverse( ( depth, isLeaf, box, offset, count ) => {

					if ( isLeaf ) {

						start[ i ] = Math.min( start[ i ], offset );
						end[ i ] = Math.max( end[ i ], offset + count );

					}

				}, i );

			}

			// [10, 15], [16, 20], [21, 40], [41, 54]

			expect( start[ 0 ] ).toBe( 10 );
			expect( end[ 0 ] ).toBe( 16 );
			expect( start[ 1 ] ).toBe( 16 );
			expect( end[ 1 ] ).toBe( 21 );
			expect( start[ 2 ] ).toBe( 21 );
			expect( end[ 2 ] ).toBe( 41 );
			expect( start[ 3 ] ).toBe( 41 );
			expect( end[ 3 ] ).toBe( 55 );

		} );

		it( 'should respect the range option without groups, indirect.', () => {

			const options = { indirect: true, range: { start: 300, count: 600 } };
			const bvh = new MeshBVH( geometry, options );
			let start = Infinity;
			let end = 0;
			bvh.traverse( ( depth, isLeaf, box, offset, count ) => {

				if ( isLeaf ) {

					start = Math.min( start, offset );
					end = Math.max( end, offset + count );

				}

			} );

			expect( start ).toBe( options.range.start / 3 );
			expect( end ).toBe( ( options.range.start + options.range.count ) / 3 );

		} );

		it( 'should respect the range option with groups, indirect.', () => {

			geometry.addGroup( 0 * 3, ( 20 - 0 + 1 ) * 3 );
			geometry.addGroup( 16 * 3, ( 40 - 16 + 1 ) * 3 );
			geometry.addGroup( 41 * 3, ( 60 - 41 + 1 ) * 3 );

			const options = { indirect: true, range: { start: 10 * 3, count: 45 * 3 } }; // range [10, 55]
			const bvh = new MeshBVH( geometry, options );
			let start = Infinity;
			let end = 0;
			const bvhCount = bvh._roots.length;

			expect( bvhCount ).toBe( 1 );

			bvh.traverse( ( depth, isLeaf, box, offset, count ) => {

				if ( isLeaf ) {

					start = Math.min( start, offset );
					end = Math.max( end, offset + count );

				}

			} );

			expect( start ).toBe( 10 );
			expect( end ).toBe( 55 );

		} );

	} );

} );
