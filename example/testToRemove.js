import * as THREE from 'three';
import { computeBoundsTree, SAH } from '../src';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;

const radius = 100;
const tube = 0.5;
// const tube = 0.5 * radius;
const tubularSegments = 800;
const radialSegments = 200;
const geometry = new THREE.TorusKnotGeometry( radius, tube, tubularSegments, radialSegments );

geometry.computeBoundsTree( {
	maxLeafTris: 5,
	strategy: SAH,
} );

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

const count = 10000;
const r = new PRNG( 10000 );

const points = new Array( count );
for ( let i = 0; i < count; i ++ ) {

	points[ i ] = new THREE.Vector3( r.next(), r.next(), r.next() ).multiplyScalar( 5 ).subScalar( 2.5 );

}

// TEST EQUALS RESULTS

for ( let i = 0; i < count; i ++ ) {

	bvh.closestPointToPoint( points[ i ], target );
	bvh.closestPointToPointOld( points[ i ], target2 );

	if ( target.distance !== target2.distance ) {

		const diff = target.distance - target2.distance;
		console.error( "error: " + ( diff / target2.distance * 100 ) + "%" );

	}

}

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

	console.log( `New: ${endNew.toFixed( 1 )} / Old: ${endOld.toFixed( 1 )} / Diff: ${( ( 1 - ( endOld / endNew ) ) * 100).toFixed( 2 )} %` );

	console.log( "..." );

}

benchmark();
setInterval( () => benchmark(), 1000 );
