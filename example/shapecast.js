import Stats from 'stats.js';
import * as dat from 'three/examples/jsm/libs/lil-gui.module.min.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, BVHHelper } from 'three-mesh-bvh';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const params = {
	speed: 1,
	displayBVH: false,
	displayDepth: 10,
	shape: 'sphere',
	position: new THREE.Vector3(),
	rotation: new THREE.Euler(),
	scale: new THREE.Vector3( 1, 1, 1 ),
};

let stats, scene, camera, renderer, orbitControls, bvhHelper, transformControls;
let targetMesh, shapes;
let lastTime = window.performance.now();

init();
updateFromOptions();
renderer.setAnimationLoop( render );

function init() {

	const bgColor = 0x131619;

	// Renderer
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	document.body.appendChild( renderer.domElement );

	// Scene
	scene = new THREE.Scene();
	scene.fog = new THREE.Fog( bgColor, 20, 60 );

	// Lights
	const light = new THREE.DirectionalLight( 0xffffff, 1.5 );
	light.position.set( 1, 1, 1 );
	scene.add( light, new THREE.AmbientLight( 0xffffff, 1.2 ) );

	// Target mesh
	const knotGeometry = new THREE.TorusKnotGeometry( 1, 0.4, 400, 100 );
	const material = new THREE.MeshPhongMaterial( { color: 0xffffff, side: THREE.DoubleSide } );
	targetMesh = new THREE.Mesh( knotGeometry, material );
	targetMesh.geometry.computeBoundsTree();
	scene.add( targetMesh );

	// Camera
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 100 );
	camera.position.set( 3, 3, 3 );

	// Controls
	transformControls = new TransformControls( camera, renderer.domElement );
	scene.add( transformControls.getHelper() );

	orbitControls = new OrbitControls( camera, renderer.domElement );

	// Stats
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// Intersection shapes
	const shapeMaterial = new THREE.MeshStandardMaterial( {
		metalness: 0.1,
		transparent: true,
		opacity: 0.75,
		premultipliedAlpha: true
	} );

	shapes = {
		sphere: new THREE.Mesh( new THREE.SphereGeometry( 1, 50, 50 ), shapeMaterial ),
		box: new THREE.Mesh( new THREE.BoxGeometry( 1, 1, 1 ), shapeMaterial ),
		geometry: new THREE.Mesh( new THREE.TorusKnotGeometry( 0.5, 0.2, 200, 50 ), shapeMaterial ),
	};

	shapes.geometry.geometry.computeBoundsTree();
	Object.values( shapes ).forEach( shape => scene.add( shape ) );

	// GUI
	const gui = new dat.GUI();
	gui.add( params, 'speed', 0, 10 );
	gui.add( params, 'displayBVH' ).onChange( updateFromOptions );
	gui.add( params, 'displayDepth', 1, 40, 1 ).onChange( v => {

		if ( bvhHelper ) {

			bvhHelper.depth = v;
			bvhHelper.update();

		}

	} );
	gui.add( params, 'shape', [ 'sphere', 'box', 'geometry' ] );
	gui.add( transformControls, 'mode', [ 'translate', 'rotate' ] );

	const posFolder = gui.addFolder( 'Position' );
	posFolder.add( params.position, 'x', - 5, 5, 0.001 );
	posFolder.add( params.position, 'y', - 5, 5, 0.001 );
	posFolder.add( params.position, 'z', - 5, 5, 0.001 );
	posFolder.open();

	const rotFolder = gui.addFolder( 'Rotation' );
	rotFolder.add( params.rotation, 'x', - Math.PI, Math.PI, 0.001 );
	rotFolder.add( params.rotation, 'y', - Math.PI, Math.PI, 0.001 );
	rotFolder.add( params.rotation, 'z', - Math.PI, Math.PI, 0.001 );
	rotFolder.open();

	gui.open();

	// Transform controls sync with GUI
	transformControls.addEventListener( 'change', () => {

		params.position.copy( shapes[ params.shape ].position );
		params.rotation.copy( shapes[ params.shape ].rotation );
		params.scale.copy( shapes[ params.shape ].scale );
		gui.controllersRecursive().forEach( c => c.updateDisplay() );

	} );

	// Disable orbit controls when using transform controls
	transformControls.addEventListener( 'mouseDown', () => orbitControls.enabled = false );
	transformControls.addEventListener( 'mouseUp', () => orbitControls.enabled = true );
	orbitControls.addEventListener( 'start', () => transformControls.enabled = false );
	orbitControls.addEventListener( 'end', () => transformControls.enabled = true );

	// Keyboard shortcuts
	window.addEventListener( 'keydown', e => {

		if ( e.key === 'w' ) transformControls.mode = 'translate';
		if ( e.key === 'e' ) transformControls.mode = 'rotate';
		gui.controllersRecursive().forEach( c => c.updateDisplay() );

	} );

	window.addEventListener( 'resize', () => {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize( window.innerWidth, window.innerHeight );

	} );

}

function updateFromOptions() {

	// Update bounds visualization
	if ( bvhHelper && ! params.displayBVH ) {

		scene.remove( bvhHelper );
		bvhHelper = null;

	}

	if ( ! bvhHelper && params.displayBVH ) {

		bvhHelper = new BVHHelper( targetMesh );
		scene.add( bvhHelper );

	}

}

function render() {

	const delta = window.performance.now() - lastTime;
	lastTime = window.performance.now();

	targetMesh.rotation.y += params.speed * delta * 0.001;
	targetMesh.updateMatrixWorld();

	stats.begin();

	if ( bvhHelper ) bvhHelper.visible = params.displayBVH;

	// Hide all shapes, then show and update the selected one
	Object.values( shapes ).forEach( shape => shape.visible = false );

	const shape = shapes[ params.shape ];
	shape.visible = true;
	shape.position.copy( params.position );
	shape.rotation.copy( params.rotation );
	shape.scale.copy( params.scale );

	const transformMatrix = new THREE.Matrix4()
		.copy( targetMesh.matrixWorld )
		.invert()
		.multiply( shape.matrixWorld );

	// Perform intersection test
	let hit = false;
	if ( params.shape === 'sphere' ) {

		const sphere = new THREE.Sphere( undefined, 1 );
		sphere.applyMatrix4( transformMatrix );
		hit = targetMesh.geometry.boundsTree.intersectsSphere( sphere );

	} else if ( params.shape === 'box' ) {

		const box = new THREE.Box3();
		box.min.set( - 0.5, - 0.5, - 0.5 );
		box.max.set( 0.5, 0.5, 0.5 );
		hit = targetMesh.geometry.boundsTree.intersectsBox( box, transformMatrix );

	} else if ( params.shape === 'geometry' ) {

		hit = targetMesh.geometry.boundsTree.intersectsGeometry( shape.geometry, transformMatrix );

	}

	// Update material based on intersection
	shape.material.color.set( hit ? 0xE91E63 : 0x666666 );
	shape.material.emissive.set( 0xE91E63 ).multiplyScalar( hit ? 0.25 : 0 );

	// Attach transform controls to active shape
	if ( transformControls.object !== shape ) transformControls.attach( shape );

	renderer.render( scene, camera );
	stats.end();

}
