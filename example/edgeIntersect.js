import Stats from 'stats.js';
import * as dat from 'dat.gui';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from '../src/index.js';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const params = {
	position: new THREE.Vector3(),
	rotation: new THREE.Euler(),
	scale: new THREE.Vector3( 1, 1, 1 ),
};

let stats;
let scene, camera, renderer, orbitControls, transformControls;
let mesh1, mesh2, group, lineGroup, line, bgLine;
let lastTime = window.performance.now();

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
	const radius = 1;
	const tube = 0.4;
	const tubularSegments = 40;
	const radialSegments = 10;

	const geometry = new THREE.TorusKnotBufferGeometry( radius, tube, tubularSegments, radialSegments );
	const material = new THREE.MeshPhongMaterial( {
		color: 0xffffff,
		side: THREE.DoubleSide,
		polygonOffset: true,
		polygonOffsetFactor: 1,
		polygonOffsetUnits: 1,
	} );

	// const geometry = new THREE.BoxBufferGeometry();

	// const geometry = new THREE.BufferGeometry();
	// geometry.setFromPoints( [
	// 	new THREE.Vector3( 1, 0, 0 ),
	// 	new THREE.Vector3( - 1, 0, 0 ),
	// 	new THREE.Vector3( 0, 1, 0 ),
	// ] );
	// geometry.computeVertexNormals();
	geometry.computeBoundsTree();

	mesh1 = new THREE.Mesh( geometry, material );
	mesh2 = new THREE.Mesh( geometry, material );
	scene.add( mesh1, mesh2 );

	const lineGeometry = new THREE.BufferGeometry();
	lineGeometry.setFromPoints( [ new THREE.Vector3( 0, 1, 0 ), new THREE.Vector3( 0, - 1, 0 ) ] );
	line = new THREE.LineSegments( lineGeometry, new THREE.LineBasicMaterial( { color: 0xff0000 } ) );

	bgLine = line.clone();
	bgLine.material = new THREE.LineBasicMaterial( { color: 0xff0000, transparent: true, opacity: 0.25, depthTest: false } );

	lineGroup = new THREE.Group();
	lineGroup.add( line, bgLine );
	scene.add( lineGroup );

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

function render() {

	requestAnimationFrame( render );

	const delta = window.performance.now() - lastTime;
	lastTime = window.performance.now();

	// targetMesh.rotation.y += params.speed * delta * 0.001;
	// targetMesh.updateMatrixWorld();

	// mesh2.position.copy( group.position );
	// mesh2.rotation.copy( group.rotation );
	// mesh2.scale.copy( group.scale );
	mesh2.rotation.x += delta * 0.0001;
	mesh2.rotation.y += delta * 2 * 0.0001;
	mesh2.rotation.z += delta * 3 * 0.0001;

	mesh1.updateMatrixWorld();
	mesh2.updateMatrixWorld();

	const matrix2to1 = new THREE.Matrix4()
		.copy( mesh1.matrixWorld )
		.invert()
		.multiply( mesh2.matrixWorld );
	// const matrix1to2 = matrix2to1.clone().invert();

	const results = [];
	mesh1.geometry.boundsTree.shapecast( {

		intersectsBounds: ( /* box */ ) => {

			return true;

		},

		intersectsTriangle: tri => {

			mesh2.geometry.boundsTree.shapecast( {

				intersectsBounds: ( /* box2 */ ) => {

					return true;

				},

				intersectsTriangle: tri2 => {

					const edge = new THREE.Line3();
					tri2.a.applyMatrix4( matrix2to1 );
					tri2.b.applyMatrix4( matrix2to1 );
					tri2.c.applyMatrix4( matrix2to1 );

					tri2.needsUpdate = true;

					if ( tri.intersectsTriangle( tri2, edge ) ) {

						const { start, end } = edge;
						results.push(
							start.x,
							start.y,
							start.z,
							end.x,
							end.y,
							end.z,
						);

					}

				},

			} );

		},

	} );

	if ( results.length ) {

		const geometry = line.geometry;
		const posArray = geometry.attributes.position.array;
		if ( posArray.length < results.length ) {

			geometry.dispose();
			geometry.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( results ), 3, false ) );

		} else {

			posArray.set( results );

		}

		geometry.setDrawRange( 0, results.length / 3 );
		geometry.attributes.position.needsUpdate = true;
		lineGroup.position.copy( mesh1.position );
		lineGroup.rotation.copy( mesh1.rotation );
		lineGroup.scale.copy( mesh1.scale );
		line.visible = true;

	} else {

		line.visible = false;

	}

	renderer.render( scene, camera );

	stats.begin();
	stats.end();


}

