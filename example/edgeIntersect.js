import Stats from 'stats.js';
import * as dat from 'dat.gui';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from '../src/index.js';
import { SeparatingAxisTriangle } from '../src/Utils/SeparatingAxisTriangle.js';
import { setTriangle } from '../src/Utils/TriangleUtils.js';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const params = {
	position: new THREE.Vector3(),
	rotation: new THREE.Euler(),
	scale: new THREE.Vector3( 1, 1, 1 ),
};

let stats;
let scene, camera, renderer, orbitControls, boundsViz, transformControls;
let mesh1, mesh2, group, line;

init();
render();

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
	// const radius = 1;
	// const tube = 0.4;
	// const tubularSegments = 400;
	// const radialSegments = 100;

	// const knotGeometry = new THREE.TorusKnotBufferGeometry( radius, tube, tubularSegments, radialSegments );
	const material = new THREE.MeshPhongMaterial( { color: 0xffffff, side: THREE.DoubleSide } );
	// targetMesh = new THREE.Mesh( knotGeometry, material );
	// targetMesh.geometry.computeBoundsTree();
	// scene.add( targetMesh );

	const tri1 = new THREE.BufferGeometry();
	tri1.setFromPoints( [
		new THREE.Vector3( 1, 0, 0 ),
		new THREE.Vector3( - 1, 0, 0 ),
		new THREE.Vector3( 0, 1, 0 ),
	] );
	tri1.computeVertexNormals();
	tri1.computeBoundsTree();

	mesh1 = new THREE.Mesh( tri1, material );
	mesh2 = new THREE.Mesh( tri1, material );
	scene.add( mesh1, mesh2 );

	const lineGeometry = new THREE.BufferGeometry();
	lineGeometry.setFromPoints( [ new THREE.Vector3( 0, 1, 0 ), new THREE.Vector3( 0, - 1, 0 ) ] );
	line = new THREE.Line( lineGeometry, new THREE.LineBasicMaterial( { color: 0xff0000, depthTest: false } ) );
	// line.visible = false;
	scene.add( line );


	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 3, 3, 3 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	transformControls = new TransformControls( camera, renderer.domElement );
	scene.add( transformControls );

	group = new THREE.Group();
	transformControls.attach( group );
	scene.add( group );

	orbitControls = new OrbitControls( camera, renderer.domElement );

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	const gui = new dat.GUI();
	gui.add( transformControls, 'mode', [ 'translate', 'rotate' ] );

	const posFolder = gui.addFolder( 'position' );
	posFolder.add( params.position, 'x' ).min( - 5 ).max( 5 ).step( 0.001 );
	posFolder.add( params.position, 'y' ).min( - 5 ).max( 5 ).step( 0.001 );
	posFolder.add( params.position, 'z' ).min( - 5 ).max( 5 ).step( 0.001 );
	posFolder.open();

	const rotFolder = gui.addFolder( 'rotation' );
	rotFolder.add( params.rotation, 'x' ).min( - Math.PI ).max( Math.PI ).step( 0.001 );
	rotFolder.add( params.rotation, 'y' ).min( - Math.PI ).max( Math.PI ).step( 0.001 );
	rotFolder.add( params.rotation, 'z' ).min( - Math.PI ).max( Math.PI ).step( 0.001 );
	rotFolder.open();

	gui.open();

	transformControls.addEventListener( 'change', function () {

		params.position.copy( mesh1.position );
		params.rotation.copy( mesh1.rotation );
		params.scale.copy( mesh1.scale );
		gui.updateDisplay();

	} );

	transformControls.addEventListener( 'mouseDown', function () {

		orbitControls.enabled = false;

	} );

	transformControls.addEventListener( 'mouseUp', function () {

		orbitControls.enabled = true;

	} );

	orbitControls.addEventListener( 'start', function () {

		transformControls.enabled = false;

	} );

	orbitControls.addEventListener( 'end', function () {

		transformControls.enabled = true;

	} );

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

	window.addEventListener( 'keydown', function ( e ) {

		switch ( e.key ) {

			case 'w':
				transformControls.mode = 'translate';
				break;
			case 'e':
				transformControls.mode = 'rotate';
				break;

		}

		gui.updateDisplay();

	} );

}

let lastTime = window.performance.now();
function render() {

	requestAnimationFrame( render );

	const delta = window.performance.now() - lastTime;
	lastTime = window.performance.now();

	// targetMesh.rotation.y += params.speed * delta * 0.001;
	// targetMesh.updateMatrixWorld();

	mesh2.position.copy( group.position );
	mesh2.rotation.copy( group.rotation );
	mesh2.scale.copy( group.scale );
	mesh2.updateMatrixWorld();

	const matrix = new THREE.Matrix4()
		.copy( mesh1.matrixWorld )
		.invert()
		.multiply( mesh2.matrixWorld );

	const results = [];
	mesh1.geometry.boundsTree.shapecast( {

		intersectsBounds: () => true,

		intersectsTriangle: tri => {

			mesh2.geometry.boundsTree.shapecast( {

				intersectsRange: ( offset, count ) => {

					const edge = new THREE.Line3();
					const tri2 = new SeparatingAxisTriangle();
					setTriangle( tri2, offset * 3, mesh2.geometry.index, mesh2.geometry.attributes.position );
					tri2.a.applyMatrix4( matrix );
					tri2.b.applyMatrix4( matrix );
					tri2.c.applyMatrix4( matrix );

					tri2.needsUpdate = true;

					if ( tri.intersectsTriangle( tri2, edge ) ) {

						console.log( 'INTERSECTED');
						results.push( edge.start, edge.end );

					}

				},

			} );

		},

	} );

	if ( results.length ) {

		// console.log( results );
		line.geometry.dispose();
		line.geometry.setFromPoints( results );
		line.visible = true;

	} else {

		line.visible = false;

	}


	if ( boundsViz ) boundsViz.update();

	renderer.render( scene, camera );

	stats.begin();
	stats.end();


}

