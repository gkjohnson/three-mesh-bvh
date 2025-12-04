import {
	Mesh,
	BufferGeometry,
	SphereGeometry,
	MeshBasicMaterial,
	Raycaster,
} from 'three';
import {
	MeshBVH,
	acceleratedRaycast,
	computeBoundsTree,
	disposeBoundsTree,
} from 'three-mesh-bvh';

Mesh.prototype.raycast = acceleratedRaycast;
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

describe( 'Multi-Material', () => {

	let mesh, raycaster, bvh;
	beforeEach( () => {

		mesh = new Mesh( new SphereGeometry( 1, 40, 40 ) );
		bvh = new MeshBVH( mesh.geometry );
		raycaster = new Raycaster();
		raycaster.ray.origin.set( 0, 0, - 10 );
		raycaster.ray.direction.set( 0, 0, 1 );

	} );

	it( 'should match three.js hit results with an empty array', () => {

		let ogHits, hits;
		ogHits = raycaster.intersectObject( mesh );
		mesh.geometry.boundsTree = bvh;
		hits = raycaster.intersectObject( mesh );

		expect( hits ).toEqual( ogHits );

	} );

	it( 'should match three.js hit results with multi-material and no groups', () => {

		let ogHits, hits;
		mesh.material = [ new MeshBasicMaterial(), new MeshBasicMaterial() ];

		ogHits = raycaster.intersectObject( mesh );
		mesh.geometry.boundsTree = bvh;
		hits = raycaster.intersectObject( mesh );

		expect( hits ).toEqual( ogHits );

	} );

	it( 'should match three.js hit results with a single material and groups', () => {

		let ogHits, hits;
		const stride = mesh.geometry.index.count / 2;
		mesh.geometry.addGroup( 0, stride, 0 );
		mesh.geometry.addGroup( stride, stride, 0 );

		ogHits = raycaster.intersectObject( mesh );
		mesh.geometry.boundsTree = bvh;
		hits = raycaster.intersectObject( mesh );

		expect( hits ).toEqual( ogHits );

	} );

	it( 'should match three.js hit results with multi-material and groups', () => {

		let ogHits, hits;
		const stride = mesh.geometry.index.count / 2;
		mesh.geometry.addGroup( 0, stride, 0 );
		mesh.geometry.addGroup( stride, stride, 1 );
		mesh.material = [ new MeshBasicMaterial(), new MeshBasicMaterial() ];

		ogHits = raycaster.intersectObject( mesh );
		mesh.geometry.boundsTree = bvh;
		hits = raycaster.intersectObject( mesh );

		expect( hits ).toEqual( ogHits );

	} );

	it( 'should match three.js hit results with multi-material and overlapping groups', () => {

		let ogHits, hits;
		const stride = mesh.geometry.index.count;
		mesh.geometry.addGroup( 0, stride, 0 );
		mesh.geometry.addGroup( 0, stride, 1 );
		mesh.material = [ new MeshBasicMaterial(), new MeshBasicMaterial() ];

		ogHits = raycaster.intersectObject( mesh );
		mesh.geometry.boundsTree = bvh;
		hits = raycaster.intersectObject( mesh );

		expect( hits ).toEqual( ogHits );

	} );

	it( 'should match three.js hit results with multi-material, overlapping groups, and indirect', () => {

		let ogHits, hits;
		const stride = mesh.geometry.index.count;
		mesh.geometry.addGroup( 0, stride, 0 );
		mesh.geometry.addGroup( 0, stride, 1 );
		mesh.material = [ new MeshBasicMaterial(), new MeshBasicMaterial() ];
		bvh = new MeshBVH( mesh.geometry, { indirect: true } );

		ogHits = raycaster.intersectObject( mesh );
		mesh.geometry.boundsTree = bvh;
		hits = raycaster.intersectObject( mesh );

		expect( hits ).toEqual( ogHits );

	} );

} );
