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

	visualizeBounds: false,
	visualBoundsDepth: 10,
	distance: 1,

};

let stats;
let scene, camera, renderer, controls, boundsViz;
let terrain, target, transformControls;
let marchingCubes, marchingCubesMesh, marchingCubesMeshBack;

function init() {

	const bgColor = 0x263238 / 2;

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.shadowMap.enabled = true;
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();
	scene.fog = new THREE.Fog( 0x263238 / 2, 10, 45 );

	const light = new THREE.DirectionalLight( 0xffffff, 0.5 );
	light.position.set( 1, 1, 1 );
	light.castShadow = true;
	light.shadow.mapSize.set( 1024, 1024 );


	const shadowCam = light.shadow.camera;
	shadowCam.left = shadowCam.bottom = - 15;
	shadowCam.right = shadowCam.top = 15;
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xE0F7FA, 0.5 ) );

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

	terrain = new THREE.Mesh( planeGeom, new THREE.MeshStandardMaterial( { color: 0xFFFFFF, metalness: 0.1, roughness: 0.9, side: THREE.DoubleSide } ) );
	terrain.rotation.x = - Math.PI / 2;
	terrain.position.y = - 3;
	terrain.receiveShadow = true;
	scene.add( terrain );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.z = 5;
	camera.far = 100;
	camera.updateProjectionMatrix();


	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	const shapeMaterial = new THREE.MeshStandardMaterial( { roughness: 0.75, metalness: 0.1 } );
	target = new THREE.Mesh( new THREE.BoxBufferGeometry( 1, 1, 1 ), shapeMaterial );
	target.castShadow = true;
	target.receiveShadow = true;
	scene.add( target );

	controls = new OrbitControls( camera, renderer.domElement );
	transformControls = new TransformControls( camera, renderer.domElement );
	transformControls.attach( target );
	transformControls.addEventListener( 'dragging-changed', e => controls.enabled = ! e.value );
	transformControls.addEventListener( 'changed', e => controls.enabled = ! e.value );
	scene.add( transformControls );

	const cubeMat = new THREE.MeshStandardMaterial( {
		color: 0xE91E63,
		metalness: 0.0,
		roughness: 0.9
	} );
	marchingCubes = new MarchingCubes( 100, cubeMat, false, false );
	marchingCubes.isolation = 0;

	const meshMat = new THREE.MeshStandardMaterial( {
		flatShading: true,
		color: 0xE91E63,
		metalness: 0.0,
		roughness: 0.9,
		transparent: true,
		depthWrite: false,
		opacity: 0.25,
	} );
	marchingCubesMesh = new THREE.Mesh( undefined, meshMat );
	marchingCubesMesh.visible = false;
	marchingCubesMesh.castShadow = true;

	const backMeshMat = meshMat.clone();
	backMeshMat.side = THREE.BackSide;
	marchingCubesMeshBack = new THREE.Mesh( undefined, backMeshMat );
	marchingCubesMeshBack.visible = false;

	const container = new THREE.Group();
	container.scale.multiplyScalar( 5 );
	container.add( marchingCubes );
	container.add( marchingCubesMeshBack );
	container.add( marchingCubesMesh );
	scene.add( container );

	scene.updateMatrixWorld( true );

	const gui = new dat.GUI();
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
	const size = marchingCubes.size;
	const cellWidth = 2 * dim / size;
	const cellWidth2 = cellWidth / 2;

	marchingCubes.isolation = 0.0000001;
	marchingCubes.position.x = 1 / size;
	marchingCubes.position.y = 1 / size;
	marchingCubes.position.z = 1 / size;

	marchingCubes.reset();
	marchingCubes.field.fill( - 1 );

	const pos = new THREE.Vector3();
	const scale = new THREE.Vector3();
	const quaternion = new THREE.Quaternion();

	target.matrixWorld.decompose( pos, quaternion, scale );

	const mat = new THREE.Matrix4();
	const targetToBvh = new THREE.Matrix4();
	const distance = params.distance;
	let count = 0;

	marchingCubesMesh.visible = false;
	marchingCubesMeshBack.visible = false;
	marchingCubes.visible = true;

	for ( let y = 0; y < size; y ++ ) {

		for ( let x = 0; x < size; x ++ ) {

			for ( let z = 0; z < size; z ++ ) {

				pos.x = min + cellWidth2 + x * cellWidth;
				pos.y = min + cellWidth2 + y * cellWidth;
				pos.z = min + cellWidth2 + z * cellWidth;

				mat.compose( pos, quaternion, scale );
				targetToBvh.getInverse( terrain.matrixWorld ).multiply( mat );

				if ( pos.length() < 3 ) {

					const result = terrain.geometry.boundsTree.distancecast( terrain, target.geometry, targetToBvh, distance );
					marchingCubes.setCell( x, y, z, result ? 0 : 1 );

				}

				count ++;

				yield count / ( size * size * size );

			}

		}

	}

	marchingCubes.blur( 1 );
	marchingCubes.isolation = 0.5;
	marchingCubesMesh.geometry = marchingCubes.generateBufferGeometry();
	marchingCubesMeshBack.geometry = marchingCubesMesh.geometry;
	marchingCubesMesh.visible = true;
	marchingCubesMeshBack.visible = true;
	marchingCubes.visible = false;

}

let currentTask = null;
let lastQuat = null;
let lastDist = null;
function render() {

	stats.begin();

	if ( boundsViz ) boundsViz.update();

	if ( ! lastQuat || ! lastQuat.equals( target.quaternion ) || lastDist !== params.distance ) {

		if ( ! lastQuat ) lastQuat = new THREE.Quaternion();
		currentTask = updateMarchingCubes();
		lastQuat.copy( target.quaternion );
		lastDist = params.distance;

	}

	let perc = 0;
	if ( currentTask ) {

		let startTime = window.performance.now();
		while ( window.performance.now() - startTime < 60 ) {

			const res = currentTask.next();
			perc = res.value;

			if ( res.done ) {

				currentTask = null;
				break;

			}

		}

	}

	document.getElementById( 'loader' ).setAttribute( 'style', `width: ${ perc * 100 }%` );

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
