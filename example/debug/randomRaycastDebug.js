import {
	Scene,
	Raycaster,
	BatchedMesh,
	MeshStandardMaterial,
	TorusGeometry,
	SphereGeometry,
	Object3D,
	PerspectiveCamera,
	WebGLRenderer,
	LineBasicMaterial,
	DirectionalLight,
	AmbientLight,
	BufferGeometry,
	Line,
	Color,
	Mesh,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
	acceleratedRaycast,
	computeBatchedBoundsTree,
	disposeBatchedBoundsTree,
	computeBoundsTree,
	disposeBoundsTree,
} from '../src/index.js';

Mesh.prototype.raycast = acceleratedRaycast;
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
BatchedMesh.prototype.raycast = acceleratedRaycast;
BatchedMesh.prototype.computeBoundsTree = computeBatchedBoundsTree;
BatchedMesh.prototype.disposeBoundsTree = disposeBatchedBoundsTree;

// random generator
const transformSeed = 6752666062;
const raySeed = 3786894961;

let _seed = null;
function setSeed( seed ) {

	_seed = seed;

}

function random() {

	if ( _seed === null ) throw new Error( 'Seed not set' );
	const a = 1103515245;
	const c = 12345;
	const m = 2e31;
	_seed = ( a * _seed + c ) % m;
	return _seed / m;

}

// random transforms
function randomizeObjectTransform( target, uniformScale = true ) {

	target.rotation.x = random() * 10;
	target.rotation.y = random() * 10;
	target.rotation.z = random() * 10;

	target.position.x = random();
	target.position.y = random();
	target.position.z = random();

	if ( uniformScale ) {

		// TODO: temp fix related to issue gkjohnson/three-mesh-bvh#794
		target.scale.setScalar( random() * 2 - 1 );

	} else {

		target.scale.x = random() * 2 - 1;
		target.scale.y = random() * 2 - 1;
		target.scale.z = random() * 2 - 1;

	}

	target.updateMatrixWorld( true );

}

let camera, controls, renderer;
let batchedMesh, boundsTrees;
const scene = new Scene();
const raycaster = new Raycaster();

// function for creating the test scene setup for raycasting
function createTestMesh( ) {

	setSeed( transformSeed );
	random();

	// construct batched mesh
	const geo = new TorusGeometry( 1, 1, 40, 10 );
	const geo2 = new SphereGeometry( 1, 32, 16 );
	const count = geo.attributes.position.count + geo2.attributes.position.count;
	const indexCount = geo.index.count + geo2.index.count;
	batchedMesh = new BatchedMesh( 10, count, indexCount, new MeshStandardMaterial() );

	// adjust transform
	randomizeObjectTransform( batchedMesh, true );

	// construct bounds
	const geoId = batchedMesh.addGeometry( geo );
	const geo2Id = batchedMesh.addGeometry( geo2 );
	batchedMesh.computeBoundsTree( - 1 );
	boundsTrees = batchedMesh.boundsTrees;

	// add instances
	const tempObj = new Object3D();
	for ( let i = 0; i < 10; i ++ ) {

		randomizeObjectTransform( tempObj );

		const id = batchedMesh.addInstance( i % 2 === 0 ? geoId : geo2Id );
		batchedMesh.setMatrixAt( id, tempObj.matrix );

	}

}

function performRaycasts() {

	// test w/ bvh
	batchedMesh.boundsTrees = boundsTrees;
	const bvhHits = raycaster.intersectObject( batchedMesh, true );

	// test w/o bvh
	batchedMesh.boundsTrees = null;
	const ogHits = raycaster.intersectObject( batchedMesh, true );

	console.log( `Without BVH: ${ ogHits.length } hits, With BVH: ${ bvhHits.length } hits` );

	return { bvhHits, ogHits };

}

function visualizeRay() {

	const rayLength = 20;
	const rayPoints = [
		raycaster.ray.origin.clone(),
		raycaster.ray.origin.clone().add( raycaster.ray.direction.clone().multiplyScalar( rayLength ) ),
	];

	const rayGeometry = new BufferGeometry().setFromPoints( rayPoints );
	const rayMaterial = new LineBasicMaterial( { color: 0xff0000 } );
	const rayLine = new Line( rayGeometry, rayMaterial );
	scene.add( rayLine );

}

function addSphere( point, color ) {

	const mesh = new Mesh( new SphereGeometry( 0.025 ) );
	mesh.material.color.set( color );
	mesh.position.copy( point );
	scene.add( mesh );

}

function init() {

	renderer = new WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	document.body.appendChild( renderer.domElement );

	camera = new PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );
	camera.position.set( 5, 5, 5 );
	camera.lookAt( 0, 0, 0 );

	const directionalLight = new DirectionalLight( 0xffffff, 3.0 );
	scene.add( directionalLight );

	const ambientLight = new AmbientLight( 0xffffff, 1.0 );
	scene.add( ambientLight );

	controls = new OrbitControls( camera, renderer.domElement );
	controls.enableDamping = true;

	// batched mesh setup
	createTestMesh();
	scene.add( batchedMesh );

	// raycaster setup
	setSeed( raySeed );
	random();

	raycaster.firstHitOnly = false;
	raycaster.ray.origin.set( random() * 10, random() * 10, random() * 10 );
	raycaster.ray.direction.copy( raycaster.ray.origin ).multiplyScalar( - 1 ).normalize();

	// visualize hits
	const { bvhHits, ogHits } = performRaycasts();
	visualizeRay();
	addSphere( raycaster.ray.origin, 0xffff00 );
	bvhHits.forEach( ( hit, i ) => {

		const isMatch = ogHits[ i ] && Math.abs( ogHits[ i ].distance - hit.distance ) < 0.0001;
		const color = isMatch ? new Color( 0x00ff00 ) : new Color( 0xff0000 );
		addSphere( hit.point, color );

	} );

	function animate() {

		requestAnimationFrame( animate );
		controls.update();
		renderer.render( scene, camera );

	}

	animate();

	// handle window resize
	window.addEventListener( 'resize', () => {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize( window.innerWidth, window.innerHeight );

	} );

}

init();
