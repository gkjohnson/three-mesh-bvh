import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import Stats from 'stats.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { BVHHelper, getBVHExtremes } from 'three-mesh-bvh';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SkinnedMeshBVH } from './src/SkinnedMeshBVH.js';

// override SkinnedMesh.prototype.raycast to use BVH if available
const ogSkinnedMeshRaycast = THREE.SkinnedMesh.prototype.raycast;
THREE.SkinnedMesh.prototype.raycast = function ( raycaster, intersects ) {

	if ( this.boundsTree && params.bvhRaycast ) {

		this.boundsTree.raycastObject3D( this, raycaster, intersects );

	} else {

		ogSkinnedMeshRaycast.call( this, raycaster, intersects );

	}

};

const params = {
	skeletonHelper: false,
	bvhHelper: true,
	bvhHelperDepth: 10,

	autoUpdate: true,
	pause: false,
	refit: () => refitBVH(),
	bvhRaycast: true,
};

let renderer, camera, scene, clock, gui, stats;
let outputContainer;
let controls, mixer, animationAction, model;
let skeletonHelper;
let initialScore = 0;
let bvhs = [], helpers = [];
let raycaster, mouse, sphereCollision;

init();

function init() {

	const bgColor = 0x111111;

	outputContainer = document.getElementById( 'output' );

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.setAnimationLoop( render );
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

	// raycaster setup
	raycaster = new THREE.Raycaster();
	raycaster.firstHitOnly = true;
	mouse = new THREE.Vector2();

	// collision sphere
	const sphereGeometry = new THREE.SphereGeometry( 0.05, 32, 32 );
	const sphereMaterial = new THREE.MeshBasicMaterial( { color: 0xffff00, opacity: 0.5, transparent: true } );
	sphereCollision = new THREE.Mesh( sphereGeometry, sphereMaterial );
	sphereCollision.visible = false;
	scene.add( sphereCollision );

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

					object.boundsTree = bvh;

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
			controls.target.z += 3;

			camera.position.copy( controls.target );
			camera.position.x += 6.5;
			camera.position.y += 2.5;
			camera.position.z += 6.5;
			controls.update();

			initialScore = calculateScore( bvhs );

		} );


	const plane = new THREE.Mesh( new THREE.PlaneGeometry(), new THREE.ShadowMaterial( { color: 0xffffff, opacity: 0.025, transparent: true } ) );
	plane.rotation.x = - Math.PI / 2;
	plane.receiveShadow = true;
	plane.scale.setScalar( 50 );
	scene.add( plane );

	gui = new GUI();
	gui.add( params, 'pause' ).onChange( v => {

		if ( animationAction ) {

			animationAction.paused = v;

		}

	} );

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

	const bvhFolder = gui.addFolder( 'bvh' );
	bvhFolder.add( params, 'bvhRaycast' );
	bvhFolder.add( params, 'autoUpdate' );
	bvhFolder.add( params, 'refit' );
	bvhFolder.open();
	gui.open();

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

	window.addEventListener( 'pointermove', function ( e ) {

		mouse.x = ( e.clientX / window.innerWidth ) * 2 - 1;
		mouse.y = - ( e.clientY / window.innerHeight ) * 2 + 1;

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

function updateRaycast() {

	if ( ! model ) {

		return;

	}

	raycaster.setFromCamera( mouse, camera );

	const startTime = window.performance.now();
	const intersects = raycaster.intersectObject( model, true );
	const hit = intersects[ 0 ];

	if ( hit ) {

		sphereCollision.position.copy( hit.point );
		sphereCollision.visible = true;

	} else {

		sphereCollision.visible = false;

	}

	const delta = window.performance.now() - startTime;
	const refitInfo = outputContainer.innerHTML;
	const lines = refitInfo.split( '\n' );
	if ( lines.length > 1 ) {

		outputContainer.innerHTML =
			lines[ 0 ] + '\n' +
			lines[ 1 ] + '\n' +
			`raycast time: ${ delta.toFixed( 2 ) } ms`;

	} else {

		outputContainer.innerHTML = `raycast time: ${ delta.toFixed( 2 ) } ms`;

	}

}

function render() {

	stats.update();

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

		refitBVH();

	}

	// update raycast
	updateRaycast();

	renderer.render( scene, camera );

}
