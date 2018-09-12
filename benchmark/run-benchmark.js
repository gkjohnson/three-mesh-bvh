import { getSize, pad } from './utils.js';
import * as THREE from '../node_modules/three/build/three.module.js';
import '../index.js';

const BenchmarkJS = require( 'benchmarkjs' );

// BenchmarkJS.options( {

// 	testTime: 4000

// } );

const geometry = new THREE.TorusBufferGeometry( 5, 5, 100, 25 );
const mesh = new THREE.Mesh( geometry, new THREE.MeshBasicMaterial() );
const raycaster = new THREE.Raycaster();
raycaster.ray.origin.set( 0, 0, - 10 );
raycaster.ray.direction.set( 0, 0, 1 );

BenchmarkJS( 'Compute Bounds Tree', () => {

	geometry.boundsTree = null;
	geometry.computeBoundsTree();

} );

geometry.boundsTree = null;
raycaster.firstHitOnly = false;
BenchmarkJS( 'Default Raycast', () => {

	mesh.raycast( raycaster, [] );

} );

geometry.computeBoundsTree();
raycaster.firstHitOnly = false;
BenchmarkJS( 'BVH Raycast', () => {

	mesh.raycast( raycaster, [] );

} );

geometry.computeBoundsTree();
raycaster.firstHitOnly = true;
BenchmarkJS( 'First Hit Raycast', () => {

	mesh.raycast( raycaster, [] );

} );

geometry.computeBoundsTree();
const bvhSize = getSize( geometry.boundsTree );
console.log( `${ pad( 'Memory Usage', 25 ) }: ${ bvhSize / 1000 } kb` );
console.log( '' );

BenchmarkJS
	.results
	.reverse()
	.forEach( r => {

		console.log( `${ pad( r.name, 25 ) }: ${ parseFloat( ( r.elapsed / r.totalIterations ).toFixed( 6 ) ) } ms` );

	} );
