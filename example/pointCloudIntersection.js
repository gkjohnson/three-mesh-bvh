import Stats from 'stats.js/src/Stats';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import {
	acceleratedRaycast, computeBoundsTree, disposeBoundsTree, BVHHelper, PointsBVH,
	SAH, CENTER, AVERAGE,
} from 'three-mesh-bvh';

THREE.Points.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const plyPath = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/point-cloud-porsche/scene.ply';

const params = {
	displayBVH: false,
	displayDepth: 15,
	displayParents: false,
	strategy: CENTER,
	indirect: true,
	pointSize: 0.005,
	raycastThreshold: 0.005,
	useBVH: true,
};

let stats, scene, camera, renderer, bvhHelper, pointCloud, outputContainer;
const mouse = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;
let sphereCollision;

init();
renderer.setAnimationLoop( render );

function init() {

	const bgColor = 0x131619;

	outputContainer = document.getElementById( 'output' );

	// Renderer
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	document.body.appendChild( renderer.domElement );

	// Scene
	scene = new THREE.Scene();

	// Camera
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 100 );
	camera.position.set( 0, 2, 4 );

	new OrbitControls( camera, renderer.domElement );

	// Stats
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// Collision sphere
	sphereCollision = new THREE.Mesh(
		new THREE.SphereGeometry( 0.025, 32, 32 ),
		new THREE.MeshBasicMaterial( { color: 0xffff00, opacity: 0.9, transparent: true } )
	);
	sphereCollision.visible = false;
	scene.add( sphereCollision );

	// Load point cloud
	new PLYLoader().load( plyPath, geometry => {

		pointCloud = new THREE.Points( geometry, new THREE.PointsMaterial( {
			size: params.pointSize,
			vertexColors: true,
		} ) );

		// Center the point cloud
		geometry.computeBoundingBox();
		geometry.boundingBox.getCenter( pointCloud.position ).multiplyScalar( - 1 );
		pointCloud.position.y += 1;

		bvhHelper = new BVHHelper( pointCloud, params.displayDepth );

		scene.add( pointCloud, bvhHelper );
		updateBVH();

	} );

	// GUI
	const gui = new GUI();

	const bvhFolder = gui.addFolder( 'BVH' );
	bvhFolder.add( params, 'displayBVH' );
	bvhFolder.add( params, 'displayParents' ).onChange( v => {

		bvhHelper.displayParents = v;
		bvhHelper.update();

	} );
	bvhFolder.add( params, 'displayDepth', 1, 25, 1 ).name( 'depth' ).onChange( v => {

		bvhHelper.depth = v;
		bvhHelper.update();

	} );
	bvhFolder.open();

	const pointsFolder = gui.addFolder( 'Points' );
	pointsFolder.add( params, 'useBVH' ).onChange( updateBVH );
	pointsFolder.add( params, 'indirect' ).onChange( updateBVH );
	pointsFolder.add( params, 'strategy', { CENTER, AVERAGE, SAH } ).onChange( updateBVH );
	pointsFolder.add( params, 'pointSize', 0.001, 0.01, 0.001 );
	pointsFolder.add( params, 'raycastThreshold', 0.001, 0.01, 0.001 );
	pointsFolder.open();

	window.addEventListener( 'resize', () => {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize( window.innerWidth, window.innerHeight );
		renderer.setPixelRatio( window.devicePixelRatio );

	} );

	window.addEventListener( 'pointermove', e => {

		mouse.x = ( e.clientX / window.innerWidth ) * 2 - 1;
		mouse.y = - ( e.clientY / window.innerHeight ) * 2 + 1;

	} );

}

function updateBVH() {

	if ( params.useBVH ) {

		console.time( 'PointsBVH' );
		pointCloud.geometry.computeBoundsTree( {
			strategy: parseInt( params.strategy ),
			indirect: params.indirect,
			type: PointsBVH,
		} );
		console.timeEnd( 'PointsBVH' );

	} else {

		pointCloud.geometry.disposeBoundsTree();

	}

	bvhHelper.update();

}

function render() {

	stats.begin();

	if ( pointCloud ) {

		// Update GUI settings
		pointCloud.material.size = params.pointSize;
		raycaster.params.Points.threshold = params.raycastThreshold;
		bvhHelper.visible = params.displayBVH;

		// Perform raycast
		raycaster.setFromCamera( mouse, camera );

		const startTime = window.performance.now();
		const intersects = raycaster.intersectObject( pointCloud );
		const hit = intersects[ 0 ];

		if ( hit ) {

			sphereCollision.position.copy( hit.point );
			sphereCollision.visible = true;

		} else {

			sphereCollision.visible = false;

		}

		const delta = window.performance.now() - startTime;
		outputContainer.innerText = `${ delta.toFixed( 2 ) }ms`;

	}

	renderer.render( scene, camera );
	stats.end();

}
