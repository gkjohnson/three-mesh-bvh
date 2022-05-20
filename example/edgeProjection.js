import * as THREE from 'three';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MeshBVH, ExtendedTriangle } from '..';
import { generateEdges } from './utils/edgeUtils.js';

const params = {

};

let renderer, camera, scene, model, clock, gui, helper, group, controls;

init();
render();

function init() {

	const bgColor = 0xeeeeee;

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.outputEncoding = THREE.sRGBEncoding;
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();
	scene.fog = new THREE.Fog( 0xffca28, 20, 60 );

	const light = new THREE.DirectionalLight( 0xffffff, 1 );
	light.position.set( 1, 1, 1 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xb0bec5, 0.8 ) );

	model = new THREE.Mesh( new THREE.TorusKnotBufferGeometry() );
	scene.add( model );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	// camera = new THREE.OrthographicCamera( - 10, 10, 10, - 10 );
	camera.position.set( 0, 0, 4 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	clock = new THREE.Clock();

	controls = new OrbitControls( camera, renderer.domElement );

	gui = new GUI();

	updateEdges();

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

}

function updateEdges() {

	const edges = generateEdges( model.geometry, new THREE.Vector3( 0, 1, 0 ), 90 );
	const edgeGeom = new THREE.BufferGeometry();

	const edgeArray = [];
	edges.forEach( l => {

		edgeArray.push( l.start.x, - 2, l.start.z );
		edgeArray.push( l.end.x, - 2, l.end.z );

	} );
	const edgeBuffer = new THREE.BufferAttribute( new Float32Array( edgeArray ), 3, true );
	edgeGeom.setAttribute( 'position', edgeBuffer );
	scene.add( new THREE.LineSegments( edgeGeom, new THREE.LineBasicMaterial( { color: 0 } ) ) );

}

function render() {

	requestAnimationFrame( render );

	if ( helper ) {

		helper.visible = params.displayHelper;

	}

	renderer.render( scene, camera );

}
