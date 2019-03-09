import * as THREE from 'three';
import { getSize, pad, runBenchmark } from './utils.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from '../src/index.js';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const sphere = new THREE.Sphere( undefined, 3 );
const boxMat = new THREE.Matrix4().identity();
const box = new THREE.Box3();
box.min.set( - 1, - 1, - 1 );
box.min.set( 1, 1, 1 );

const intersectGeometry = new THREE.TorusBufferGeometry( 5, 5, 100, 50 );
const geomMat = new THREE.Matrix4().compose( new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3( 0.1, 0.1, 0.1 ) );

const geometry = new THREE.TorusBufferGeometry( 5, 5, 700, 300 );
const mesh = new THREE.Mesh( geometry, new THREE.MeshBasicMaterial() );
const raycaster = new THREE.Raycaster();
raycaster.ray.origin.set( 0, 0, - 10 );
raycaster.ray.direction.set( 0, 0, 1 );

runBenchmark(

	'Compute Bounds Tree',
	() => {

		geometry.computeBoundsTree();
		geometry.boundsTree = null;

	},
	3000,
	50

);


geometry.boundsTree = null;
raycaster.firstHitOnly = false;
runBenchmark(

	'Default Raycast',
	() => mesh.raycast( raycaster, [] ),
	3000

);

geometry.computeBoundsTree();
raycaster.firstHitOnly = false;
runBenchmark(

	'BVH Raycast',
	() => mesh.raycast( raycaster, [] ),
	3000

);


geometry.computeBoundsTree();
raycaster.firstHitOnly = true;
runBenchmark(

	'First Hit Raycast',
	() => mesh.raycast( raycaster, [] ),
	3000

);


geometry.computeBoundsTree();
runBenchmark(

	'Spherecast',
	() => mesh.geometry.boundsTree.spherecast( mesh, sphere ),
	3000

);


geometry.computeBoundsTree();
runBenchmark(

	'Boxcast',
	() => mesh.geometry.boundsTree.boxcast( mesh, box, boxMat ),
	3000

);


geometry.computeBoundsTree();
intersectGeometry.disposeBoundsTree();
runBenchmark(

	'Geometrycast without BVH',
	() => mesh.geometry.boundsTree.geometrycast( mesh, intersectGeometry, geomMat ),
	3000

);


geometry.computeBoundsTree();
intersectGeometry.computeBoundsTree();
runBenchmark(

	'Geometrycast with BVH',
	() => mesh.geometry.boundsTree.geometrycast( mesh, intersectGeometry, geomMat ),
	3000

);


geometry.computeBoundsTree();
intersectGeometry.computeBoundsTree();
runBenchmark(

	'Distance cast',
	() => mesh.geometry.boundsTree.distancecast( mesh, intersectGeometry, geomMat, 1 ),
	3000

);


console.log( '' );

geometry.computeBoundsTree();

const bvhSize = getSize( geometry.boundsTree );
console.log( `${ pad( 'BVH Memory Usage', 25 ) }: ${ bvhSize / 1000 } kb` );
