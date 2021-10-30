import {
	Mesh,
	BufferGeometry,
	BufferAttribute,
	Vector3,
	Raycaster,
} from 'three';
import {
	MeshBVH,
	acceleratedRaycast,
	computeBoundsTree,
	disposeBoundsTree,
	CENTER,
	SAH,
	AVERAGE,
} from '../src/index.js';
import fs from 'fs';
import path from 'path';

const dataPath = path.resolve( __dirname, './data/points.bin' );
const buffer = fs.readFileSync( dataPath );
const points = new Float32Array( buffer.buffer, buffer.byteOffset, buffer.byteLength / 4 );

Mesh.prototype.raycast = acceleratedRaycast;
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

describe( 'AVERAGE Points Raycast', () => {

	let geometry = null;
	let mesh = null;
	let raycaster = null;
	beforeEach( () => {

		geometry = new BufferGeometry();
		geometry.setAttribute( 'position', new BufferAttribute( points.slice(), 3 ) );
		geometry.computeVertexNormals();

		mesh = new Mesh( geometry );

		// NOTE: If the geometry is not centered then the AVERAGE split strategy
		// case fails.
		geometry.computeBoundingBox();
		const center = new Vector3();
		geometry.boundingBox.getCenter( center );

		const x = 101086.2438562272 - center.x;
		const y = 99421.40510391879 - center.y;

		geometry.center();


		raycaster = new Raycaster();
		raycaster.firstHitOnly = true;
		raycaster.set( new Vector3( x, y, - 1000 ), new Vector3( 0, 0, 1 ) );

	} );

	it( 'should collide against the geometry with CENTER split', () => {

		geometry.boundsTree = new MeshBVH( geometry, {
			strategy: CENTER,
			maxDepth: 64,
			maxLeafTris: 16
		} );

		const res1 = raycaster.intersectObject( mesh );

		geometry.boundsTree = null;
		const res2 = raycaster.intersectObject( mesh );

		expect( res1 ).toEqual( res2 );

	} );

	it( 'should collide against the geometry with SAH split', () => {

		geometry.boundsTree = new MeshBVH( geometry, {
			strategy: SAH,
			maxDepth: 64,
			maxLeafTris: 16
		} );

		const res1 = raycaster.intersectObject( mesh );

		geometry.boundsTree = null;
		const res2 = raycaster.intersectObject( mesh );

		expect( res1 ).toEqual( res2 );

	} );

	it( 'should collide against the geometry with AVERAGE split', () => {

		geometry.boundsTree = new MeshBVH( geometry, {
			strategy: AVERAGE,
			maxDepth: 64,
			maxLeafTris: 16
		} );

		const res1 = raycaster.intersectObject( mesh );

		geometry.boundsTree = null;
		const res2 = raycaster.intersectObject( mesh );

		res1.length && delete res1[ 0 ].object;
		res2.length && delete res2[ 0 ].object;

		expect( res1 ).toEqual( res2 );

	} );

} );
