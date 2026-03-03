import { SkinnedMesh, AnimationMixer, LoadingManager, Raycaster, MeshBasicMaterial } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { validateBounds } from 'three-mesh-bvh';
import { SkinnedMeshBVH, skinnedMeshAcceleratedRaycast } from '../example/src/bvh/SkinnedMeshBVH.js';
import { random, runTestMatrix, setSeed } from './utils.js';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

// GLTFLoader accesses `self` and `self.URL` when building object URLs for embedded textures
globalThis.self = globalThis;

// ImageBitmapLoader calls createImageBitmap on the fetched blob; stub it so no canvas is needed
globalThis.createImageBitmap = async () => ( { width: 1, height: 1, close() {} } );

SkinnedMesh.prototype.raycast = skinnedMeshAcceleratedRaycast;

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );
const glbPath = path.join( __dirname, 'data', 'Soldier.glb' );

runTestMatrix( {
	indirect: [ false, true ],
}, ( desc, options ) => {

	describe( `Running with Options: { ${ desc } }`, () => runSuiteWithOptions( options ) );

} );

function loadModel() {

	return new Promise( ( resolve, reject ) => {

		const data = fs.readFileSync( glbPath );
		const loader = new GLTFLoader();
		loader.parse( data.buffer, '', resolve, reject );

	} );

}

function runSuiteWithOptions( options ) {

	const transformSeed = Math.floor( Math.random() * 1e10 );
	describe( `Transform Seed : ${ transformSeed }`, () => {

		let meshes, bvhs, raycaster;

		beforeAll( async () => {

			setSeed( transformSeed );

			const gltf = await loadModel();

			// Replace materials so texture loading failures don't matter
			gltf.scene.traverse( child => {

				if ( child.isMesh ) {

					child.material = new MeshBasicMaterial( { side: child.material.side } );

				}

			} );

			// Advance animation 1 ("Run") to an interesting frame
			const mixer = new AnimationMixer( gltf.scene );
			const action = mixer.clipAction( gltf.animations[ 1 ] );
			action.play();
			mixer.update( 0.5 );
			gltf.scene.updateMatrixWorld( true );

			// Collect all skinned meshes and build a BVH for each
			meshes = [];
			bvhs = [];

			gltf.scene.traverse( child => {

				if ( child.isSkinnedMesh ) {

					const bvh = new SkinnedMeshBVH( child, options );
					child.boundsTree = bvh;
					meshes.push( child );
					bvhs.push( bvh );

				}

			} );

			raycaster = new Raycaster();

		} );

		for ( let i = 0; i < 100; i ++ ) {

			const raySeed = Math.floor( Math.random() * 1e10 );
			it( `Cast ${ i } Seed : ${ raySeed }`, () => {

				setSeed( raySeed );
				random();

				raycaster.ray.origin.randomDirection().multiplyScalar( 2 );
				raycaster.ray.direction.copy( raycaster.ray.origin ).multiplyScalar( - 1 ).normalize();

				meshes.forEach( ( mesh, m ) => mesh.boundsTree = bvhs[ m ] );
				raycaster.firstHitOnly = false;
				const bvhHits = raycaster.intersectObjects( meshes );

				meshes.forEach( ( mesh, m ) => mesh.boundsTree = bvhs[ m ] );
				raycaster.firstHitOnly = true;
				const firstHit = raycaster.intersectObjects( meshes );

				meshes.forEach( mesh => mesh.boundsTree = null );
				raycaster.firstHitOnly = false;
				const ogHits = raycaster.intersectObjects( meshes );

				bvhs.forEach( bvh => expect( validateBounds( bvh ) ).toBeTruthy() );
				expect( ogHits ).toEqual( bvhHits );
				expect( ogHits[ 0 ] ).toEqual( firstHit[ 0 ] );

			} );

		}

	} );

}
