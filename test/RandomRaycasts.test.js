import { Mesh, BufferGeometry, TorusBufferGeometry, Scene, Raycaster, MeshBasicMaterial, Vector3 } from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, CENTER, SAH, AVERAGE } from '../src/index.js';

Mesh.prototype.raycast = acceleratedRaycast;
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

function runRandomTests( options ) {

	let scene = null;
	let raycaster = null;
	let ungroupedGeometry = null;
	let ungroupedBvh = null;
	let groupedGeometry = null;
	let groupedBvh = null;

	beforeAll( () => {

		ungroupedGeometry = new TorusBufferGeometry( 1, 1, 40, 10 );
		groupedGeometry = new TorusBufferGeometry( 1, 1, 40, 10 );
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

		scene = new Scene();
		raycaster = new Raycaster();

		for ( var i = 0; i < 10; i ++ ) {

			let geo = i % 2 ? groupedGeometry : ungroupedGeometry;
			let mesh = new Mesh( geo, new MeshBasicMaterial() );
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

		const origin = new Vector3();
		const direction = new Vector3();

		origin.set( Math.random() * 10, Math.random() * 10, Math.random() * 10 );
		direction.copy( origin ).multiplyScalar( - 1 ).normalize();
		it( `cast ${ i }: ${ origin.toArray().join() } : ${ direction.toArray().join() }`, () => {

			raycaster.firstHitOnly = false;
			raycaster.ray.origin.copy( origin );
			raycaster.ray.direction.copy( direction );

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

describe( 'Random CENTER intersections', () => {

	describe( 'split', () => runRandomTests( { strategy: CENTER, packData: false, lazyGeneration: false } ) );
	describe( 'Lazy split', () => runRandomTests( { strategy: CENTER, packData: false, lazyGeneration: true } ) );
	describe( 'Packed split', () => runRandomTests( { strategy: CENTER, packData: true, lazyGeneration: false } ) );

} );

describe( 'Random AVERAGE intersections', () => {

	describe( 'split', () => runRandomTests( { strategy: AVERAGE, packData: false, lazyGeneration: false } ) );
	describe( 'Lazy split', () => runRandomTests( { strategy: AVERAGE, packData: false, lazyGeneration: true } ) );
	describe( 'Packed split', () => runRandomTests( { strategy: AVERAGE, packData: true, lazyGeneration: false } ) );

} );

describe( 'Random SAH intersections', () => {

	describe( 'split', () => runRandomTests( { strategy: SAH, packData: false, lazyGeneration: false } ) );
	describe( 'Lazy split', () => runRandomTests( { strategy: SAH, packData: false, lazyGeneration: true } ) );
	describe( 'Packed split', () => runRandomTests( { strategy: SAH, packData: true, lazyGeneration: false } ) );

} );
