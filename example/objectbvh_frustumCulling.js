import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'stats.js';
import { BVHHelper, CONTAINED, INTERSECTED } from 'three-mesh-bvh';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ObjectBVH } from './src/bvh/ObjectBVH.js';

const params = {
	animate: true,
	thirdPerson: false,
	useBVH: true,
	checkBoundingSphere: false,
	showHelper: false,
	helperDepth: 25,
	helperParents: false,
};

let renderer, scene, camera, camera2, controls, stats;
let sceneBVH, bvhHelper, batchedMesh, cameraHelper;
let outputElement;

init();
createObjects();

function init() {

	outputElement = document.getElementById( 'output' );

	// Renderer
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( 0x131619, 1 );
	renderer.setAnimationLoop( render );
	document.body.appendChild( renderer.domElement );

	// Camera
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 100 );
	camera.position.set( 18, 10, 0 );

	camera2 = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 800 );
	camera2.position.set( 0, 20, 400 );
	camera2.lookAt( 0, 0, 0 );

	cameraHelper = new THREE.CameraHelper( camera );

	// Scene
	scene = new THREE.Scene();
	scene.fog = new THREE.Fog( 0x131619, 25, camera.far );
	scene.add( cameraHelper );

	// Lights
	const light1 = new THREE.DirectionalLight( 0xffffff, 2.5 );
	light1.position.set( 1, 2, 1 );
	const light2 = new THREE.DirectionalLight( 0xffffff, 0.75 );
	light2.position.set( - 1, - 2, - 1 );
	scene.add( light1, light2, new THREE.AmbientLight( 0xffffff, 0.75 ) );

	// Controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.enablePan = false;
	controls.enableDamping = true;

	// Stats
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// GUI
	const gui = new GUI();
	gui.add( params, 'animate' );
	gui.add( params, 'thirdPerson' );
	gui.add( params, 'useBVH' );
	gui.add( params, 'checkBoundingSphere' );

	const helperFolder = gui.addFolder( 'Helper' );
	helperFolder.add( params, 'showHelper' );
	helperFolder.add( params, 'helperDepth', 1, 25, 1 ).onChange( v => {

		if ( bvhHelper ) {

			bvhHelper.depth = v;
			bvhHelper.update();

		}

	} );
	helperFolder.add( params, 'helperParents' ).onChange( v => {

		if ( bvhHelper ) {

			bvhHelper.displayParents = v;
			bvhHelper.update();

		}

	} );

	// Events
	window.addEventListener( 'resize', () => {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		camera2.aspect = window.innerWidth / window.innerHeight;
		camera2.updateProjectionMatrix();

		cameraHelper.update();
		renderer.setSize( window.innerWidth, window.innerHeight );

	} );

}

function createObjects() {

	const COUNT = 500000;
	const geometries = [
		new THREE.TorusGeometry( 0.25, 0.1, 30, 30 ),
		new THREE.SphereGeometry( 0.25, 30, 30 ),
		new THREE.ConeGeometry( 0.25, 0.25 ),
		mergeVertices( new RoundedBoxGeometry( 0.25, 0.25, 0.5, 4, 1 ) ),
	];
	const colors = [ 0xE91E63, 0x03A9F4, 0x4CAF50, 0xFFC107, 0x9C27B0 ].map( c => new THREE.Color( c ) );

	// Create BatchedMesh
	const maxVerts = geometries.reduce( ( sum, g ) => sum + g.attributes.position.count, 0 );
	const maxIndices = geometries.reduce( ( sum, g ) => sum + ( g.index?.count || 0 ), 0 );
	batchedMesh = new THREE.BatchedMesh( COUNT, maxVerts, maxIndices, new THREE.MeshStandardMaterial( { roughness: 0.5 } ) );
	batchedMesh.sortObjects = false;

	const geoIds = geometries.map( g => batchedMesh.addGeometry( g ) );
	const matrix = new THREE.Matrix4();

	for ( let i = 0; i < COUNT; i ++ ) {

		const id = batchedMesh.addInstance( geoIds[ i % geoIds.length ] );
		batchedMesh.setMatrixAt( id, randomTransform( matrix ) );
		batchedMesh.setColorAt( id, colors[ i % colors.length ] );
		batchedMesh.setVisibleAt( id, false );

	}

	scene.add( batchedMesh );
	scene.updateMatrixWorld();

	// Create BVH
	sceneBVH = new ObjectBVH( batchedMesh );
	bvhHelper = new BVHHelper( batchedMesh, sceneBVH, params.helperDepth );
	bvhHelper.color.set( 0xffffff );
	bvhHelper.opacity = 0.1;
	bvhHelper.instanceId = - 1;
	scene.add( bvhHelper );

}

function updateVisibility() {

	const { useBVH, checkBoundingSphere } = params;

	// Reset visibility
	batchedMesh.perObjectFrustumCulled = ! useBVH;
	for ( let i = 0; i < batchedMesh.instanceCount; i ++ ) {

		batchedMesh.setVisibleAt( i, ! useBVH );

	}

	if ( ! useBVH ) {

		return;

	}

	// Update camera
	camera.updateMatrixWorld();

	// Setup frustum
	const frustum = new THREE.Frustum();
	const frustumMatrix = new THREE.Matrix4()
		.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse )
		.multiply( batchedMesh.matrixWorld );
	frustum.setFromProjectionMatrix( frustumMatrix, camera.coordinateSystem, camera.reversedDepth );

	// BVH-accelerated frustum culling
	const invMatrix = new THREE.Matrix4().copy( sceneBVH.matrixWorld ).invert();
	const matrix = new THREE.Matrix4();
	const sphere = new THREE.Sphere();
	const point = new THREE.Vector3();

	sceneBVH.shapecast( {
		intersectsBounds: box => {

			if ( ! frustum.intersectsBox( box ) ) return;

			// Check if fully contained
			const { min, max } = box;
			for ( let x = - 1; x <= 1; x += 2 ) {

				for ( let y = - 1; y <= 1; y += 2 ) {

					for ( let z = - 1; z <= 1; z += 2 ) {

						point.set( x < 0 ? min.x : max.x, y < 0 ? min.y : max.y, z < 0 ? min.z : max.z );
						if ( ! frustum.containsPoint( point ) ) return INTERSECTED;

					}

				}

			}

			return CONTAINED;

		},
		intersectsObject: ( object, instanceId ) => {

			if ( checkBoundingSphere ) {

				// Optional sphere check for tighter culling
				const geoId = object.getGeometryIdAt( instanceId );
				object.getMatrixAt( instanceId, matrix );
				matrix.premultiply( object.matrixWorld ).premultiply( invMatrix );
				object.getBoundingSphereAt( geoId, sphere );
				sphere.applyMatrix4( matrix );

				if ( frustum.intersectsSphere( sphere ) ) {

					object.setVisibleAt( instanceId, true );

				}

			} else {

				object.setVisibleAt( instanceId, true );

			}

		},
	} );

}

function render() {

	stats.begin();

	// Update GUI settings
	if ( bvhHelper ) bvhHelper.visible = params.showHelper;
	if ( params.animate ) batchedMesh.rotation.y += 0.0005;

	controls.update();

	const start = performance.now();
	updateVisibility();

	if ( params.thirdPerson ) {

		bvhHelper.opacity = 0.05;
		cameraHelper.visible = true;
		scene.fog.far = 1e10;
		renderer.render( scene, camera2 );

	} else {

		bvhHelper.opacity = 0.5;
		cameraHelper.visible = false;
		scene.fog.far = camera.far;
		renderer.render( scene, camera );

	}

	const delta = performance.now() - start;

	outputElement.innerText = `render: ${ delta.toFixed( 2 ) }ms\nvisible: ${ batchedMesh._multiDrawCount }`;

	stats.end();

}

function randomTransform( matrix ) {

	const d = Math.cbrt( Math.random() );
	const pos = new THREE.Vector3().randomDirection().multiplyScalar( 300 * d );
	const rot = new THREE.Quaternion().setFromEuler( new THREE.Euler(
		Math.random() * Math.PI * 2,
		Math.random() * Math.PI * 2,
		Math.random() * Math.PI * 2
	) );
	const scale = new THREE.Vector3().setScalar( 1 + Math.random() * 3 );
	return matrix.compose( pos, rot, scale );

}
