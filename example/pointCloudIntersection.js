import Stats from 'stats.js/src/Stats';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from '../src/index.js';
import "@babel/polyfill";

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const plyPath = "../models/point_cloud_porsche_911_1.7M_vertices/scene.ply";
const pointSize = 0.01;

let stats;
let scene, camera, renderer, bvhMesh;
let mouse = new THREE.Vector2();
let sphereCollision;

const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;
raycaster.params.Points.threshold = 0.01;

function init() {

	const bgColor = 0x263238 / 2;

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
	camera.position.set( 3, 3, 3 );
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

	// Load point cloud
	const loader = new PLYLoader();
	loader.load( plyPath, ( geometry ) => {

		geometry.center();
		const material = new THREE.PointsMaterial( { size: pointSize, vertexColors: true } );
		const pointCloud = new THREE.Points( geometry, material );
		pointCloud.matrixAutoUpdate = false;

		scene.add( pointCloud );


		// BVH Mesh creation
		const indices = [];
		const bvhGeometry = geometry.clone();
		let verticesLength = bvhGeometry.attributes.position.count;
		while ( verticesLength > 0 ) {

			let index = bvhGeometry.attributes.position.count - verticesLength;
			indices.push( index, index, index );
			verticesLength --;

		}

		bvhGeometry.setIndex( indices );
		const bvhMaterial = new THREE.MeshBasicMaterial( { color: 0xff0000 } );
		bvhMesh = new THREE.Mesh( bvhGeometry, bvhMaterial );

		bvhMesh.geometry.computeBoundsTree();

	} );


	const geometry = new THREE.SphereGeometry( 0.02, 32, 32 );
	const material = new THREE.MeshBasicMaterial( { color: 0xffff00, opacity: 0.9, transparent: true } );
	sphereCollision = new THREE.Mesh( geometry, material );
	scene.add( sphereCollision );

}

window.addEventListener( "pointermove", ( event ) => {

	if ( ! bvhMesh ) return;

	mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
	mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;

	const inverseMatrix = new THREE.Matrix4();
	inverseMatrix.copy( bvhMesh.matrixWorld ).invert();
	raycaster.setFromCamera( mouse, camera );
	raycaster.ray.applyMatrix4( inverseMatrix );

	bvhMesh.geometry.boundsTree.shapecast(
		bvhMesh,
		box => {

			box.expandByScalar( pointSize );
			return raycaster.ray.intersectsBox( box ) > 0;

		},
		triangle => {

			const distance = raycaster.ray.distanceToPoint( triangle.a );
			if ( distance < pointSize ) {

				sphereCollision.position.copy( triangle.a );

			}

		}
	);

}, false );

function render() {

	requestAnimationFrame( render );

	stats.begin();

	renderer.render( scene, camera );
	stats.end();

}


init();
render();
