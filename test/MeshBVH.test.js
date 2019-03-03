/* global
    describe it beforeAll beforeEach afterEach expect
*/

import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from '../src/index.js';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

describe( 'Bounds Tree', () => {

	it( 'should be generated when calling BufferGeometry.computeBoundsTree', () => {

		const geom = new THREE.SphereBufferGeometry( 1, 1, 1 );
		expect( geom.boundsTree ).not.toBeDefined();

		geom.computeBoundsTree();
		expect( geom.boundsTree ).toBeDefined();

	} );

	it( 'should throw an error if THREE.Geometry is used', () => {

		const geom = new THREE.SphereGeometry( 1, 1, 1 );
		let errorThrown = false;
		try {

			new MeshBVH( geom, { verbose: false } );

		} catch ( e ) {

			errorThrown = true;

		}

		expect( errorThrown ).toBe( true );

	} );

	it( 'should throw an error if InterleavedBufferAttributes are used', () => {

		const indexAttr = new THREE.InterleavedBufferAttribute( new THREE.InterleavedBuffer( new Uint32Array( [ 1, 2, 3 ] ), 1 ), 4, 0, false );
		const posAttr = new THREE.InterleavedBufferAttribute( new THREE.InterleavedBuffer( new Float32Array( [ 1, 2, 3 ] ), 3 ), 4, 0, false );

		let geometry;
		let posErrorThrown = false;
		let indexErrorThrown = false;

		geometry = new THREE.BoxBufferGeometry();
		geometry.addAttribute( 'position', posAttr );
		try {

			new MeshBVH( geometry, { verbose: false } );

		} catch ( e ) {

			posErrorThrown = true;

		}
		expect( posErrorThrown ).toBe( true );

		geometry = new THREE.BoxBufferGeometry();
		geometry.setIndex( indexAttr );
		try {

			new MeshBVH( geometry, { verbose: false } );

		} catch ( e ) {

			indexErrorThrown = true;

		}
		expect( indexErrorThrown ).toBe( true );

	} );

	it( 'should use the boundsTree when raycasting if available', () => {

		const geom = new THREE.SphereBufferGeometry( 1, 1, 1 );
		const mesh = new THREE.Mesh( geom, new THREE.MeshBasicMaterial() );
		const raycaster = new THREE.Raycaster();

		raycaster.ray.origin.set( 0, 0, 10 );
		raycaster.ray.direction.set( 0, 0, - 1 );

		let calledRaycast = false;
		let calledRaycastFirst = false;
		geom.boundsTree = {

			raycast: () => calledRaycast = true,
			raycastFirst: () => calledRaycastFirst = true

		};

		mesh.raycast( raycaster, [] );
		expect( calledRaycast ).toBeTruthy();

		raycaster.firstHitOnly = true;
		mesh.raycast( raycaster, [] );
		expect( calledRaycastFirst ).toBeTruthy();

	} );

	it( 'should respect index group invariants', () => {

		const geo = new THREE.TorusBufferGeometry( 5, 5, 400, 100 );
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

} );

describe( 'Spherecast ', () => {

	let mesh = null;
	let bvh = null;

	beforeAll( () => {

		const geom = new THREE.SphereBufferGeometry( 1, 50, 50 );
		mesh = new THREE.Mesh( geom );
		bvh = new MeshBVH( geom, { verbose: false } );

	} );

	it( 'should return true if the sphere is intersecting the mesh', () => {

		const sphere = new THREE.Sphere();
		sphere.radius = .01;
		sphere.center.set( 0, 1, 0 );
		expect( bvh.spherecast( mesh, sphere ) ).toBe( true );

	} );

	it( 'should return false if the sphere is inside the mesh', () => {

		const sphere = new THREE.Sphere();
		sphere.radius = 0.9;
		sphere.center.set( 0, 0, 0 );
		expect( bvh.spherecast( mesh, sphere ) ).toBe( false );

	} );

	it( 'should return false if the sphere is outside the mesh', () => {

		const sphere = new THREE.Sphere();
		sphere.radius = 0.9;
		sphere.center.set( 0, 2.01, 0 );
		expect( bvh.spherecast( mesh, sphere ) ).toBe( false );

	} );

	// TODO: Add robust tests for the intersection functions
	it.skip( '', () => {} );

} );

describe( 'Options', () => {

	let mesh = null;
	beforeAll( () => {

		const geometry = new THREE.TorusBufferGeometry( 5, 5, 400, 100 );
		mesh = new THREE.Mesh( geometry, new THREE.MeshBasicMaterial() );

	} );

	describe( 'maxDepth', () => {

		// Returns the max tree depth of the BVH
		function getMaxDepth( bvh ) {

			function getMaxDepthFrom( node ) {

				const isLeaf = 'count' in node;

				if ( isLeaf ) return 0;

				return 1 + Math.max(
					getMaxDepthFrom( node.left ),
					getMaxDepthFrom( node.right )
				);

			}

			return Math.max.apply( null, bvh._roots.map( getMaxDepthFrom ) );

		}

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

			const raycaster = new THREE.Raycaster();
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

	describe( 'strategy', () => {

		it.skip( 'should set the split strategy', () => {} );

	} );

	afterEach( () => {

		mesh.geometry.boundsTree = null;

	} );

} );

describe( 'Raycaster', () => {

	let geometry = null;
	let mesh = null;
	let scene = null;
	let raycaster = null;
	beforeEach( () => {

		raycaster = new THREE.Raycaster();
		raycaster.ray.origin.set( 0, 0, - 10 );
		raycaster.ray.direction.set( 0, 0, 1 );

		scene = new THREE.Scene();
		geometry = new THREE.TorusBufferGeometry( 5, 5, 40, 10 );
		mesh = new THREE.Mesh( geometry, new THREE.MeshBasicMaterial() );

		scene.add( mesh );

		for ( let i = 0; i < 10; i ++ ) {

			scene.add( mesh.clone() );

		}

	} );

	describe( 'firstHitOnly = false', () => {

		beforeEach( () => {

			raycaster.firstHitOnly = false;

		} );

		it( 'should yield all hits on an a mesh without a bounds tree', () => {

			const arr = [];
			mesh.raycast( raycaster, arr );
			expect( arr.length ).toBe( 10 );

		} );

		it( 'should yield all hits on an a mesh with a bounds tree', () => {

			geometry.computeBoundsTree();

			const arr = [];
			mesh.raycast( raycaster, arr );
			expect( arr.length ).toBe( 10 );

		} );

		it( 'should yield all hits in a scene', () => {

			const res = raycaster.intersectObject( scene, true );
			expect( res.length ).toBe( 110 );

		} );

	} );

	describe( 'firstHitOnly = true', () => {

		it( 'should yield closest hit only with a bounds tree', () => {

			const bvh = new MeshBVH( geometry );
			raycaster.firstHitOnly = false;
			const allHits = raycaster.intersectObject( mesh, true );

			geometry.boundsTree = bvh;
			raycaster.firstHitOnly = true;
			const bvhHits = raycaster.intersectObject( mesh, true );

			expect( allHits.length ).toEqual( 10 );
			expect( bvhHits.length ).toEqual( 1 );

			expect( bvhHits[ 0 ] ).toEqual( allHits[ 0 ] );

		} );

	} );

} );

describe( 'BoundsTree API', () => {

	it.skip( 'test bounds tree and node apis directly', () => {} );

} );

describe( 'Random intersections comparison', () => {

	let scene = null;
	let raycaster = null;
	let ungroupedGeometry = null;
	let ungroupedBvh = null;
	let groupedGeometry = null;
	let groupedBvh = null;

	beforeAll( () => {

		ungroupedGeometry = new THREE.TorusBufferGeometry( 1, 1, 40, 10 );
		groupedGeometry = new THREE.TorusBufferGeometry( 1, 1, 40, 10 );
		const groupCount = 10;
		const groupSize = groupedGeometry.index.array.length / groupCount;

		for ( let g = 0; g < groupCount; g ++ ) {

			const groupStart = g * groupSize;
			groupedGeometry.addGroup( groupStart, groupSize, 0 );

		}

		groupedGeometry.computeBoundsTree();
		ungroupedGeometry.computeBoundsTree();

		ungroupedBvh = ungroupedGeometry.boundsTree;
		groupedBvh = groupedGeometry.boundsTree;

		scene = new THREE.Scene();
		raycaster = new THREE.Raycaster();

		for ( var i = 0; i < 10; i ++ ) {

			let geo = i % 2 ? groupedGeometry : ungroupedGeometry;
			let mesh = new THREE.Mesh( geo, new THREE.MeshBasicMaterial() );
			mesh.rotation.x = Math.random() * 10;
			mesh.rotation.y = Math.random() * 10;
			mesh.rotation.z = Math.random() * 10;

			mesh.position.x = Math.random() * 1;
			mesh.position.y = Math.random() * 1;
			mesh.position.z = Math.random() * 1;

			scene.add( mesh );
			mesh.updateMatrix( true );
			mesh.updateMatrixWorld( true );

		}

	} );

	for ( let i = 0; i < 100; i ++ ) {

		it( 'cast ' + i, () => {

			raycaster.firstHitOnly = false;
			raycaster.ray.origin.set( Math.random() * 10, Math.random() * 10, Math.random() * 10 );
			raycaster.ray.direction.copy( raycaster.ray.origin ).multiplyScalar( - 1 ).normalize();

			ungroupedGeometry.boundsTree = null;
			groupedGeometry.boundsTree = null;
			const ogHits = raycaster.intersectObject( scene, true );

			ungroupedGeometry.boundsTree = ungroupedBvh;
			groupedGeometry.boundsTree = groupedBvh;
			const bvhHits = raycaster.intersectObject( scene, true );

			raycaster.firstHitOnly = true;
			const firstHit = raycaster.intersectObject( scene, true );

			expect( ogHits ).toEqual( bvhHits );
			expect( firstHit[ 0 ] ).toEqual( ogHits[ 0 ] );

		} );

	}

} );
