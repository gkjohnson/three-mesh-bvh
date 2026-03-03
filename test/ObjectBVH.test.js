import {
	Mesh,
	InstancedMesh,
	BatchedMesh,
	SphereGeometry,
	BoxGeometry,
	MeshBasicMaterial,
	Scene,
	Raycaster,
	Euler,
	Quaternion,
	Vector3,
	Matrix4,
	REVISION,
} from 'three';
import { validateBounds } from 'three-mesh-bvh';
import { ObjectBVH } from '../example/src/bvh/ObjectBVH.js';
import { random, randomizeObjectTransform, runTestMatrix, setSeed } from './utils.js';

const _euler = /* @__PURE__ */ new Euler();
const _quaternion = /* @__PURE__ */ new Quaternion();
const _position = /* @__PURE__ */ new Vector3();
const _scale = /* @__PURE__ */ new Vector3();
const _matrix = /* @__PURE__ */ new Matrix4();

// ObjectBVH doesn't use indirect or shared array buffers; fix maxLeafSize to 1
// so the BVH tree is properly exercised with a small number of objects.
runTestMatrix( {
	precise: [ false, true ],
	indirect: [ false ],
	useSharedArrayBuffer: [ false ],
	maxLeafSize: [ 1 ],
}, ( desc, options ) => {

	const IS_REVISION_166 = parseInt( REVISION ) >= 166;
	if ( IS_REVISION_166 ) {

		describe( `Running with Options: { ${ desc } }`, () => runSuiteWithOptions( options ) );

	} else {

		describe.skip( 'Skipping tests due to three.js revision' );

	}

} );

function runSuiteWithOptions( options ) {

	const transformSeed = Math.floor( Math.random() * 1e10 );
	describe( `Transform Seed : ${ transformSeed }`, () => {

		let bvh, raycaster, objects;

		beforeAll( () => {

			setSeed( transformSeed );

			const scene = new Scene();
			objects = [];

			// Regular meshes
			const meshGeometries = [
				new SphereGeometry( 0.5, 8, 8 ),
				new BoxGeometry( 0.8, 0.8, 0.8 ),
				new SphereGeometry( 0.3, 6, 6 ),
				new BoxGeometry( 0.6, 0.6, 0.6 ),
			];
			for ( let i = 0; i < 20; i ++ ) {

				const mesh = new Mesh( meshGeometries[ i % meshGeometries.length ], new MeshBasicMaterial() );
				randomizeObjectTransform( mesh );
				scene.add( mesh );
				objects.push( mesh );

			}

			// InstancedMesh — 20 instances
			const instancedMesh = new InstancedMesh( new BoxGeometry( 0.7, 0.7, 0.7 ), new MeshBasicMaterial(), 20 );
			for ( let i = 0; i < 20; i ++ ) {

				randomizeMatrix( _matrix );
				instancedMesh.setMatrixAt( i, _matrix );

			}

			instancedMesh.instanceMatrix.needsUpdate = true;
			scene.add( instancedMesh );
			objects.push( instancedMesh );

			// BatchedMesh — 2 geometry types, 20 instances total
			const batchedMesh = new BatchedMesh( 20, 2000, 2000, new MeshBasicMaterial() );
			const sphereGeomId = batchedMesh.addGeometry( new SphereGeometry( 0.4, 6, 6 ) );
			const boxGeomId = batchedMesh.addGeometry( new BoxGeometry( 0.6, 0.6, 0.6 ) );

			for ( let i = 0; i < 10; i ++ ) {

				randomizeMatrix( _matrix );
				batchedMesh.setMatrixAt( batchedMesh.addInstance( sphereGeomId ), _matrix );

			}

			for ( let i = 0; i < 10; i ++ ) {

				randomizeMatrix( _matrix );
				batchedMesh.setMatrixAt( batchedMesh.addInstance( boxGeomId ), _matrix );

			}

			scene.add( batchedMesh );
			objects.push( batchedMesh );

			scene.updateMatrixWorld( true );

			bvh = new ObjectBVH( scene, {
				...options,
				matrixWorld: scene.matrixWorld,
			} );

			raycaster = new Raycaster();

		} );

		for ( let i = 0; i < 100; i ++ ) {

			const raySeed = Math.floor( Math.random() * 1e10 );
			it( `Cast ${ i } Seed : ${ raySeed }`, () => {

				setSeed( raySeed );
				random();

				raycaster.ray.origin.randomDirection().multiplyScalar( 10 );
				raycaster.ray.direction.copy( raycaster.ray.origin ).multiplyScalar( - 1 ).normalize();

				raycaster.firstHitOnly = false;
				const bvhHits = bvh.raycast( raycaster, [] );
				bvhHits.sort( ( a, b ) => a.distance - b.distance );

				raycaster.firstHitOnly = true;
				const firstHit = bvh.raycast( raycaster, [] );

				raycaster.firstHitOnly = false;
				const ogHits = raycaster.intersectObjects( objects, false );

				expect( validateBounds( bvh ) ).toBeTruthy();
				expect( ogHits ).toEqual( bvhHits );
				expect( ogHits[ 0 ] ).toEqual( firstHit[ 0 ] );

			} );

		}

	} );

}

function randomizeMatrix( target ) {

	_position.set(
		( random() - 0.5 ) * 4,
		( random() - 0.5 ) * 4,
		( random() - 0.5 ) * 4,
	);

	_euler.set(
		random() * Math.PI * 2,
		random() * Math.PI * 2,
		random() * Math.PI * 2,
	);

	_quaternion.setFromEuler( _euler );

	_scale.set(
		random() * 1.5 + 0.5,
		random() * 1.5 + 0.5,
		random() * 1.5 + 0.5,
	);

	target.compose( _position, _quaternion, _scale );

}
