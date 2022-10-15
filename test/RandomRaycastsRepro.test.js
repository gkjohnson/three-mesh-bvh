// Test cases specifically for issue #180
import { Mesh, BufferGeometry, TorusGeometry, Scene, Raycaster, MeshBasicMaterial } from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, SAH, AVERAGE } from '../src/index.js';

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

function runRandomTest( options, transformSeed, raySeed ) {

	let scene = null;
	let raycaster = null;
	let ungroupedGeometry = null;
	let ungroupedBvh = null;
	let groupedGeometry = null;
	let groupedBvh = null;

	describe( `Transform Seed : ${ transformSeed }`, () => {

		beforeAll( () => {

			ungroupedGeometry = new TorusGeometry( 1, 1, 40, 10 );
			groupedGeometry = new TorusGeometry( 1, 1, 40, 10 );

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

		it( `Cast Seed : ${ raySeed }`, () => {

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

			ungroupedGeometry.boundsTree = null;
			groupedGeometry.boundsTree = null;
			const ogHits = raycaster.intersectObject( scene, true );

			expect( ogHits ).toEqual( bvhHits );
			expect( firstHit[ 0 ] ).toEqual( ogHits[ 0 ] );

		} );

	} );

}


runRandomTest( { strategy: AVERAGE }, 7830035629, 4697211981 );
runRandomTest( { strategy: AVERAGE }, 8294928772, 1592666709 );
runRandomTest( { strategy: SAH }, 81992501, 8903271423 );
