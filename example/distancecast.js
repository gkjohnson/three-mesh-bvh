import * as THREE from 'three/build/three.module';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { TransformControls } from './lib/TransformControls.js';
import { MarchingCubes } from './lib/MarchingCubes.js';
import * as dat from 'dat.gui';
import Stats from 'stats.js/src/Stats';
import MeshBVHVisualizer from '../src/MeshBVHVisualizer.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from '../src/index.js';
import SimplexNoise from 'simplex-noise';
import "@babel/polyfill";

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const params = {

	speed: 1,
	visualizeBounds: false,
	visualBoundsDepth: 10,
	distance: 1,

};

let stats;
let scene, camera, renderer, controls, boundsViz;
let terrain, target, transformControls;
let marchingCubes, marchingCubesMesh;

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


	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	const shapeMaterial = new THREE.MeshStandardMaterial( { metalness: 0.1, transparent: true, opacity: 0.75 } );
	target = new THREE.Mesh( new THREE.BoxBufferGeometry( 1, 1, 1 ), shapeMaterial );
	scene.add( target );

	controls = new OrbitControls( camera, renderer.domElement );
	transformControls = new TransformControls( camera, renderer.domElement );
	transformControls.attach( target );
	transformControls.addEventListener( 'dragging-changed', e => controls.enabled = ! e.value );
	transformControls.addEventListener( 'changed', e => controls.enabled = ! e.value );
	scene.add( transformControls );

	const cubeMat = new THREE.MeshStandardMaterial( { color: 0xff0000, side: THREE.DoubleSide, metalness: 0.1, glossiness: 0.75 } );
	marchingCubes = new MarchingCubes( 50, cubeMat, false, false );
	marchingCubes.isolation = 0;

	const boundsMesh = new THREE.Mesh( new THREE.BoxBufferGeometry( 2, 2, 2 ), new THREE.MeshStandardMaterial( { transparent: true, opacity: 0.25 } ) );
	boundsMesh.visible = false;

	const container = new THREE.Group();
	container.add( marchingCubes );
	container.add( boundsMesh );
	scene.add( container );
	container.scale.multiplyScalar( 5 );
	window.marchingCubes = marchingCubes;

	scene.updateMatrixWorld( true );

	const gui = new dat.GUI();
	gui.add( params, 'speed' ).min( 0 ).max( 10 );
	gui.add( params, 'visualizeBounds' ).onChange( () => updateFromOptions() );
	gui.add( params, 'visualBoundsDepth' ).min( 1 ).max( 40 ).step( 1 ).onChange( () => updateFromOptions() );
	gui.add( params, 'distance' ).min( 0 ).max( 2 ).step( 0.01 ).onChange( () => updateFromOptions() );
	gui.add( transformControls, 'mode', [ 'translate', 'rotate', 'scale' ] );

	const posFolder = gui.addFolder( 'position' );
	posFolder.add( target.position, 'x' ).min( - 5 ).max( 5 ).step( 0.001 ).listen();
	posFolder.add( target.position, 'y' ).min( - 5 ).max( 5 ).step( 0.001 ).listen();
	posFolder.add( target.position, 'z' ).min( - 5 ).max( 5 ).step( 0.001 ).listen();
	posFolder.open();

	const rotFolder = gui.addFolder( 'rotation' );
	rotFolder.add( target.rotation, 'x' ).min( - Math.PI ).max( Math.PI ).step( 0.001 ).listen();
	rotFolder.add( target.rotation, 'y' ).min( - Math.PI ).max( Math.PI ).step( 0.001 ).listen();
	rotFolder.add( target.rotation, 'z' ).min( - Math.PI ).max( Math.PI ).step( 0.001 ).listen();
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

function* updateMarchingCubes() {

	// marching cubes ranges from -1 to 1
	const dim = marchingCubes.matrixWorld.getMaxScaleOnAxis();
	const min = - dim;
	const max = dim;
	const size = marchingCubes.size;
	const cellWidth = 2 * dim / size;
	const cellWidth2 = cellWidth / 2;

	marchingCubes.isolation = 0.0000001;
	marchingCubes.position.x = 1 / size;
	marchingCubes.position.y = 1 / size;
	marchingCubes.position.z = 1 / size;

	marchingCubes.reset();
	const vec = new THREE.Vector3();
	const mat = new THREE.Matrix4();
	const targetToBvh = new THREE.Matrix4();
	for ( let y = 0; y < size; y ++ ) {

		for ( let x = 0; x < size; x ++ ) {

			for ( let z = 0; z < size; z ++ ) {

				vec.x = min + cellWidth2 + x * cellWidth;
				vec.y = min + cellWidth2 + y * cellWidth;
				vec.z = min + cellWidth2 + z * cellWidth;

				mat.compose( vec, target.quaternion, target.scale );
				targetToBvh.getInverse( terrain.matrixWorld ).multiply( mat );

				const result = terrain.geometry.boundsTree.distancecast( target, target.geometry, targetToBvh, 1 );
				// const result = terrain.geometry.boundsTree.geometrycast( target, target.geometry, targetToBvh ); // distancecast( target, target.geometry, targetToBvh, 1 );
				// console.log( result )
				marchingCubes.setCell( x, y, z, result ? 0 : 1 );

				// marchingCubes.setCell( x, y, z, y > size / 2 - 1 ? 0 : 1 );

				// const c = new THREE.Mesh( new THREE.SphereBufferGeometry() );
				// c.position.copy( vec );
				// scene.add( c );
				// c.scale.multiplyScalar( 0.01 )


				yield null;

			}

		}

	}

}

let currentTask = null;
let lastQuat = null;
function render() {

	stats.begin();

	if ( boundsViz ) boundsViz.update();

	if ( ! lastQuat || ! lastQuat.equals( target.quaternion ) ) {

		if ( ! lastQuat ) lastQuat = new THREE.Quaternion();
		currentTask = updateMarchingCubes();
		lastQuat.copy( target.quaternion );

	}

	if ( currentTask ) {

		let startTime = window.performance.now();
		while ( window.performance.now() - startTime < 60 ) {

			const res = currentTask.next();
			if ( res.done ) {

				currentTask = null;
				break;

			}

		}

	}

	// updateMarchingCubes();

	const transformMatrix =
		new THREE.Matrix4()
			.getInverse( terrain.matrixWorld )
			.multiply( target.matrixWorld );

	const hit = terrain.geometry.boundsTree.distancecast( terrain, target.geometry, transformMatrix, params.distance );
	target.material.color.set( hit ? 0xE91E63 : 0x666666 );
	target.material.emissive.set( 0xE91E63 ).multiplyScalar( hit ? 0.25 : 0 );

	renderer.render( scene, camera );
	stats.end();

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
