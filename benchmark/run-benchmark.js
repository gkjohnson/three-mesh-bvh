import * as THREE from 'three';
import { getSize, pad, runBenchmark } from './utils.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, CENTER, AVERAGE, SAH } from '../src/index.js';

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

const target1 = new THREE.Vector3();
const target2 = new THREE.Vector3();

const geometry = new THREE.TorusBufferGeometry( 5, 5, 700, 300 );
const mesh = new THREE.Mesh( geometry, new THREE.MeshBasicMaterial() );
const raycaster = new THREE.Raycaster();
raycaster.ray.origin.set( 0, 0, - 10 );
raycaster.ray.direction.set( 0, 0, 1 );

runBenchmark(

	'Compute BVH (CENTER)',
	() => {

		geometry.computeBoundsTree( { strategy: CENTER } );
		geometry.boundsTree = null;

	},
	3000,
	50

);

runBenchmark(

	'Compute BVH (AVERAGE)',
	() => {

		geometry.computeBoundsTree( { strategy: AVERAGE } );
		geometry.boundsTree = null;

	},
	3000,
	50

);

runBenchmark(

	'Compute BVH (SAH)',
	() => {

		geometry.computeBoundsTree( { strategy: SAH } );
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

	'IntersectsSphere',
	() => mesh.geometry.boundsTree.intersectsSphere( mesh, sphere ),
	3000

);


geometry.computeBoundsTree();
runBenchmark(

	'IntersectsBox',
	() => mesh.geometry.boundsTree.intersectsBox( mesh, box, boxMat ),
	3000

);


geometry.computeBoundsTree();
intersectGeometry.disposeBoundsTree();
runBenchmark(

	'IntersectsGeometry without BVH',
	() => mesh.geometry.boundsTree.intersectsGeometry( mesh, intersectGeometry, geomMat ),
	3000

);


geometry.computeBoundsTree();
intersectGeometry.computeBoundsTree();
runBenchmark(

	'IntersectsGeometry with BVH',
	() => mesh.geometry.boundsTree.intersectsGeometry( mesh, intersectGeometry, geomMat ),
	3000

);


geometry.computeBoundsTree();
intersectGeometry.computeBoundsTree();
runBenchmark(

	'DistanceToGeometry',
	() => mesh.geometry.boundsTree.closestPointToGeometry( mesh, intersectGeometry, geomMat, target1, target2 ),
	3000

);

const vec = new THREE.Vector3();
geometry.computeBoundsTree();
intersectGeometry.computeBoundsTree();
runBenchmark(

	'DistanceToPoint',
	() => mesh.geometry.boundsTree.closestPointToPoint( mesh, vec, target1 ),
	3000

);


console.log( '' );

geometry.computeBoundsTree();

const bvhSize = getSize( geometry.boundsTree );
console.log( `${ pad( 'BVH Memory Usage', 25 ) }: ${ bvhSize / 1000 } kb` );
