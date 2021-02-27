import { Mesh, BufferGeometry, TorusBufferGeometry, Scene, Raycaster, MeshBasicMaterial } from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, CENTER, SAH, AVERAGE } from '../src/index.js';

Mesh.prototype.raycast = acceleratedRaycast;
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

// https://stackoverflow.com/questions/3062746/special-simple-random-number-generator
let _seed = null;
function random() {

	if ( _seed === null ) throw new Error();

	const a = 1103515245;
	const c = 12345;
	const m = 2e31;

	_seed = ( a * _seed + c ) % m;
	return _seed / m;

}

function runRandomTests( options ) {

	let scene = null;
	let raycaster = null;
	let ungroupedGeometry = null;
	let ungroupedBvh = null;
	let groupedGeometry = null;
	let groupedBvh = null;

	const transformSeed = Math.floor( Math.random() * 1e10 );

	describe( `Transform Seed : ${ transformSeed }`, () => {

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

			_seed = transformSeed;
			random(); // call random() to seed with a larger value

			for ( var i = 0; i < 10; i ++ ) {

				let geo = i % 2 ? groupedGeometry : ungroupedGeometry;
				let mesh = new Mesh( geo, new MeshBasicMaterial() );
				mesh.rotation.x = random() * 10;
				mesh.rotation.y = random() * 10;
				mesh.rotation.z = random() * 10;

				mesh.position.x = random();
				mesh.position.y = random();
				mesh.position.z = random();

				scene.add( mesh );
				mesh.updateMatrix( true );
				mesh.updateMatrixWorld( true );

			}

		} );

		for ( let i = 0; i < 100; i ++ ) {

			const raySeed = Math.floor( Math.random() * 1e10 );
			it( `Cast ${ i } Seed : ${ raySeed }`, () => {

				_seed = raySeed;
				random(); // call random() to seed with a larger value

				raycaster.firstHitOnly = false;
				raycaster.ray.origin.set( random() * 10, random() * 10, random() * 10 );
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

	} );

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
