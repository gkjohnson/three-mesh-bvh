import * as THREE from 'three/build/three.module';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import * as dat from 'dat.gui';
import Stats from 'stats.js/src/Stats';
import MeshBVHVisualizer from '../src/MeshBVHVisualizer.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from '../src/index.js';
import SimplexNoise from 'simplex-noise';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const params = {

	speed: 1,
	visualizeBounds: false,
	visualBoundsDepth: 10,
	distance: 0.1,

};

let stats;
let scene, camera, renderer, controls, boundsViz;
let terrain, target;

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

	const light = new THREE.DirectionalLight( 0xffffff, 0.5 );
	light.position.set( 1, 1, 1 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xffffff, 0.4 ) );

	// geometry setup
	const size = 50;
	const dim = 250;
	const planeGeom = new THREE.PlaneBufferGeometry( size, size, dim - 1, dim - 1 );
	const posAttr = planeGeom.attributes.position;

	const noise = new SimplexNoise( Math.random() );
	for ( let i = 0; i < dim * dim; i ++ ) {

		const x = posAttr.getX( i ) / 15;
		const y = posAttr.getY( i ) / 15;
		posAttr.setZ( i, noise.noise2D( x, y ) * 2 );

	}
	planeGeom.computeVertexNormals();
	planeGeom.computeBoundsTree();

	terrain = new THREE.Mesh( planeGeom, new THREE.MeshStandardMaterial( { flatShading: true, metalness: 0.1, roughness: 0.9, side: THREE.DoubleSide } ) );
	scene.add( terrain );
	terrain.rotation.x = - Math.PI / 2;
	terrain.position.y = - 3;

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.z = 5;
	camera.far = 100;
	camera.updateProjectionMatrix();

	controls = new OrbitControls( camera, renderer.domElement );

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	const shapeMaterial = new THREE.MeshStandardMaterial( { metalness: 0.1, transparent: true, opacity: 0.75 } );
	target = new THREE.Mesh( new THREE.BoxBufferGeometry( 1, 1, 1 ), shapeMaterial );
	scene.add( target );

	const gui = new dat.GUI();
	gui.add( params, 'speed' ).min( 0 ).max( 10 );
	gui.add( params, 'visualizeBounds' ).onChange( () => updateFromOptions() );
	gui.add( params, 'visualBoundsDepth' ).min( 1 ).max( 40 ).step( 1 ).onChange( () => updateFromOptions() );
	gui.add( params, 'distance' ).min( 0 ).max( 2 ).step( 0.01 ).onChange( () => updateFromOptions() );

	const posFolder = gui.addFolder( 'position' );
	posFolder.add( target.position, 'x' ).min( - 5 ).max( 5 ).step( 0.001 );
	posFolder.add( target.position, 'y' ).min( - 5 ).max( 5 ).step( 0.001 );
	posFolder.add( target.position, 'z' ).min( - 5 ).max( 5 ).step( 0.001 );
	posFolder.open();

	const rotFolder = gui.addFolder( 'rotation' );
	rotFolder.add( target.rotation, 'x' ).min( - Math.PI ).max( Math.PI ).step( 0.001 );
	rotFolder.add( target.rotation, 'y' ).min( - Math.PI ).max( Math.PI ).step( 0.001 );
	rotFolder.add( target.rotation, 'z' ).min( - Math.PI ).max( Math.PI ).step( 0.001 );
	rotFolder.open();

	gui.open();

}

function updateFromOptions() {

	// Update bounds viz
	if ( boundsViz && ! params.visualizeBounds ) {

		scene.remove( boundsViz );
		boundsViz = null;

	}
	if ( ! boundsViz && params.visualizeBounds ) {

		boundsViz = new MeshBVHVisualizer( terrain );
		scene.add( boundsViz );

	}

	if ( boundsViz ) {

		boundsViz.depth = params.visualBoundsDepth;

	}

}

let lastTime = window.performance.now();
function render() {

	const delta = window.performance.now() - lastTime;
	lastTime = window.performance.now();

	stats.begin();

	if ( boundsViz ) boundsViz.update();

	renderer.render( scene, camera );
	stats.end();

	const transformMatrix =
		new THREE.Matrix4()
			.getInverse( terrain.matrixWorld )
			.multiply( target.matrixWorld );

	const hit = terrain.geometry.boundsTree.distancecast( terrain, target.geometry, transformMatrix, params.distance );
	target.material.color.set( hit ? 0xE91E63 : 0x666666 );
	target.material.emissive.set( 0xE91E63 ).multiplyScalar( hit ? 0.25 : 0 );

	requestAnimationFrame( render );

}


window.addEventListener( 'resize', function () {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	renderer.setSize( window.innerWidth, window.innerHeight );

}, false );

init();
updateFromOptions();


// // const sphereMesh = new THREE.Mesh( new THREE.SphereBufferGeometry( 1, 20, 20 ) );
// // scene.add( sphereMesh );

// // const sphere = new THREE.Sphere( undefined, 0.5 );
// // sphere.center.y = -0.9;
// // window.sphere = sphere;

// const boxMesh = new THREE.Mesh( new THREE.BoxBufferGeometry( 1, 1, 1 ) );
// scene.add( boxMesh );
// // boxMesh.rotation.set( Math.PI / 4, Math.PI / 4, 0 );
// // boxMesh.position.y = 1.2;

// const box = new THREE.Box3();
// box.min.set( 1, 1, 1 ).multiplyScalar( - 0.5 );
// box.max.set( 1, 1, 1 ).multiplyScalar( 0.5 );
// window.box = boxMesh;

render();
