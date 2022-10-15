import Stats from 'stats.js/src/Stats';
import * as dat from 'three/examples/jsm/libs/lil-gui.module.min.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { MarchingCubes } from './lib/MarchingCubes.js';
import SimplexNoise from 'simplex-noise';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, MeshBVHVisualizer } from '..';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const params = {

	visualizeBounds: false,
	visualBoundsDepth: 10,

	volume: {
		display: 1,
		hideWhileGenerating: false,
		alwaysShowDistance: true,
		surfaceOnly: false,
		distance: 1,
		resolution: 100,
		radius: 4,
	},
	displayClosestPoint: true,

};

let stats;
let scene, camera, renderer, controls, boundsViz;
let terrain, targetContainer, targetMesh, transformControls;
let marchingCubes, marchingCubesContainer;
let sphere1, sphere2, line;
let needsUpdate = false;

function init() {

	const bgColor = 0x263238 / 2;

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();
	scene.fog = new THREE.Fog( 0x263238 / 2, 10, 45 );

	const light = new THREE.DirectionalLight( 0xffffff, 0.5 );
	light.position.set( 20, 20, 20 );
	light.castShadow = true;
	light.shadow.mapSize.set( 2048, 2048 );

	const shadowCam = light.shadow.camera;
	shadowCam.left = shadowCam.bottom = - 15;
	shadowCam.right = shadowCam.top = 15;
	shadowCam.updateProjectionMatrix();

	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xE0F7FA, 0.5 ) );

	// geometry setup
	const size = 50;
	const dim = 250;
	const planeGeom = new THREE.PlaneBufferGeometry( size, size, dim - 1, dim - 1 );
	const posAttr = planeGeom.attributes.position;

	const seed = Math.floor( Math.random() * 100 );
	const noise = new SimplexNoise( seed );
	for ( let i = 0; i < dim * dim; i ++ ) {

		const x = posAttr.getX( i ) / 15;
		const y = posAttr.getY( i ) / 15;
		posAttr.setZ( i, noise.noise2D( x, y ) * 3 );

	}

	planeGeom.computeVertexNormals();
	planeGeom.computeBoundsTree();

	terrain = new THREE.Mesh( planeGeom, new THREE.MeshStandardMaterial( {
		color: 0xFFFFFF,
		metalness: 0.1,
		roughness: 0.9,
		side: THREE.DoubleSide,
	} ) );
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
	targetContainer = new THREE.Group();
	scene.add( targetContainer );

	targetMesh = new THREE.Mesh( new THREE.CylinderBufferGeometry( 0.5, 0.25, 1, 20, 1 ), shapeMaterial );
	targetMesh.castShadow = true;
	targetMesh.receiveShadow = true;
	targetMesh.geometry.computeBoundsTree();
	targetMesh.geometry.computeBoundingSphere();
	targetContainer.add( targetMesh );

	controls = new OrbitControls( camera, renderer.domElement );
	transformControls = new TransformControls( camera, renderer.domElement );
	transformControls.attach( targetContainer );
	transformControls.addEventListener( 'dragging-changed', e => {

		controls.enabled = ! e.value;
		if ( ! e.value ) needsUpdate = true;

	} );
	transformControls.addEventListener( 'objectChange', e => {

		needsUpdate = true;

	} );
	scene.add( transformControls );

	const cubeMat = new THREE.MeshStandardMaterial( {
		flatShading: true,
		color: 0xE91E63,
		metalness: 0.0,
		roughness: 0.35,
		transparent: true,
		depthWrite: false,
		opacity: 0.15,
		premultipliedAlpha: true,
	} );
	marchingCubes = new MarchingCubes( 100, cubeMat, false, false, 1000000 );
	marchingCubes.isolation = 0;
	marchingCubes.autoUpdate = false;

	marchingCubesContainer = new THREE.Group();
	marchingCubesContainer.scale.multiplyScalar( 5 );
	marchingCubesContainer.add( marchingCubes );
	scene.add( marchingCubesContainer );

	sphere1 = new THREE.Mesh(
		new THREE.SphereGeometry( 0.025, 20, 20 ),
		new THREE.MeshBasicMaterial( {
			color: 0xE91E63,
		} ) );
	sphere1.castShadow = true;
	scene.add( sphere1 );

	sphere2 = sphere1.clone();
	sphere2.castShadow = true;
	scene.add( sphere2 );

	const lineCube = new THREE.Mesh( new THREE.BoxGeometry(), sphere1.material );
	lineCube.castShadow = true;
	lineCube.position.z = 0.5;

	line = new THREE.Object3D();
	line.add( lineCube );
	scene.add( line );

	scene.updateMatrixWorld( true );

	const gui = new dat.GUI( { width: 300 } );
	gui.add( params, 'visualizeBounds' ).onChange( () => updateFromOptions() );
	gui.add( params, 'visualBoundsDepth' ).min( 1 ).max( 40 ).step( 1 ).onChange( () => updateFromOptions() );

	const mcFolder = gui.addFolder( 'distanceVisualization' );
	mcFolder.add( params.volume, 'display', { 'hide': 0, 'distance to terrain': 1, 'distance to mesh': 2 } ).onChange( () => {

		regenerate = true;

	} );
	mcFolder.add( params.volume, 'hideWhileGenerating' );
	mcFolder.add( params.volume, 'alwaysShowDistance' );
	mcFolder.add( params.volume, 'surfaceOnly' ).onChange( () => regenerate = true );
	mcFolder.add( params.volume, 'distance' ).min( 0 ).max( 2 ).step( 0.01 ).onChange( () => regenerate = true );
	mcFolder.add( params.volume, 'radius' ).min( 1 ).max( 20 ).onChange( () => regenerate = true );
	mcFolder.add( params.volume, 'resolution', 5, 200, 1 ).onChange( () => regenerate = true );
	mcFolder.open();

	gui.add( transformControls, 'mode', [ 'translate', 'rotate' ] );

	const posFolder = gui.addFolder( 'position' );
	posFolder.add( targetContainer.position, 'x' ).min( - 5 ).max( 5 ).step( 0.001 ).listen();
	posFolder.add( targetContainer.position, 'y' ).min( - 5 ).max( 5 ).step( 0.001 ).listen();
	posFolder.add( targetContainer.position, 'z' ).min( - 5 ).max( 5 ).step( 0.001 ).listen();

	const rotFolder = gui.addFolder( 'rotation' );
	rotFolder.add( targetContainer.rotation, 'x' ).min( - Math.PI ).max( Math.PI ).step( 0.001 ).listen();
	rotFolder.add( targetContainer.rotation, 'y' ).min( - Math.PI ).max( Math.PI ).step( 0.001 ).listen();
	rotFolder.add( targetContainer.rotation, 'z' ).min( - Math.PI ).max( Math.PI ).step( 0.001 ).listen();

	gui.open();

	updateDistanceCheck();

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

		gui.controllersRecursive().forEach( c => c.updateDisplay() );

	} );

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

function updateDistanceCheck( fastCheck ) {

	targetContainer.updateMatrixWorld();
	const targetToBvh =
		new THREE.Matrix4()
		    .copy( terrain.matrixWorld ).invert()
			.multiply( targetContainer.matrixWorld );

	// get the closest point
	const volumeDistance = params.volume.distance;
	const maxDistance = volumeDistance;
	const minDistance = fastCheck ? volumeDistance : 0;

	const distanceResult1 = {};
	const distanceResult2 = {};
	const foundPoint = ! ! terrain.geometry.boundsTree.closestPointToGeometry(
		targetMesh.geometry,
		targetToBvh,
		distanceResult1,
		distanceResult2,
		minDistance,
		maxDistance,
	);

	const hit = foundPoint && distanceResult1.distance < volumeDistance;
	if ( hit ) {

		// the resulting points are provided in the local frame of the the geometries
		sphere1.position.copy( distanceResult1.point );
		sphere2.position.copy( distanceResult2.point ).applyMatrix4( targetToBvh );

		// update the line indicating closest point
		sphere1.position.applyMatrix4( terrain.matrixWorld );
		sphere2.position.applyMatrix4( terrain.matrixWorld );

		line.position.copy( sphere1.position );
		line.lookAt( sphere2.position );
		line.scale.set(
			0.01,
			0.01,
			sphere1.position.distanceTo( sphere2.position )
		);

	}

	targetMesh.material.color.set( hit ? 0xE91E63 : 0x666666 );
	targetMesh.material.emissive.set( 0xE91E63 ).multiplyScalar( hit ? 0.25 : 0 );

	const areVisible = hit && ! fastCheck;
	line.visible = areVisible;
	sphere1.visible = areVisible;
	sphere2.visible = areVisible;

}

function* updateMarchingCubes() {

	if ( params.volume.display == 0 ) return;

	updateDistanceCheck();

	const isDistanceToTarget = params.volume.display == 2;

	const pos = new THREE.Vector3();
	const surfaceOnly = params.volume.surfaceOnly;
	const resolution = params.volume.resolution;
	const distance = params.volume.distance;
	const radius = params.volume.radius;
	let fieldSize;
	let worldToBvh;
	let distanceMesh;

	if ( isDistanceToTarget ) {

		targetContainer.add( marchingCubesContainer );
		worldToBvh = new THREE.Matrix4().identity();
		fieldSize = ( targetMesh.geometry.boundingSphere.radius + distance ) * 2;
		distanceMesh = targetMesh;

	} else {

		scene.add( marchingCubesContainer );
		fieldSize = ( radius + 4 * radius / resolution ) * 2;
		worldToBvh = new THREE.Matrix4().copy( terrain.matrixWorld ).invert();
		distanceMesh = terrain;

	}

	marchingCubesContainer.scale.set( fieldSize / 2, fieldSize / 2, fieldSize / 2 );
	marchingCubesContainer.updateMatrixWorld();

	// Create a new marching cubes container to update the resolution
	marchingCubes.init( resolution );
	marchingCubes.updateMatrixWorld();

	// marching cubes ranges from -1 to 1
	const dim = marchingCubes.matrixWorld.getMaxScaleOnAxis();
	const min = - dim;
	const size = marchingCubes.size;
	const cellWidth = 2 * dim / size;
	const cellWidth2 = cellWidth / 2;

	marchingCubes.isolation = 0.5;
	marchingCubes.position.x = 1 / size;
	marchingCubes.position.y = 1 / size;
	marchingCubes.position.z = 1 / size;

	marchingCubes.reset();

	// get the world distance
	const distanceResult = {};
	let count = 0;
	for ( let y = 0; y < size; y ++ ) {

		for ( let x = 0; x < size; x ++ ) {

			for ( let z = 0; z < size; z ++ ) {

				pos.x = min + cellWidth2 + x * cellWidth;
				pos.y = min + cellWidth2 + y * cellWidth;
				pos.z = min + cellWidth2 + z * cellWidth;

				if ( isDistanceToTarget || surfaceOnly || pos.length() < radius && ! isDistanceToTarget ) {

					pos.applyMatrix4( worldToBvh );

					const foundPoint = ! ! distanceMesh.geometry.boundsTree.closestPointToPoint(
						pos,
						distanceResult,
						distance,
						distance,
					);
					const result = distanceResult.distance < distance;
					marchingCubes.setCell( x, y, z, foundPoint && result ? 0 : 1 );

				}

				count ++;

				yield count / ( size * size * size );

			}

		}

	}

	marchingCubes.blur( 1 );

}

let currentTask = null;
let regenerate = true;
function render() {

	stats.begin();

	if ( needsUpdate ) {

		updateDistanceCheck( ! params.volume.alwaysShowDistance );
		needsUpdate = false;

	}

	if ( boundsViz ) {

		boundsViz.update();

	}

	// start regenerating the marching cubes mesh if needed
	if ( regenerate ) {

		currentTask = updateMarchingCubes();
		regenerate = false;

	}

	// console.log('----');
	// update the marching cubes volume
	let percentage = 0;
	if ( currentTask ) {

		let startTime = window.performance.now();
		while ( window.performance.now() - startTime < 15 ) {

			const res = currentTask.next();
			percentage = res.value;

			if ( res.done ) {

				currentTask = null;
				break;

			}

		}

		marchingCubes.update();

		marchingCubes.visible = ! params.volume.hideWhileGenerating && params.volume.display != 0;

	}

	// Update visibility of marching cubes mesh
	if ( ! currentTask ) {

		marchingCubes.visible = true;

	}

	// update loading bar
	document.getElementById( 'loader' ).setAttribute( 'style', `width: ${ percentage * 100 }%` );

	// render
	renderer.render( scene, camera );
	stats.end();

	requestAnimationFrame( render );

}

init();
updateFromOptions();
render();
