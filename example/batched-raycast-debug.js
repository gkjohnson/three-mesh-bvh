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
	Vector3,
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
	CENTER,
} from '../src/index.js';

// ========================================
// Setup and Patching
// ========================================

// Patch prototypes with BVH functionality
Mesh.prototype.raycast = acceleratedRaycast;
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
BatchedMesh.prototype.raycast = acceleratedRaycast;
BatchedMesh.prototype.computeBoundsTree = computeBatchedBoundsTree;
BatchedMesh.prototype.disposeBoundsTree = disposeBatchedBoundsTree;

// ========================================
// Random Number Generator
// ========================================

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

function randomizeObjectTransform( target ) {

	target.rotation.x = random() * 10;
	target.rotation.y = random() * 10;
	target.rotation.z = random() * 10;

	target.position.x = random();
	target.position.y = random();
	target.position.z = random();

	target.scale.x = random() * 2 - 1;
	target.scale.y = random() * 2 - 1;
	target.scale.z = random() * 2 - 1;

	target.updateMatrixWorld( true );

}

// ========================================
// Scene Setup
// ========================================

const transformSeed = 178822121;
const raySeed = 4568416801;
const options = { strategy: CENTER, batched: true };

const scene = new Scene();
const raycaster = new Raycaster();

function setupRenderer() {

	const renderer = new WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	document.body.appendChild( renderer.domElement );
	return renderer;

}

function setupCamera() {

	const camera = new PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );
	camera.position.set( 5, 5, 5 );
	camera.lookAt( 0, 0, 0 );
	return camera;

}

function setupLights( scene ) {

	const directionalLight = new DirectionalLight( 0xffffff, 3.0 );
	scene.add( directionalLight );

	const ambientLight = new AmbientLight( 0xffffff, 1.0 );
	scene.add( ambientLight );

}

function setupControls( camera, domElement ) {

	const controls = new OrbitControls( camera, domElement );
	controls.enableDamping = true;
	return controls;

}

// ========================================
// BatchedMesh Setup
// ========================================

function createBatchedMesh( scene ) {

	setSeed( transformSeed );
	random(); // seed with larger value

	const geo = new TorusGeometry( 1, 1, 40, 10 );
	geo.computeBoundsTree( options );
	const ungroupedBvh = geo.boundsTree;

	const geo2 = new SphereGeometry( 1, 32, 16 );
	const count = geo.attributes.position.count + geo2.attributes.position.count;
	const indexCount = geo.index.count + geo2.index.count;

	const batchedMesh = new BatchedMesh( 10, count, indexCount, new MeshStandardMaterial() );
	randomizeObjectTransform( batchedMesh );
	scene.add( batchedMesh );

	const geoId = batchedMesh.addGeometry( geo );
	const geo2Id = batchedMesh.addGeometry( geo2 );
	batchedMesh.computeBoundsTree( - 1, options );

	const tempObj = new Object3D();
	for ( let i = 0; i < 10; i ++ ) {

		randomizeObjectTransform( tempObj );
		const id = batchedMesh.addInstance( i % 2 === 0 ? geoId : geo2Id );
		batchedMesh.setMatrixAt( id, tempObj.matrix );

	}

	return {
		batchedMesh,
		batchedMeshBvh: batchedMesh.boundsTrees,
		geo,
		ungroupedBvh,
	};

}

// ========================================
// Raycasting
// ========================================

function setupRaycaster( raycaster ) {

	setSeed( raySeed );
	random(); // seed with larger value

	raycaster.firstHitOnly = false;
	raycaster.ray.origin.set( random() * 10, random() * 10, random() * 10 );
	raycaster.ray.direction.copy( raycaster.ray.origin ).multiplyScalar( - 1 ).normalize();

}

function performRaycasts( scene, raycaster, batchedMesh, batchedMeshBvh, geo, ungroupedBvh ) {

	// Test with BVH
	geo.boundsTree = ungroupedBvh;
	batchedMesh.boundsTrees = batchedMeshBvh;
	const bvhHits = raycaster.intersectObject( scene, true );

	// Test without BVH
	geo.boundsTree = null;
	batchedMesh.boundsTrees = null;
	const ogHits = raycaster.intersectObject( scene, true );

	console.log( `Without BVH: ${ ogHits.length } hits, With BVH: ${ bvhHits.length } hits` );

	return { bvhHits, ogHits };

}

// ========================================
// Visualization
// ========================================

function visualizeRay( scene, raycaster ) {

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

function visualizeRayOrigin( scene, origin ) {

	const crosshairSize = 0.2;
	const material = new LineBasicMaterial( { color: 0xffff00 } );

	// X axis
	const xPoints = [
		new Vector3( - crosshairSize, 0, 0 ).add( origin ),
		new Vector3( crosshairSize, 0, 0 ).add( origin ),
	];
	const xGeometry = new BufferGeometry().setFromPoints( xPoints );
	scene.add( new Line( xGeometry, material ) );

	// Y axis
	const yPoints = [
		new Vector3( 0, - crosshairSize, 0 ).add( origin ),
		new Vector3( 0, crosshairSize, 0 ).add( origin ),
	];
	const yGeometry = new BufferGeometry().setFromPoints( yPoints );
	scene.add( new Line( yGeometry, material ) );

	// Z axis
	const zPoints = [
		new Vector3( 0, 0, - crosshairSize ).add( origin ),
		new Vector3( 0, 0, crosshairSize ).add( origin ),
	];
	const zGeometry = new BufferGeometry().setFromPoints( zPoints );
	scene.add( new Line( zGeometry, material ) );

}

function visualizeHitPoint( scene, point, isMatch ) {

	const color = isMatch ? new Color( 0x00ff00 ) : new Color( 0xff0000 );
	const crosshairSize = 0.1;

	// X axis
	const xPoints = [
		point.clone().add( new Vector3( crosshairSize, 0, 0 ) ),
		point.clone().add( new Vector3( - crosshairSize, 0, 0 ) ),
	];
	const xGeometry = new BufferGeometry().setFromPoints( xPoints );
	scene.add( new Line( xGeometry, new LineBasicMaterial( { color } ) ) );

	// Y axis
	const yPoints = [
		point.clone().add( new Vector3( 0, crosshairSize, 0 ) ),
		point.clone().add( new Vector3( 0, - crosshairSize, 0 ) ),
	];
	const yGeometry = new BufferGeometry().setFromPoints( yPoints );
	scene.add( new Line( yGeometry, new LineBasicMaterial( { color } ) ) );

	// Z axis
	const zPoints = [
		point.clone().add( new Vector3( 0, 0, crosshairSize ) ),
		point.clone().add( new Vector3( 0, 0, - crosshairSize ) ),
	];
	const zGeometry = new BufferGeometry().setFromPoints( zPoints );
	scene.add( new Line( zGeometry, new LineBasicMaterial( { color } ) ) );

}

function visualizeHits( scene, bvhHits, ogHits ) {

	bvhHits.forEach( ( hit, i ) => {

		const matches = ogHits[ i ] && Math.abs( ogHits[ i ].distance - hit.distance ) < 0.0001;
		visualizeHitPoint( scene, hit.point, matches );

	} );

}

// ========================================
// Main
// ========================================

function init() {

	// Setup rendering
	const renderer = setupRenderer();
	const camera = setupCamera();
	const controls = setupControls( camera, renderer.domElement );
	setupLights( scene );

	// Create BatchedMesh
	const { batchedMesh, batchedMeshBvh, geo, ungroupedBvh } = createBatchedMesh( scene );

	// Setup and perform raycasts
	setupRaycaster( raycaster );
	const { bvhHits, ogHits } = performRaycasts( scene, raycaster, batchedMesh, batchedMeshBvh, geo, ungroupedBvh );

	// Visualize
	visualizeRay( scene, raycaster );
	visualizeRayOrigin( scene, raycaster.ray.origin );
	visualizeHits( scene, bvhHits, ogHits );

	// Animation loop
	function animate() {

		requestAnimationFrame( animate );
		controls.update();
		renderer.render( scene, camera );

	}

	animate();

	// Handle window resize
	window.addEventListener( 'resize', () => {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize( window.innerWidth, window.innerHeight );

	} );

}

init();
