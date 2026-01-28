import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'stats.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ObjectBVH } from './src/bvh/ObjectBVH.js';
import { BVHHelper } from 'three-mesh-bvh';

const CHARACTER_COUNT = 50;

const params = {
	animate: false,
	precise: false,
	showHelper: true,
	helperDepth: 10,
	helperParents: false,
};

let renderer, scene, camera, controls, stats, clock;
let container, sceneBVH, bvhHelper;
let mixers = [];

init();

function init() {

	// Renderer
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( 0x131619, 1 );
	document.body.appendChild( renderer.domElement );

	// Scene
	scene = new THREE.Scene();

	// Lights
	const light1 = new THREE.DirectionalLight( 0xffffff, 2.5 );
	light1.position.set( 1, 2, 1 );
	const light2 = new THREE.DirectionalLight( 0xffffff, 0.75 );
	light2.position.set( - 1, - 2, - 1 );
	scene.add( light1, light2, new THREE.AmbientLight( 0xffffff, 0.75 ) );

	// Camera
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 2000 );
	camera.position.set( 9, 9, 0 );

	// Controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.enablePan = false;
	controls.enableDamping = true;

	// Container
	container = new THREE.Group();
	scene.add( container );

	// Clock
	clock = new THREE.Clock();

	// Stats
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// GUI
	const gui = new GUI();
	gui.add( params, 'animate' ).onChange( v => ! v && updateBVH() );
	gui.add( params, 'precise' ).onChange( () => ! params.animate && updateBVH() );
	gui.add( params, 'showHelper' );
	gui.add( params, 'helperDepth', 1, 20, 1 ).onChange( v => {

		if ( bvhHelper ) {

			bvhHelper.depth = v;
			bvhHelper.update();

		}

	} );
	gui.add( params, 'helperParents' ).onChange( v => {

		if ( bvhHelper ) {

			bvhHelper.displayParents = v;
			bvhHelper.update();

		}

	} );

	// Events
	window.addEventListener( 'resize', () => {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize( window.innerWidth, window.innerHeight );

	} );

	// Load model
	const url = 'https://raw.githack.com/mrdoob/three.js/r94/examples/models/fbx/Samba%20Dancing.fbx';
	new FBXLoader().load( url, fbx => {

		const model = fbx;
		const animation = fbx.animations[ 0 ];

		// Create characters in sunflower pattern
		const goldenAngle = Math.PI * ( 3 - Math.sqrt( 5 ) );

		for ( let i = 0; i < CHARACTER_COUNT; i ++ ) {

			const char = SkeletonUtils.clone( model );
			char.scale.setScalar( 0.01 );

			// Vogel distribution
			const angle = i * goldenAngle;
			const dist = Math.sqrt( i );
			char.position.set( Math.cos( angle ) * dist, 0, Math.sin( angle ) * dist );
			char.rotation.y = Math.random() * Math.PI * 2;

			container.add( char );

			// Setup animation
			const mixer = new THREE.AnimationMixer( char );
			const action = mixer.clipAction( animation );
			action.timeScale = 0.8 + Math.random() * 0.4;
			action.time = Math.random() * animation.duration;
			action.play();
			mixer.update( 0 ); // Apply initial random pose

			mixers.push( mixer );

		}

		// Build BVH
		container.updateMatrixWorld( true );
		sceneBVH = new ObjectBVH( container, { maxLeafSize: 1, precise: params.precise } );

		bvhHelper = new BVHHelper( container, sceneBVH, params.helperDepth );
		bvhHelper.color.set( 0xffffff );
		scene.add( bvhHelper );

	} );

}

function updateBVH() {

	if ( ! sceneBVH ) return;

	// Clear cached bounds on skinned meshes
	container.traverse( child => {

		if ( child.isSkinnedMesh ) {

			child.boundingBox = null;
			child.geometry.boundingBox = null;
			child.geometry.boundingSphere = null;

		}

	} );

	// Refit BVH
	console.time( 'BVH Refit' );
	container.updateMatrixWorld( true );
	sceneBVH.precise = params.precise;
	sceneBVH.refit();
	console.timeEnd( 'BVH Refit' );

	bvhHelper.bvh = sceneBVH;
	bvhHelper.update();

}

function render() {

	stats.begin();

	// Update GUI settings
	if ( bvhHelper ) bvhHelper.visible = params.showHelper;

	controls.update();

	// Update animations
	if ( params.animate ) {

		const delta = clock.getDelta();
		mixers.forEach( mixer => mixer.update( delta ) );

	}

	renderer.render( scene, camera );
	stats.end();

}

renderer.setAnimationLoop( render );
