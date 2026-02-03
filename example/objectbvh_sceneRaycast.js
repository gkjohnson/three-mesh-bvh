import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'stats.js';
import { AVERAGE, CENTER, BVHHelper, SAH } from 'three-mesh-bvh';
import { ObjectBVH, objectAcceleratedRaycast } from './src/bvh/ObjectBVH.js';

const params = {
	// Scene
	mode: 'batched',
	animate: true,

	// BVH
	useBVH: true,
	strategy: CENTER,
	precise: false,
	includeInstances: true,

	// Visualization
	showHelper: false,
	helperDepth: 15,
	helperParents: false,

	// Raycast
	firstHitOnly: true,
};

let renderer, scene, camera, controls, stats;
let container, bvhHelper;
let raycaster, mouse, highlightMesh;
let outputElement;

init();
rebuild();

function init() {

	outputElement = document.getElementById( 'output' );

	// Renderer
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( 0x131619, 1 );
	renderer.setAnimationLoop( render );
	document.body.appendChild( renderer.domElement );

	// Scene
	scene = new THREE.Scene();
	scene.fog = new THREE.Fog( 0x131619, 0, 10 );

	// Lights
	const light1 = new THREE.DirectionalLight( 0xffffff, 2.5 );
	light1.position.set( 1, 2, 1 );
	const light2 = new THREE.DirectionalLight( 0xffffff, 0.75 );
	light2.position.set( - 1, - 2, - 1 );
	scene.add( light1, light2, new THREE.AmbientLight( 0xffffff, 0.75 ) );

	// Camera
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 200 );
	camera.position.set( 18, 10, 0 );

	// Controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.enablePan = false;
	controls.enableDamping = true;

	// Container
	container = new THREE.Group();
	scene.add( container );

	// Raycaster
	raycaster = new THREE.Raycaster();
	mouse = new THREE.Vector2();

	// Highlight sphere
	highlightMesh = new THREE.Mesh(
		new THREE.SphereGeometry( 0.1, 16, 16 ),
		new THREE.MeshBasicMaterial( { color: 0xffff00, transparent: true, opacity: 0.75, fog: false } )
	);
	highlightMesh.visible = false;
	scene.add( highlightMesh );

	// Stats
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// GUI
	setupGUI();

	// Events
	window.addEventListener( 'resize', () => {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize( window.innerWidth, window.innerHeight );

	} );

	window.addEventListener( 'pointermove', e => {

		mouse.x = ( e.clientX / window.innerWidth ) * 2 - 1;
		mouse.y = - ( e.clientY / window.innerHeight ) * 2 + 1;

	} );

}

function setupGUI() {

	const gui = new GUI();

	gui.add( params, 'mode', [ 'group', 'instanced', 'batched', 'mix' ] ).onChange( rebuild );
	gui.add( params, 'animate' );

	const bvhFolder = gui.addFolder( 'BVH' );
	bvhFolder.add( params, 'useBVH' ).onChange( rebuildBVH );
	bvhFolder.add( params, 'strategy', { CENTER, AVERAGE, SAH } ).onChange( rebuildBVH );
	bvhFolder.add( params, 'precise' ).onChange( rebuildBVH );
	bvhFolder.add( params, 'includeInstances' ).onChange( rebuildBVH );
	bvhFolder.add( params, 'firstHitOnly' ).onChange( () => raycaster.firstHitOnly = params.firstHitOnly );
	bvhFolder.open();

	const helperFolder = gui.addFolder( 'Helper' );
	helperFolder.add( params, 'showHelper' );
	helperFolder.add( params, 'helperDepth', 1, 20, 1 ).onChange( v => {

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

}

function createObjects() {

	// Clear container
	disposeGroup( container );

	const COUNT = 10000;
	const geometries = [
		new THREE.TorusGeometry( 0.25, 0.1, 30, 30 ),
		new THREE.SphereGeometry( 0.25, 30, 30 ),
	];
	const colors = [ 0xE91E63, 0x03A9F4, 0x4CAF50, 0xFFC107, 0x9C27B0 ].map( c => new THREE.Color( c ) );

	// Calculate counts per mode
	const counts = { group: 0, instanced: 0, batched: 0 };
	switch ( params.mode ) {

		case 'group': counts.group = COUNT; break;
		case 'instanced': counts.instanced = COUNT; break;
		case 'batched': counts.batched = COUNT; break;
		case 'mix':
			counts.group = counts.instanced = counts.batched = Math.ceil( COUNT / 3 );
			break;

	}

	// Create group meshes
	if ( counts.group ) {

		const materials = colors.map( c => new THREE.MeshStandardMaterial( { color: c } ) );
		for ( let i = 0; i < counts.group; i ++ ) {

			const mesh = new THREE.Mesh( geometries[ i % geometries.length ], materials[ i % materials.length ] );
			randomTransform( mesh.matrix ).decompose( mesh.position, mesh.quaternion, mesh.scale );
			container.add( mesh );

		}

	}

	// Create instanced meshes
	if ( counts.instanced ) {

		geometries.forEach( geometry => {

			const count = Math.ceil( counts.instanced / geometries.length );
			const mesh = new THREE.InstancedMesh( geometry, new THREE.MeshStandardMaterial(), count );
			const matrix = new THREE.Matrix4();

			for ( let i = 0; i < count; i ++ ) {

				mesh.setMatrixAt( i, randomTransform( matrix ) );
				mesh.setColorAt( i, colors[ i % colors.length ] );

			}

			container.add( mesh );

		} );

	}

	// Create batched mesh
	if ( counts.batched ) {

		const maxVerts = geometries.reduce( ( sum, g ) => sum + g.attributes.position.count, 0 );
		const maxIndices = geometries.reduce( ( sum, g ) => sum + ( g.index?.count || 0 ), 0 );
		const mesh = new THREE.BatchedMesh( counts.batched, maxVerts, maxIndices, new THREE.MeshStandardMaterial() );
		const geoIds = geometries.map( g => mesh.addGeometry( g ) );
		const matrix = new THREE.Matrix4();

		for ( let i = 0; i < counts.batched; i ++ ) {

			const id = mesh.addInstance( geoIds[ i % geoIds.length ] );
			mesh.setMatrixAt( id, randomTransform( matrix ) );
			mesh.setColorAt( id, colors[ i % colors.length ] );

		}

		container.add( mesh );

	}

}

function rebuildBVH() {

	// Cleanup
	if ( bvhHelper ) {

		bvhHelper.dispose();
		scene.remove( bvhHelper );
		bvhHelper = null;

	}

	container.boundsTree = null;

	// Build BVH
	if ( params.useBVH ) {

		console.time( 'BVH Build' );
		container.updateMatrixWorld();
		container.boundsTree = new ObjectBVH( container, {
			strategy: params.strategy,
			precise: params.precise,
			includeInstances: params.includeInstances,
		} );
		container.raycast = objectAcceleratedRaycast;
		console.timeEnd( 'BVH Build' );

		bvhHelper = new BVHHelper( container, container.sceneBoundsTree, params.helperDepth );
		bvhHelper.displayParents = params.displayParents;
		bvhHelper.color.set( 0xffffff );
		bvhHelper.opacity = 0.6;
		scene.add( bvhHelper );

	}

}

function rebuild() {

	createObjects();
	rebuildBVH();

}

function performRaycast() {

	raycaster.setFromCamera( mouse, camera );
	raycaster.firstHitOnly = params.firstHitOnly;

	const start = performance.now();
	const hits = raycaster.intersectObject( container, true );
	outputElement.innerText = `${ ( performance.now() - start ).toFixed( 3 ) }ms`;

	highlightMesh.visible = hits.length > 0;
	if ( hits.length ) highlightMesh.position.copy( hits[ 0 ].point );

}

function render() {

	stats.begin();

	// Update GUI settings
	if ( bvhHelper ) bvhHelper.visible = params.showHelper;
	if ( params.animate ) container.rotation.y += 0.0005;
	scene.fog.near = camera.position.length() - 7.5;
	scene.fog.far = camera.position.length() + 5;

	controls.update();
	performRaycast();

	renderer.render( scene, camera );
	stats.end();

}

// Helpers
function randomTransform( matrix ) {

	const d = Math.cbrt( Math.random() );
	const pos = new THREE.Vector3().randomDirection().multiplyScalar( 10 * d * d );
	const rot = new THREE.Quaternion().setFromEuler( new THREE.Euler(
		Math.random() * Math.PI * 2,
		Math.random() * Math.PI * 2,
		Math.random() * Math.PI * 2
	) );
	const scale = new THREE.Vector3().setScalar( 0.25 + Math.random() * 0.75 );
	return matrix.compose( pos, rot, scale );

}

function disposeGroup( group ) {

	while ( group.children.length ) {

		const child = group.children[ 0 ];
		child.geometry?.dispose();
		child.material?.dispose();
		child.dispose?.();
		group.remove( child );

	}

}
