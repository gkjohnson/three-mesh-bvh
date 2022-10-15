import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, AVERAGE, MeshBVHVisualizer } from '..';

// Code for debugging issue #180 and other random raycast test associated issues.
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

let renderer, camera, scene;
let meshes = [];

let _seed = null;
function random() {

	if ( _seed === null ) throw new Error();

	const a = 1103515245;
	const c = 12345;
	const m = 2e31;

	_seed = ( a * _seed + c ) % m;
	return _seed / m;

}

init();
render();

function init() {

	const bgColor = 0x111111;

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.outputEncoding = THREE.sRGBEncoding;
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();

	const light = new THREE.DirectionalLight( 0xffffff, 1 );
	light.position.set( 1, 1, 1 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xb0bec5, 0.8 ) );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 0, 0, 4 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	new OrbitControls( camera, renderer.domElement );

	const transformSeed = 7830035629;
	const raySeed = 4697211981;
	const options = { strategy: AVERAGE, packData: false, maxDepth: 1 };

	const geometry = new THREE.TorusGeometry( 1, 1, 40, 10 );
	geometry.computeBoundsTree( options );

	// mesh setup
	_seed = transformSeed;
	random(); // call random() to seed with a larger value

	for ( var i = 0; i < 10; i ++ ) {

		let mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
		mesh.rotation.x = random() * 10;
		mesh.rotation.y = random() * 10;
		mesh.rotation.z = random() * 10;

		mesh.position.x = random();
		mesh.position.y = random();
		mesh.position.z = random();

		// only the mesh at index 2 was causing an issue
		if ( i === 2 ) {

			meshes.push( mesh );
			scene.add( mesh );

			const wireframe = mesh.clone();
			wireframe.material = new THREE.MeshBasicMaterial( { wireframe: true, color: 0xff6666 } );
			scene.add( wireframe );

			const helper = new MeshBVHVisualizer( mesh, 10 );
			scene.add( helper );

			// mesh.add( new THREE.AxesHelper( 10 ) );

		}

		mesh.updateMatrix( true );
		mesh.updateMatrixWorld( true );

	}

	// raycast
	_seed = raySeed;
	random(); // call random() to seed with a larger value

	const raycaster = new THREE.Raycaster();
	raycaster.firstHitOnly = false;
	raycaster.ray.origin.set( random() * 10, random() * 10, random() * 10 );
	raycaster.ray.direction.copy( raycaster.ray.origin ).multiplyScalar( - 1 ).normalize();

	// set up raycast points
	const sphereGeom = new THREE.SphereGeometry( 0.1 );
	const sphereMesh = new THREE.Mesh( sphereGeom );

	sphereMesh.position.copy( raycaster.ray.at( 0, new THREE.Vector3() ) );
	scene.add( sphereMesh );

	// perform the hits
	const bvhHits = raycaster.intersectObjects( meshes, true );

	raycaster.firstHitOnly = true;
	const firstHit = raycaster.intersectObjects( meshes, true );

	geometry.boundsTree = null;
	const ogHits = raycaster.intersectObjects( meshes, true );

	console.log( 'FIRST HIT', firstHit );

	console.log( 'BVH HITS', bvhHits );

	console.log( 'OG HITS', ogHits );

	// draw hit points and line
	const firstHitSphere = sphereMesh.clone();
	firstHitSphere.position.copy( firstHit[ 0 ].point );
	scene.add( firstHitSphere );

	const bvhHitSphere = sphereMesh.clone();
	bvhHitSphere.position.copy( bvhHits[ 0 ].point );
	scene.add( bvhHitSphere );

	const line = new THREE.Line();
	line.geometry.setFromPoints(
		[
			raycaster.ray.at( 0, new THREE.Vector3() ),
			raycaster.ray.at( 20, new THREE.Vector3() ),
		]
	);
	scene.add( line );

	// resize listener
	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

}

function render() {

	requestAnimationFrame( render );

	renderer.render( scene, camera );

}
