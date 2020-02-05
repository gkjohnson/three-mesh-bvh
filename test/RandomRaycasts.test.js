/* global
    describe it beforeAll expect
*/

import * as THREE from 'three';
import { CENTER, SAH, AVERAGE } from '../src/index.js';


function runRandomTests( options ) {

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

		groupedGeometry.computeBoundsTree( options );
		ungroupedGeometry.computeBoundsTree( options );

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

			ungroupedGeometry.boundsTree = ungroupedBvh;
			groupedGeometry.boundsTree = groupedBvh;
			const bvhHits = raycaster.intersectObject( scene, true );

			raycaster.firstHitOnly = true;
			const firstHit = raycaster.intersectObject( scene, true );

			// run the og hits _after_ because in the lazy generation case
			// the indices will be changing as the tree is generated and make
			// the results will look different.
			ungroupedGeometry.boundsTree = null;
			groupedGeometry.boundsTree = null;
			const ogHits = raycaster.intersectObject( scene, true );

			expect( ogHits ).toEqual( bvhHits );
			expect( firstHit[ 0 ] ).toEqual( ogHits[ 0 ] );

		} );

	}

}

describe( 'Random intersections comparison', () => {

	describe( 'CENTER split', () => runRandomTests( { strategy: CENTER, packData: false } ) );
	describe( 'Lazy CENTER split', () => runRandomTests( { strategy: CENTER, lazyGeneration: true } ) );
	describe( 'Packed CENTER split', () => runRandomTests( { strategy: CENTER } ) );

	describe( 'AVERAGE split', () => runRandomTests( { strategy: AVERAGE, packData: false } ) );
	describe( 'Lazy AVERAGE split', () => runRandomTests( { strategy: AVERAGE, lazyGeneration: true } ) );
	describe( 'Packed CENTER split', () => runRandomTests( { strategy: AVERAGE } ) );

	describe( 'SAH split', () => runRandomTests( { strategy: SAH, packData: false } ) );
	describe( 'Lazy SAH split', () => runRandomTests( { strategy: SAH, lazyGeneration: true } ) );
	describe( 'Packed SAH split', () => runRandomTests( { strategy: SAH } ) );

} );
