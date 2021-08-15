import Stats from 'stats.js/src/Stats';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GUI } from 'dat.gui';
import {
	acceleratedRaycast, computeBoundsTree, disposeBoundsTree, MeshBVHVisualizer,
	SAH, CENTER, AVERAGE, getBVHExtremes,
} from '../src/index.js';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

let stats;
let scene, camera, renderer, helper, mesh, outputContainer;
let mouse = new THREE.Vector2();

const modelPath = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/DragonAttenuation/glTF-Binary/DragonAttenuation.glb';
const params = {

	options: {
		strategy: SAH,
		maxLeafTris: 10,
		maxDepth: 40,
		rebuild: function () {

			updateBVH();

		},
	},

};

function init() {

	outputContainer = document.getElementById( 'output' );

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( 0, 1 );
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( - 2.5, 2.5, 2.5 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	new OrbitControls( camera, renderer.domElement );

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

	// Load dragon
	const loader = new GLTFLoader();
	loader.load( modelPath, gltf => {

		gltf.scene.traverse( c => {

			if ( c.isMesh && c.name === 'Dragon' ) {

				mesh = c;

			}

		} );

		mesh.material = new THREE.MeshBasicMaterial( { color: 0 } );
		scene.add( mesh );

		helper = new MeshBVHVisualizer( mesh, 40 );
		helper.displayEdges = false;
		helper.displayParents = true;
		helper.color.set( 0xffffff );
		helper.opacity = 5 / 255;
		helper.depth = 40;
		scene.add( helper );

		updateBVH();

	} );

	const gui = new GUI();
	const bvhFolder = gui.addFolder( 'BVH' );
	bvhFolder.add( params.options, 'strategy', { CENTER, AVERAGE, SAH } );
	bvhFolder.add( params.options, 'maxLeafTris', 1, 30, 1 );
	bvhFolder.add( params.options, 'maxDepth', 1, 40, 1 );
	bvhFolder.add( params.options, 'rebuild' );
	bvhFolder.open();

}

function updateBVH() {

	mesh.geometry.computeBoundsTree( {
		strategy: parseInt( params.options.strategy ),
		maxLeafTris: params.options.maxLeafTris,
		maxDepth: params.options.maxDepth,
	} );
	helper.update();

	console.log( getBVHExtremes( mesh.geometry.boundsTree ) );

}

function render() {

	requestAnimationFrame( render );

	renderer.render( scene, camera );

}


init();
render();
