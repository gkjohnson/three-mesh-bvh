import Stats from 'stats.js';
import * as dat from 'three/examples/jsm/libs/lil-gui.module.min.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ExtendedTriangle } from '../src/index.js';


const params = {
	sphereSize: 1
};

const t1 = new ExtendedTriangle();
const t2 = new ExtendedTriangle();
t1.a.set( - 1, 0, 0 );
t1.b.set( 2, 0, - 2 );
t1.c.set( 2, 0, 2 );
t2.a.set( 1, 0, 0 );
t2.b.set( - 2, - 2, 0 );
t2.c.set( - 2, 2, 0 );

t1.needsUpdate = true;
t2.needsUpdate = true;

let stats;
let scene, camera, renderer, orbitControls;
let trispheres = [];
let interSpheres = [];
let intersectionMesh;
let line = new THREE.Line3();
let t1Mesh, t2Mesh;
let gui;

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
	scene.fog = new THREE.Fog( 0x263238 / 2, 20, 60 );

	const light = new THREE.DirectionalLight( 0xffffff, 0.3 );
	light.position.set( 10, 10, 10 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xffffff, 0.8 ) );


	const interMaterial = new THREE.MeshPhongMaterial( { color: 0xff0000, side: THREE.DoubleSide } );
	const t1Material = new THREE.MeshPhongMaterial( { color: 0x0000ff, side: THREE.DoubleSide } );
	const t2Material = new THREE.MeshPhongMaterial( { color: 0x00ff00, side: THREE.DoubleSide } );


	const sphereGeometry = new THREE.SphereGeometry( 1 );

	for ( let i = 0; i < 2; i ++ ) {

		const s = new THREE.Mesh( sphereGeometry, interMaterial );
		interSpheres.push( s );
		scene.add( s );

	}

	for ( let i = 0; i < 3; i ++ ) {

		const s = new THREE.Mesh( sphereGeometry, t1Material );
		trispheres.push( s );
		scene.add( s );

	}

	for ( let i = 0; i < 3; i ++ ) {

		const s = new THREE.Mesh( sphereGeometry, t2Material );
		trispheres.push( s );
		scene.add( s );

	}


	const cylinderGeometry = new THREE.CylinderGeometry();
	intersectionMesh = new THREE.Mesh( cylinderGeometry, interMaterial );
	scene.add( intersectionMesh );

	const triangleGeometry = new THREE.BufferGeometry();
	triangleGeometry.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( [ 1, 1, 1, 2, 2, 2, 3, 3, 3 ] ), 3 ) );

	t1Mesh = new THREE.Mesh( triangleGeometry.clone(), t1Material );
	scene.add( t1Mesh );

	t2Mesh = new THREE.Mesh( triangleGeometry.clone(), t2Material );
	scene.add( t2Mesh );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 10, 10, 10 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	orbitControls = new OrbitControls( camera, renderer.domElement );

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	orbitControls.addEventListener( 'change', function () {

		render();

	} );


	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );
		render();

	}, false );

}

function initGUI() {

	gui = new dat.GUI();

	gui.add( params, 'sphereSize', 0, 5, 0.001 ).onChange( render );


	// Sphere positions
	const trinames = [ 'a1', 'b1', 'c1', 'a2', 'b2', 'c2' ];
	const triPos = [ t1.a, t1.b, t1.c, t2.a, t2.b, t2.c ];

	for ( let i = 0; i < 6; i ++ ) {

		const folder = gui.addFolder( trinames[ i ] );
		folder.add( triPos[ i ], 'x' ).min( - 10 ).max( 10 ).step( 0.001 ).onChange( render );
		folder.add( triPos[ i ], 'y' ).min( - 10 ).max( 10 ).step( 0.001 ).onChange( render );
		folder.add( triPos[ i ], 'z' ).min( - 10 ).max( 10 ).step( 0.001 ).onChange( render );
		folder.open();

	}

	// Intersection Position
	const internames = [ 'Inter1', 'Inter2' ];
	const interPos = [ line.start, line.end ];

	for ( let i = 0; i < 2; i ++ ) {

		const folder = gui.addFolder( internames[ i ] );
		folder.add( interPos[ i ], 'x' ).step( 0.001 );
		folder.add( interPos[ i ], 'y' ).step( 0.001 );
		folder.add( interPos[ i ], 'z' ).step( 0.001 );
		folder.open();

	}

	gui.open();

}

function updateIntersectionMesh( mesh, line ) {

	mesh.geometry.dispose();

	// edge from X to Y
	const direction = new THREE.Vector3().subVectors( line.start, line.end );
	mesh.geometry = new THREE.CylinderGeometry( 1, 1, direction.length(), 6, 4, true );
	mesh.geometry.applyMatrix4( new THREE.Matrix4().makeTranslation( 0, direction.length() / 2, 0 ) );
	mesh.geometry.applyMatrix4( new THREE.Matrix4().makeRotationX( THREE.MathUtils.degToRad( 90 ) ) );
	mesh.geometry.computeVertexNormals();
	mesh.position.copy( line.start );
	mesh.lookAt( line.end );

}

function updateSpheres() {

	trispheres[ 0 ].position.copy( t1.a );
	trispheres[ 1 ].position.copy( t1.b );
	trispheres[ 2 ].position.copy( t1.c );
	trispheres[ 3 ].position.copy( t2.a );
	trispheres[ 4 ].position.copy( t2.b );
	trispheres[ 5 ].position.copy( t2.c );
	interSpheres[ 0 ].position.copy( line.start );
	interSpheres[ 1 ].position.copy( line.end );

}


function updateTrianglesGeometry() {

	const buff1 = t1Mesh.geometry.getAttribute( 'position' );
	buff1.setXYZ( 0, t1.a.x, t1.a.y, t1.a.z );
	buff1.setXYZ( 1, t1.b.x, t1.b.y, t1.b.z );
	buff1.setXYZ( 2, t1.c.x, t1.c.y, t1.c.z );
	buff1.needsUpdate = true;
	t1Mesh.geometry.computeVertexNormals();

	const buff2 = t2Mesh.geometry.getAttribute( 'position' );
	buff2.setXYZ( 0, t2.a.x, t2.a.y, t2.a.z );
	buff2.setXYZ( 1, t2.b.x, t2.b.y, t2.b.z );
	buff2.setXYZ( 2, t2.c.x, t2.c.y, t2.c.z );
	buff2.needsUpdate = true;
	t2Mesh.geometry.computeVertexNormals();

}

function render() {

	stats.begin();

	// Hide and show intersection meshes
	intersectionMesh.visible = false;
	interSpheres[ 0 ].visible = false;
	interSpheres[ 1 ].visible = false;

	t1.update();
	t2.update();
	if ( t1.intersectsTriangle( t2, line ) ) {

		updateIntersectionMesh( intersectionMesh, line );
		intersectionMesh.visible = true;
		interSpheres[ 0 ].visible = true;
		interSpheres[ 1 ].visible = true;

	} else {

		line.start.set( Infinity, Infinity, Infinity );
		line.end.set( Infinity, Infinity, Infinity );

	}

	updateSpheres();
	updateTrianglesGeometry();

	// Update sphere scale
	const spheres = [ ... trispheres, ... interSpheres ];
	spheres.forEach( sphere => {

		sphere.scale.setScalar( 0.005 * params.sphereSize * sphere.position.distanceTo( camera.position ) );

	} );
	interSpheres.forEach( s => s.scale.multiplyScalar( 1.5 ) );

	intersectionMesh.scale.setScalar(
		0.5 * Math.min( interSpheres[ 0 ].scale.x, interSpheres[ 1 ].scale.x ),
	);
	intersectionMesh.scale.z = 1;

	gui.controllersRecursive().forEach( c => c.updateDisplay() );

	renderer.render( scene, camera );
	stats.end();

}


init();
initGUI();
render();
