import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import Stats from 'stats.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { BVHHelper, getBVHExtremes } from 'three-mesh-bvh';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SkinnedMeshBVH } from './src/SkinnedMeshBVH.js';

const params = {
	skeletonHelper: false,
	bvhHelper: true,
	bvhHelperDepth: 10,

	autoUpdate: true,
	updateRate: 0.5,
	pause: false,
	regenerate: () => {

		refitBVH();

	}
};

let renderer, camera, scene, clock, gui, stats;
let outputContainer;
let controls, mixer, animationAction, model;
let skeletonHelper;
let timeSinceUpdate = 0;
let initialScore = 0;
let bvhs = [], helpers = [];

init();
render();

function init() {

	const bgColor = 0x111111;

	outputContainer = document.getElementById( 'output' );

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();

	const light = new THREE.DirectionalLight( 0xffffff, 3 );
	light.position.set( 5, 5, 2.5 );
	light.shadow.mapSize.setScalar( 1024 );
	light.shadow.normalBias = 1e-2;
	light.castShadow = true;

	const shadowCam = light.shadow.camera;
	shadowCam.left = shadowCam.bottom = - 7.5;
	shadowCam.right = shadowCam.top = 7.5;
	shadowCam.updateProjectionMatrix();
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xb0bec5, 2.4 ) );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 10, 0, 0 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	controls = new OrbitControls( camera, renderer.domElement );

	clock = new THREE.Clock();

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// load the model
	new GLTFLoader()
		.load( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/trex/scene.gltf', gltf => {

			// prep the model and add it to the scene
			model = gltf.scene;
			model.traverse( object => {

				if ( object.isMesh ) {

					object.castShadow = true;
					object.receiveShadow = true;
					object.frustumCulled = false;

					const bvh = new SkinnedMeshBVH( object );
					const helper = new BVHHelper( object, bvh, params.bvhHelperDepth );
					helper.update();
					scene.add( helper );
					bvhs.push( bvh );
					helpers.push( helper );

				}

			} );

			model.updateMatrixWorld( true );
			scene.add( model );

			// skeleton helper
			skeletonHelper = new THREE.SkeletonHelper( model );
			skeletonHelper.visible = false;
			scene.add( skeletonHelper );

			// animations
			const animations = gltf.animations;
			mixer = new THREE.AnimationMixer( model );

			animationAction = mixer.clipAction( animations[ 0 ] );
			animationAction.play();
			animationAction.paused = params.pause;

			// camera setup
			const box = new THREE.Box3();
			box.setFromObject( model );
			box.getCenter( controls.target );
			box.getCenter( camera.position );
			camera.position.x = 7.5;
			camera.position.z = 3.5;
			controls.update();

			initialScore = calculateScore( bvhs );

		} );


	const plane = new THREE.Mesh( new THREE.PlaneGeometry(), new THREE.ShadowMaterial( { color: 0xffffff, opacity: 0.025, transparent: true } ) );
	plane.rotation.x = - Math.PI / 2;
	plane.receiveShadow = true;
	plane.scale.setScalar( 50 );
	scene.add( plane );

	gui = new GUI();
	const helperFolder = gui.addFolder( 'helpers' );
	helperFolder.add( params, 'skeletonHelper' );
	helperFolder.add( params, 'bvhHelper' );
	helperFolder.add( params, 'bvhHelperDepth', 1, 20, 1 ).onChange( v => {

		helpers.forEach( helper => {

			helper.depth = parseInt( v );
			helper.update();

		} );

	} );
	helperFolder.open();

	const bvhFolder = gui.addFolder( 'bvh animation' );
	bvhFolder.add( params, 'autoUpdate' );
	bvhFolder.add( params, 'updateRate', 0, 2, 0.001 );
	bvhFolder.add( params, 'pause' ).onChange( v => {

		if ( animationAction ) {

			animationAction.paused = v;

		}

	} );
	bvhFolder.add( params, 'regenerate' );
	bvhFolder.open();

	gui.open();

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

}

// refit the BVH to match the current skeleton pose
function refitBVH() {

	let refitTime;
	const start = performance.now();
	bvhs.forEach( bvh => {

		bvh.refit();

	} );

	refitTime = performance.now() - start;

	helpers.forEach( helper => {

		helper.update();

	} );

	timeSinceUpdate = 0;

	const score = calculateScore( bvhs );
	const degradation = ( score / initialScore ) - 1.0;
	outputContainer.innerHTML =
		`refit time: ${ refitTime.toFixed( 2 ) } ms\n` +
		`bvh degradation: ${ ( 100 * degradation ).toFixed( 2 ) }%`;

}

function calculateScore( bvhs ) {

	let score = 0;
	bvhs.forEach( bvh => {

		const extremes = getBVHExtremes( bvh );
		for ( const i in extremes ) {

			score += extremes[ i ].surfaceAreaScore;

		}

	} );

	return score;

}

function render() {

	stats.update();
	requestAnimationFrame( render );

	const delta = Math.min( clock.getDelta(), 30 * 0.001 );

	// update animation and helpers
	if ( mixer ) {

		mixer.update( delta );
		skeletonHelper.visible = params.skeletonHelper;
		helpers.forEach( helper => {

			helper.visible = params.bvhHelper;

		} );

	}

	scene.updateMatrixWorld( true );

	// refit on a cycle
	if ( params.autoUpdate && ! params.pause ) {

		if ( timeSinceUpdate > params.updateRate ) {

			refitBVH();

		}

		timeSinceUpdate += delta;

	} else {

		timeSinceUpdate = 0;

	}

	renderer.render( scene, camera );

}
