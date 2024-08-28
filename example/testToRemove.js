import * as THREE from 'three';
import { computeBoundsTree, SAH } from '../src';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;

const spawnPointRadius = 100;
const radius = 10; // if radius 100 and tube 0.1 and spawnRadius 100, sort works really good.
const tube = 0.1;
const segmentsMultiplier = 32;
const sortedListMaxCount = 32;
const maxLeafTris = 10;
const strategy = SAH;

const tries = 1000;
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
const target = {};

const r = new PRNG( seed );
const points = new Array( tries );

function generatePoints() {

	for ( let i = 0; i < tries; i ++ ) {

		points[ i ] = new THREE.Vector3( r.range( - spawnPointRadius, spawnPointRadius ), r.range( - spawnPointRadius, spawnPointRadius ), r.range( - spawnPointRadius, spawnPointRadius ) );

	}

}


// // TEST EQUALS RESULTS

// generatePoints();
// const target2 = {};
// for ( let i = 0; i < tries; i ++ ) {

// 	bvh.closestPointToPoint( points[ i ], target );
// 	bvh.closestPointToPointHybrid( points[ i ], target2 );

// 	if ( target.distance !== target2.distance ) {

// 		const diff = target.distance - target2.distance;
// 		console.error( "error: " + ( diff / target2.distance * 100 ) + "%" );

// 	}

// }

// TEST PERFORMANCE

function benchmark() {

	generatePoints();

	const startOld = performance.now();

	for ( let i = 0; i < tries; i ++ ) {

		bvh.closestPointToPointOld( points[ i ], target );

	}

	const endOld = performance.now() - startOld;
	const startNew = performance.now();

	for ( let i = 0; i < tries; i ++ ) {

		bvh.closestPointToPoint( points[ i ], target );

	}

	const endNew = performance.now() - startNew;
	const startSort = performance.now();

	for ( let i = 0; i < tries; i ++ ) {

		bvh.closestPointToPointSort( points[ i ], target );

	}

	const endSort = performance.now() - startSort;
	const startHybrid = performance.now();

	for ( let i = 0; i < tries; i ++ ) {

		bvh.closestPointToPointHybrid( points[ i ], target, sortedListMaxCount );

	}

	const endHybrid = performance.now() - startHybrid;

	const bestEnd = Math.min( endSort, endNew, endHybrid );
	const best = bestEnd === endSort ? "Sorted" : ( bestEnd === endNew ? "New" : "Hybrid" );

	console.log( `New: ${endNew.toFixed( 1 )}ms / Sorted: ${endSort.toFixed( 1 )}ms / Hybrid: ${endHybrid.toFixed( 1 )}ms / Old: ${endOld.toFixed( 1 )}ms / Diff: ${( ( 1 - ( endOld / bestEnd ) ) * 100 ).toFixed( 2 )} % / Best: ${best}` );

}

benchmark();
setInterval( () => benchmark(), 1000 );
