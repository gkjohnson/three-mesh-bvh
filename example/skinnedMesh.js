import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import Stats from 'stats.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { computeBoundsTree, MeshBVHVisualizer, getBVHExtremes, StaticGeometryGenerator } from '..';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;

const params = {
	display: true,
	displayOriginal: true,
	material: 'wireframe',
	updatePositionOnly: false,

	skeletonHelper: false,
	bvhHelper: true,
	bvhHelperDepth: 10,

	autoUpdate: true,
	updateRate: 2.5,
	pause: false,
	regenerate: () => {

		regenerateMesh();

	}
};

let renderer, camera, scene, clock, gui, stats;
let outputContainer;
let controls, mixer, animationAction, model;
let bvhHelper, skeletonHelper, meshHelper, staticGeometryGenerator;
let timeSinceUpdate = 0;
let initialExtremes = null;
let wireframeMaterial, normalMaterials, originalMaterials;

init();
render();

// TODO: afford use of materials on the final model to validate

function init() {

	const bgColor = 0x111111;

	outputContainer = document.getElementById( 'output' );

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	renderer.outputEncoding = THREE.sRGBEncoding;
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();

	const light = new THREE.DirectionalLight( 0xffffff, 1 );
	light.position.set( 5, 5, 2.5 );
	light.shadow.mapSize.setScalar( 1024 );
	light.shadow.normalBias = 1e-2;
	light.castShadow = true;

	const shadowCam = light.shadow.camera;
	shadowCam.left = shadowCam.bottom = - 7.5;
	shadowCam.right = shadowCam.top = 7.5;
	shadowCam.updateProjectionMatrix();
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xb0bec5, 0.8 ) );

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
	new GLTFLoader().load( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/trex/scene.gltf', gltf => {

		// prep the model and add it to the scene
		model = gltf.scene;
		model.traverse( object => {

			if ( object.isMesh ) {

				object.castShadow = true;
				object.receiveShadow = true;
				object.frustumCulled = false;

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

		// prep the geometry
		staticGeometryGenerator = new StaticGeometryGenerator( model );
		originalMaterials = staticGeometryGenerator.getMaterials();

		normalMaterials = originalMaterials.map( m => {

			return new THREE.MeshNormalMaterial( {
				normalMap: m.normalMap
			} );

		} );

		wireframeMaterial = new THREE.MeshBasicMaterial( {
			wireframe: true,
			transparent: true,
			opacity: 0.05,
			depthWrite: false,
		} );
		meshHelper = new THREE.Mesh( new THREE.BufferGeometry(), wireframeMaterial );
		meshHelper.receiveShadow = true;

		scene.add( meshHelper );

		bvhHelper = new MeshBVHVisualizer( meshHelper, 10 );
		scene.add( bvhHelper );

		regenerateMesh();

	} );


	const plane = new THREE.Mesh( new THREE.PlaneBufferGeometry(), new THREE.ShadowMaterial( { color: 0xffffff, opacity: 0.025, transparent: true } ) );
	plane.rotation.x = - Math.PI / 2;
	plane.receiveShadow = true;
	plane.scale.setScalar( 50 );
	scene.add( plane );

	gui = new GUI();
	const staticFolder = gui.addFolder( 'static mesh' );
	staticFolder.add( params, 'display' );
	staticFolder.add( params, 'displayOriginal' );
	staticFolder.add( params, 'material', [ 'wireframe', 'normal', 'original' ] ).onChange( v => {

		if ( ! meshHelper ) {

			return;

		}

		switch ( v ) {

			case 'wireframe':
				meshHelper.material = wireframeMaterial;
				meshHelper.castShadow = false;
				break;
			case 'normal':
				meshHelper.material = normalMaterials;
				meshHelper.castShadow = true;
				break;
			case 'original':
				meshHelper.material = originalMaterials;
				meshHelper.castShadow = true;
				break;

		}

	} );
	staticFolder.add( params, 'updatePositionOnly' ).onChange( v => {

		staticGeometryGenerator.attributes = v ? [ 'position' ] : [ 'position', 'normal', 'tangent', 'uv', 'uv2' ];

		// TODO: if we don't dispose and create a new geometry then it seems like the performance gets slower with the
		// original meshes??
		const geometry = meshHelper.geometry;
		geometry.dispose();
		for ( const key in geometry.attributes ) {

			geometry.deleteAttribute( key );

		}

	} );
	staticFolder.open();

	const helperFolder = gui.addFolder( 'helpers' );
	helperFolder.add( params, 'skeletonHelper' );
	helperFolder.add( params, 'bvhHelper' );
	helperFolder.add( params, 'bvhHelperDepth', 1, 20, 1 ).onChange( v => {

		bvhHelper.depth = parseInt( v );
		bvhHelper.update();

	} );
	helperFolder.open();

	const bvhFolder = gui.addFolder( 'bvh animation' );
	bvhFolder.add( params, 'autoUpdate' );
	bvhFolder.add( params, 'updateRate', 0, 5, 0.001 );
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

// regenerate the mesh and bvh
function regenerateMesh() {

	if ( meshHelper ) {

		let generateTime, refitTime, startTime;

		// time the geometry generation
		startTime = window.performance.now();
		staticGeometryGenerator.generate( meshHelper.geometry );
		generateTime = window.performance.now() - startTime;

		// time the bvh refitting
		startTime = window.performance.now();
		if ( ! meshHelper.geometry.boundsTree ) {

			meshHelper.geometry.computeBoundsTree();
			refitTime = '-';

		} else {

			meshHelper.geometry.boundsTree.refit();
			refitTime = ( window.performance.now() - startTime ).toFixed( 2 );

		}

		bvhHelper.update();
		timeSinceUpdate = 0;

		const extremes = getBVHExtremes( meshHelper.geometry.boundsTree );
		if ( initialExtremes === null ) {

			initialExtremes = extremes;

		}

		let score = 0;
		let initialScore = 0;
		for ( const i in extremes ) {

			score += extremes[ i ].surfaceAreaScore;
			initialScore += initialExtremes[ i ].surfaceAreaScore;

		}

		const degradation = ( score / initialScore ) - 1.0;

		// update time display
		outputContainer.innerHTML =
			`mesh generation time: ${ generateTime.toFixed( 2 ) } ms\n` +
			`refit time: ${ refitTime } ms\n` +
			`bvh degradation: ${ ( 100 * degradation ).toFixed( 2 ) }%`;

	}

}

function render() {

	stats.update();
	requestAnimationFrame( render );

	const delta = Math.min( clock.getDelta(), 30 * 0.001 );

	// update animation and helpers
	if ( mixer ) {

		mixer.update( delta );
		skeletonHelper.visible = params.skeletonHelper;
		meshHelper.visible = params.display;
		bvhHelper.visible = params.bvhHelper;
		model.visible = params.displayOriginal;

	}

	scene.updateMatrixWorld( true );

	// refit on a cycle
	if ( params.autoUpdate && ! params.pause ) {

		if ( timeSinceUpdate > params.updateRate ) {

			regenerateMesh();

		}

		timeSinceUpdate += delta;

	} else {

		timeSinceUpdate = 0;

	}

	renderer.render( scene, camera );

}
