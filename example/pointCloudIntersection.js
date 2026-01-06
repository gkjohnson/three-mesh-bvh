import Stats from 'stats.js/src/Stats';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import {
	acceleratedRaycast, computeBoundsTree, disposeBoundsTree, MeshBVHHelper, PointsBVH,
	SAH, CENTER, AVERAGE,
} from 'three-mesh-bvh';

THREE.Points.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

let stats;
let scene, camera, renderer, helper, pointCloud, outputContainer;
let mouse = new THREE.Vector2();
let sphereCollision;

const plyPath = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/point-cloud-porsche/scene.ply';
const raycaster = new THREE.Raycaster();
const params = {

	displayHelper: false,
	helperDepth: 10,
	displayParents: false,

	strategy: CENTER,
	indirect: true,
	pointSize: 0.005,
	raycastThreshold: 0.005,
	useBVH: true,

};

function init() {

	const bgColor = 0x263238 / 2;

	outputContainer = document.getElementById( 'output' );

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 0, 2, 4 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	new OrbitControls( camera, renderer.domElement );

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// Load point cloud
	const loader = new PLYLoader();
	loader
		.load( plyPath, geometry => {

			// create point cloud
			pointCloud = new THREE.Points( geometry, new THREE.PointsMaterial( {
				size: params.pointSize,
				vertexColors: true,
			} ) );

			// center
			geometry.computeBoundingBox();
			geometry.boundingBox.getCenter( pointCloud.position ).multiplyScalar( - 1 );
			pointCloud.position.y += 1;

			// create helper
			helper = new MeshBVHHelper( pointCloud, params.depth );

			scene.add( pointCloud, helper );

			updateBVH();

		} );

	const geometry = new THREE.SphereGeometry( 0.025, 32, 32 );
	const material = new THREE.MeshBasicMaterial( { color: 0xffff00, opacity: 0.9, transparent: true } );
	sphereCollision = new THREE.Mesh( geometry, material );
	sphereCollision.visible = false;
	scene.add( sphereCollision );

	const gui = new GUI();
	const helperFolder = gui.addFolder( 'helper' );
	helperFolder.add( params, 'displayHelper' );
	helperFolder.add( params, 'displayParents' ).onChange( v => {

		helper.displayParents = v;
		helper.update();

	} );
	helperFolder.add( params, 'helperDepth', 1, 20, 1 ).name( 'depth' ).onChange( v => {

		helper.depth = parseInt( v );
		helper.update();

	} );
	helperFolder.open();

	const pointsFolder = gui.addFolder( 'points' );
	pointsFolder.add( params, 'useBVH' ).onChange( updateBVH );
	pointsFolder.add( params, 'strategy', { CENTER, AVERAGE, SAH } ).onChange( updateBVH );
	pointsFolder.add( params, 'indirect' ).onChange( updateBVH );
	pointsFolder.add( params, 'pointSize', 0.001, 0.01, 0.001 );
	pointsFolder.add( params, 'raycastThreshold', 0.001, 0.01, 0.001 );
	pointsFolder.open();

	window.addEventListener( 'resize', onResize );
	window.addEventListener( 'pointermove', updateRaycaster );
	onResize();

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

	helper.update();

}

function updateRaycaster( e ) {

	mouse.x = ( e.clientX / window.innerWidth ) * 2 - 1;
	mouse.y = - ( e.clientY / window.innerHeight ) * 2 + 1;

}

function updateRaycast() {

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

function onResize() {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );

}

function render() {

	requestAnimationFrame( render );

	if ( pointCloud ) {

		pointCloud.material.size = params.pointSize;
		helper.visible = params.displayHelper;
		raycaster.params.Points.threshold = params.raycastThreshold;

		updateRaycast();

	}

	stats.begin();

	renderer.render( scene, camera );
	stats.end();

}

init();
render();
