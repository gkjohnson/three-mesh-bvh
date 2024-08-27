import * as THREE from 'three';
import { computeBoundsTree, SAH } from '../src';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;

const spawnPointRadius = 10;
const radius = 100; // if radius 100 and tube 0.1, sort works really good.
const tube = 0.1;
const segmentsMultiplier = 8;
const maxLeafTris = 5;
const strategy = SAH;

const seed = 20000;

// const geometry = new THREE.SphereGeometry( radius, 8 * segmentsMultiplier, 4 * segmentsMultiplier );
const geometry = new THREE.TorusKnotGeometry( radius, tube, 64 * segmentsMultiplier, 8 * segmentsMultiplier );

geometry.computeBoundsTree( { maxLeafTris, strategy } );

export class PRNG {

	constructor( seed ) {

		this._seed = seed;

	}

	next() {

		let t = ( this._seed += 0x6d2b79f5 );
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	}

	range( min, max ) {

		return min + ( max - min ) * this.next();

	}

}

const bvh = geometry.boundsTree;
const target = new THREE.Vector3();
const target2 = new THREE.Vector3();

const count = 5000;
const r = new PRNG( seed );

const points = new Array( count );
for ( let i = 0; i < count; i ++ ) {

	points[ i ] = new THREE.Vector3( r.range( - spawnPointRadius, spawnPointRadius ), r.range( - spawnPointRadius, spawnPointRadius ), r.range( - spawnPointRadius, spawnPointRadius ) );

}

// // TEST EQUALS RESULTS

// for ( let i = 0; i < count; i ++ ) {

// 	bvh.closestPointToPoint( points[ i ], target );
// 	bvh.closestPointToPointOld( points[ i ], target2 );

// 	if ( target.distance !== target2.distance ) {

// 		const diff = target.distance - target2.distance;
// 		console.error( "error: " + ( diff / target2.distance * 100 ) + "%" );

// 	}

// }

// TEST PERFORMANCE

function benchmark() {

	const startOld = performance.now();

	for ( let i = 0; i < count; i ++ ) {

		bvh.closestPointToPointOld( points[ i ], target );

	}

	const endOld = performance.now() - startOld;
	const startNew = performance.now();

	for ( let i = 0; i < count; i ++ ) {

		bvh.closestPointToPoint( points[ i ], target );

	}

	const endNew = performance.now() - startNew;
	const startSort = performance.now();

	for ( let i = 0; i < count; i ++ ) {

		bvh.closestPointToPointSort( points[ i ], target );

	}

	const endSort = performance.now() - startSort;

	const bestEnd = Math.min( endSort, endNew );

	console.log( `New: ${endNew.toFixed( 1 )} / Sort: ${endSort.toFixed( 1 )} / Old: ${endOld.toFixed( 1 )} / Diff: ${( ( 1 - ( endOld / bestEnd ) ) * 100 ).toFixed( 2 )} %` );

}

benchmark();
setInterval( () => benchmark(), 1000 );
