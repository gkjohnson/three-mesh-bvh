import Stats from 'stats.js';
import * as dat from 'dat.gui';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from '../src/index.js';
import { SeparatingAxisTriangle } from '../src/math/SeparatingAxisTriangle.js';
import { OrientedBox } from '../src/math/OrientedBox.js';
import { setTriangle } from '../src/utils/TriangleUtilities.js';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const params = {
	position: new THREE.Vector3(),
	rotation: new THREE.Euler(),
	scale: new THREE.Vector3( 1, 1, 1 ),
	speed: 1,
	displayMeshes: false,
};

let stats;
let scene, camera, renderer, orbitControls, transformControls;
let mesh1, mesh2, group, lineGroup, line, bgLine;
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

	const geometry = new THREE.TorusKnotBufferGeometry( radius, tube, tubularSegments, radialSegments );
	const material = new THREE.MeshPhongMaterial( {
		color: 0xffffff,
		side: THREE.DoubleSide,
		shininess: 0.01,
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
	geometry.computeBoundsTree( { maxLeafTris: 1 } );

	mesh1 = new THREE.Mesh( geometry, material );
	mesh2 = new THREE.Mesh( geometry, material );
	scene.add( mesh1, mesh2 );

	const lineGeometry = new THREE.BufferGeometry();
	lineGeometry.setFromPoints( [ new THREE.Vector3( 0, 1, 0 ), new THREE.Vector3( 0, - 1, 0 ) ] );
	line = new THREE.LineSegments( lineGeometry, new THREE.LineBasicMaterial( { color: 0xE91E63 } ) );

	bgLine = line.clone();
	bgLine.material = new THREE.LineBasicMaterial( { color: 0xE91E63, transparent: true, opacity: 0.25, depthTest: false } );

	lineGroup = new THREE.Group();
	lineGroup.add( line, bgLine );
	scene.add( lineGroup );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 2, 2, 2 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	transformControls = new TransformControls( camera, renderer.domElement );
	scene.add( transformControls );

	group = new THREE.Group();
	group.position.y = 1.1;
	mesh1.position.y = - 1.1;
	transformControls.attach( group );
	scene.add( group );
	transformControls.visible = false;

	orbitControls = new OrbitControls( camera, renderer.domElement );

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	const gui = new dat.GUI();
	gui.add( params, 'speed', 0, 10, 0.001 );
	gui.add( params, 'displayMeshes' );
	gui.add( transformControls, 'visible' ).name( 'displayControls' );
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

	mesh2.position.copy( group.position );
	// mesh2.rotation.copy( group.rotation );
	// mesh2.scale.copy( group.scale );

	mesh1.rotation.x -= delta * 0.0001 * params.speed * 0.5;
	mesh1.rotation.y -= delta * 2 * 0.0001 * params.speed * 0.5;
	mesh1.rotation.z -= delta * 3 * 0.0001 * params.speed * 0.5;

	mesh2.rotation.x += delta * 0.0001 * params.speed;
	mesh2.rotation.y += delta * 2 * 0.0001 * params.speed;
	mesh2.rotation.z += delta * 3 * 0.0001 * params.speed;


	mesh1.updateMatrixWorld();
	mesh2.updateMatrixWorld();

	const matrix2to1 = new THREE.Matrix4()
		.copy( mesh1.matrixWorld )
		.invert()
		.multiply( mesh2.matrixWorld );
	const matrix1to2 = matrix2to1.clone().invert();

	const orientedBounds2 = new OrientedBox();
	mesh2.geometry.boundsTree.getBoundingBox( orientedBounds2 );
	orientedBounds2.matrix.copy( matrix2to1 );
	orientedBounds2.needsUpdate = true;

	const orientedBounds1 = new OrientedBox();
	orientedBounds1.matrix.copy( matrix1to2 );

	const triangle1 = new SeparatingAxisTriangle();
	const triangle2 = new SeparatingAxisTriangle();
	const edge = new THREE.Line3();

	const results = [];
	mesh1.geometry.boundsTree.shapecast( {

		intersectsBounds: box => {

			return orientedBounds2.intersectsBox( box );

		},

		intersectsRange: ( offset1, count1, contained, depth, nodeIndex, box ) => {

			orientedBounds1.min.copy( box.min );
			orientedBounds1.max.copy( box.max );
			orientedBounds1.needsUpdate = true;

			mesh2.geometry.boundsTree.shapecast( {

				intersectsBounds: box2 => {

					return orientedBounds1.intersectsBox( box2 );

				},

				intersectsRange: ( offset2, count2 ) => {

					const geometry1 = mesh1.geometry;
					const geometry2 = mesh2.geometry;

					for ( let i2 = offset2 * 3, l2 = ( offset2 + count2 ) * 3; i2 < l2; i2 += 3 ) {

						setTriangle( triangle2, i2, geometry2.index, geometry2.attributes.position );
						triangle2.a.applyMatrix4( matrix2to1 );
						triangle2.b.applyMatrix4( matrix2to1 );
						triangle2.c.applyMatrix4( matrix2to1 );
						triangle2.needsUpdate = true;

						for ( let i1 = offset1 * 3, l1 = ( offset1 + count1 ) * 3; i1 < l1; i1 += 3 ) {

							setTriangle( triangle1, i1, geometry1.index, geometry1.attributes.position );
							triangle1.needsUpdate = true;

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
		lineGroup.visible = true;

	} else {

		lineGroup.visible = false;

	}

	mesh1.visible = params.displayMeshes;
	mesh2.visible = params.displayMeshes;
	transformControls.enabled = transformControls.visible;
	renderer.render( scene, camera );

	stats.begin();
	stats.end();

}

