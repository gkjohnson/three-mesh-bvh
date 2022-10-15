import Stats from 'stats.js';
import * as dat from 'three/examples/jsm/libs/lil-gui.module.min.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, SAH } from '..';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const params = {
	position: new THREE.Vector3(),
	rotation: new THREE.Euler(),
	scale: new THREE.Vector3( 1, 1, 1 ),
	speed: 1,
	displayMeshes: false,
	distance: 1.1,
};

let stats;
let scene, camera, renderer, orbitControls;
let mesh1, mesh2, lineGroup, line, bgLine;
let depth1, depth2, group1, group2;
let lastTime = window.performance.now();

init();
render();

function init() {

	const bgColor = 0x66093a;

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.outputEncoding = THREE.sRGBEncoding;
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
	const tubularSegments = 100;
	const radialSegments = 40;

	const geometry = new THREE.TorusKnotGeometry( radius, tube, tubularSegments, radialSegments );
	const material = new THREE.MeshPhongMaterial( {
		color: 0xffffff,
		side: THREE.DoubleSide,
		shininess: 0.01,
		polygonOffset: true,
		polygonOffsetFactor: 1,
		polygonOffsetUnits: 1,
		opacity: 0.5,
		blending: THREE.CustomBlending
	} );
	const depthMaterial = new THREE.MeshBasicMaterial( {
		polygonOffset: true,
		polygonOffsetFactor: 1,
		polygonOffsetUnits: 1,
		colorWrite: false,
	} );

	// const geometry = new THREE.BoxGeometry();

	// const geometry = new THREE.BufferGeometry();
	// geometry.setFromPoints( [
	// 	new THREE.Vector3( 1, 0, 0 ),
	// 	new THREE.Vector3( - 1, 0, 0 ),
	// 	new THREE.Vector3( 0, 1, 0 ),
	// ] );
	// geometry.computeVertexNormals();
	geometry.computeBoundsTree( { maxLeafTris: 1, strategy: SAH } );

	group1 = new THREE.Group();
	mesh1 = new THREE.Mesh( geometry, material );
	mesh1.renderOrder = 2;
	depth1 = new THREE.Mesh( geometry, depthMaterial );
	depth1.renderOrder = 1;
	group1.add( depth1, mesh1 );

	group2 = new THREE.Group();
	mesh2 = new THREE.Mesh( geometry, material );
	mesh2.renderOrder = 2;
	depth2 = new THREE.Mesh( geometry, depthMaterial );
	depth2.renderOrder = 1;
	group2.add( depth2, mesh2 );

	scene.add( group1, group2 );

	const lineGeometry = new THREE.BufferGeometry();
	lineGeometry.setFromPoints( [ new THREE.Vector3( 0, 1, 0 ), new THREE.Vector3( 0, - 1, 0 ) ] );
	line = new THREE.LineSegments( lineGeometry, new THREE.LineBasicMaterial( { color: 0xE91E63 } ) );

	bgLine = line.clone();
	bgLine.material = new THREE.LineBasicMaterial( {
		color: 0xE91E63,
		transparent: true,
		opacity: 0.25,
		depthFunc: THREE.GreaterDepth,
	} );
	bgLine.renderOrder = 3;

	lineGroup = new THREE.Group();
	lineGroup.add( line, bgLine );
	scene.add( lineGroup );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 2, 2, 2 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	orbitControls = new OrbitControls( camera, renderer.domElement );

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	const gui = new dat.GUI();
	gui.add( params, 'speed', 0, 10, 0.001 );
	gui.add( params, 'distance', 0, 1.5, 0.001 );
	gui.add( params, 'displayMeshes' );

	gui.open();

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

}

function render() {

	requestAnimationFrame( render );

	const delta = window.performance.now() - lastTime;
	lastTime = window.performance.now();

	group1.position.y = - params.distance;
	group1.rotation.x -= delta * 3 * 0.0001 * params.speed * 0.5;
	group1.rotation.y -= delta * 1 * 0.0001 * params.speed * 0.5;
	group1.rotation.z -= delta * 2 * 0.0001 * params.speed * 0.5;

	group2.position.y = params.distance;
	group2.rotation.x += delta * 0.0001 * params.speed;
	group2.rotation.y += delta * 2 * 0.0001 * params.speed;
	group2.rotation.z += delta * 3 * 0.0001 * params.speed;

	scene.updateMatrixWorld( true );

	const matrix2to1 = new THREE.Matrix4()
		.copy( mesh1.matrixWorld )
		.invert()
		.multiply( mesh2.matrixWorld );


	const edge = new THREE.Line3();
	const results = [];
	mesh1.geometry.boundsTree.bvhcast( mesh2.geometry.boundsTree, matrix2to1, {

		intersectsTriangles( triangle1, triangle2 ) {

			if ( triangle1.intersectsTriangle( triangle2, edge ) ) {

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

		}

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
		lineGroup.position.copy( group1.position );
		lineGroup.rotation.copy( group1.rotation );
		lineGroup.scale.copy( group1.scale );
		lineGroup.visible = true;

	} else {

		lineGroup.visible = false;

	}

	group1.visible = params.displayMeshes;
	group2.visible = params.displayMeshes;
	renderer.render( scene, camera );

	stats.begin();
	stats.end();

}

