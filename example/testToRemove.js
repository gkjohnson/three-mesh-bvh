import * as THREE from 'three';
import { computeBoundsTree, SAH } from '../src';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;

// geometry setup
const radius = 5;
const tube = 0.4;
const tubularSegments = 200;
const radialSegments = 50;
const geometry = new THREE.TorusKnotGeometry( radius, tube, tubularSegments, radialSegments );

geometry.computeBoundsTree( {
	maxLeafTris: 5,
	strategy: SAH,
} );

const bvh = geometry.boundsTree;
const target = new THREE.Vector3();
// const target2 = new THREE.Vector3();

// // TEST EQUALS RESULTS

// for ( let i = 0; i < 100000; i ++ ) {

// 	p.random().multiplyScalar( 10 ).subScalar( 5 );
// 	bvh.closestPointToPoint( p, target );
// 	bvh.closestPointToPointOld( p, target2 );

// 	if ( target.distance !== target2.distance ) console.error( "different result" );

// }

// TEST PERFORMANCE

const count = 50000;

const points = new Array( count );
for ( let i = 0; i < count; i ++ ) {

	points[ i ] = new THREE.Vector3().random().multiplyScalar( 5 ).subScalar( 2.5 );

}

console.log( "TESTING NEW FUNCTION: " );

for ( let j = 0; j < 5; j ++ ) {

	console.time( count + " tries" );

	for ( let i = 0; i < count; i ++ ) {

		bvh.closestPointToPoint( points[ i ], target );

	}

	console.timeEnd( count + " tries" );

}

console.log( "TESTING OLD FUNCTION: " );

for ( let j = 0; j < 5; j ++ ) {

	console.time( count + " tries" );

	for ( let i = 0; i < count; i ++ ) {

		bvh.closestPointToPointOld( points[ i ], target );

	}

	console.timeEnd( count + " tries" );

}
