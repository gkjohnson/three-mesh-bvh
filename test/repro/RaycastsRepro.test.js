// Test cases specifically for issue #180
import { Mesh, BufferGeometry, TorusGeometry, Scene, Raycaster, MeshBasicMaterial } from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, SAH, AVERAGE } from '../../src/index.js';
import { random, setSeed } from '../utils.js';

Mesh.prototype.raycast = acceleratedRaycast;
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

runRandomTest( { strategy: AVERAGE }, 7830035629, 4697211981 );
runRandomTest( { strategy: AVERAGE }, 8294928772, 1592666709 );
runRandomTest( { strategy: SAH }, 81992501, 8903271423 );

runRandomTest( { strategy: AVERAGE, indirect: true }, 7830035629, 4697211981 );
runRandomTest( { strategy: AVERAGE, indirect: true }, 8294928772, 1592666709 );
runRandomTest( { strategy: SAH, indirect: true }, 81992501, 8903271423 );

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

			setSeed( transformSeed );
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

			setSeed( raySeed );
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
