import * as THREE from '../node_modules/three/build/three.module.js';
import { OrbitControls } from '../node_modules/three/examples/jsm/controls/OrbitControls.js';
import * as dat from 'dat.gui';
import Stats from '../node_modules/stats.js/src/Stats.js';
import MeshBVHVisualizer from '../src/MeshBVHVisualizer.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from '../src/index.js';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const bgColor = 0x263238 / 2;

// renderer setup
const renderer = new THREE.WebGLRenderer( { antialias: true } );
renderer.setPixelRatio( window.devicePixelRatio );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setClearColor( bgColor, 1 );
document.body.appendChild( renderer.domElement );

// scene setup
const scene = new THREE.Scene();
scene.fog = new THREE.Fog( 0x263238 / 2, 20, 60 );

const light = new THREE.DirectionalLight( 0xffffff, 0.5 );
light.position.set( 1, 1, 1 );
scene.add( light );
scene.add( new THREE.AmbientLight( 0xffffff, 0.4 ) );

// geometry setup
const radius = 1;
const tube = 0.4;
const tubularSegments = 40;
const radialSegments = 10;

let boundsViz = null;
// const knotGeometry = new THREE.BoxBufferGeometry( 1, 1, 1, 1, 1, 1 );
const knotGeometry = new THREE.TorusKnotBufferGeometry( radius, tube, tubularSegments, radialSegments );
const material = new THREE.MeshPhongMaterial( { color: 0xE91E63, side: THREE.DoubleSide } );
const mesh = new THREE.Mesh( knotGeometry, material );
mesh.geometry.computeBoundsTree();
scene.add( mesh );
window.mesh = mesh;

// camera setup
const camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
camera.position.z = 5;
camera.far = 100;
camera.updateProjectionMatrix();

const controls = new OrbitControls( camera, renderer.domElement );

// stats setup
const stats = new Stats();
document.body.appendChild( stats.dom );

const options = {
	mesh: {
		visualizeBounds: false,
		visualBoundsDepth: 10
	}
};

const updateFromOptions = () => {

	// Update bounds viz
	if ( boundsViz && ! options.mesh.visualizeBounds ) {

		scene.remove( boundsViz );
		boundsViz = null;

	}
	if ( ! boundsViz && options.mesh.visualizeBounds ) {

		boundsViz = new MeshBVHVisualizer( mesh );
		scene.add( boundsViz );

	}

	if ( boundsViz ) boundsViz.depth = options.mesh.visualBoundsDepth;

};

// const sphereMesh = new THREE.Mesh( new THREE.SphereBufferGeometry( 1, 20, 20 ) );
// scene.add( sphereMesh );

// const sphere = new THREE.Sphere( undefined, 0.5 );
// sphere.center.y = -0.9;
// window.sphere = sphere;

const boxMesh = new THREE.Mesh( new THREE.BoxBufferGeometry( 1, 1, 1 ) );
scene.add( boxMesh );

const box = new THREE.Box3();
box.min.set( 1, 1, 1 ).multiplyScalar( - 0.5 );
box.max.set( 1, 1, 1 ).multiplyScalar( 0.5 );
window.box = boxMesh;


const render = () => {

	stats.begin();

	if ( boundsViz ) boundsViz.update();

	renderer.render( scene, camera );
	stats.end();

	// perform sphere cast
	// console.log( mesh.geometry.boundsTree.spherecast( mesh, sphere ) );
	// sphereMesh.position.copy( sphere.center );
	// sphereMesh.scale.set( sphere.radius, sphere.radius, sphere.radius );

	// perform box cast
	const wMat = new THREE.Matrix4().compose( boxMesh.position, boxMesh.quaternion, new THREE.Vector3( 1, 1, 1 ) );
	const mat = new THREE.Matrix4();
	mat.getInverse( wMat );

	console.log( mesh.geometry.boundsTree.boxcast( mesh, box, mat ) );
	box.min.copy( boxMesh.scale ).multiplyScalar( - 0.5 );
	box.max.copy( boxMesh.scale ).multiplyScalar( 0.5 );

	requestAnimationFrame( render );

};

window.planeHelpers = new Array( 6 ).fill().map( () => new THREE.PlaneHelper( new THREE.Plane(), 2, 0xff0000 ) );
window.planeHelpers.forEach( p => scene.add( p ) )
scene.add( window.planeHelpers );

// Run
const gui = new dat.GUI();

const meshfolder = gui.addFolder( 'Mesh' );
meshfolder.add( options.mesh, 'visualizeBounds' ).onChange( () => updateFromOptions() );
meshfolder.add( options.mesh, 'visualBoundsDepth' ).min( 1 ).max( 40 ).step( 1 ).onChange( () => updateFromOptions() );
meshfolder.open();

window.addEventListener( 'resize', function () {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	renderer.setSize( window.innerWidth, window.innerHeight );

}, false );

updateFromOptions();
render();
