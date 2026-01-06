import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import {
	acceleratedRaycast, computeBoundsTree, disposeBoundsTree, LineBVH, MeshBVHHelper,
	SAH, CENTER, AVERAGE,
} from 'three-mesh-bvh';

THREE.Line.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const params = {
	displayHelper: false,
	helperDepth: 10,
	displayParents: false,

	useBVH: true,
	strategy: 0,
	indirect: false,
};

let renderer, camera, scene, controls, stats, outputContainer;
let line, helper;
let raycaster, mouse;
let sphereCollision;

init();
render();

function init() {

	outputContainer = document.getElementById( 'output' );

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( 0x263238 );
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 2, 1, 2 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	// controls
	controls = new OrbitControls( camera, renderer.domElement );

	// raycaster
	raycaster = new THREE.Raycaster();
	raycaster.params.Line.threshold = 0.01;
	mouse = new THREE.Vector2();

	// collision sphere
	sphereCollision = new THREE.Mesh(
		new THREE.SphereGeometry( 0.01, 16, 16 ),
		new THREE.MeshBasicMaterial( { color: 0xff0000, transparent: true, opacity: 0.75 } )
	);
	sphereCollision.visible = false;
	scene.add( sphereCollision );

	// stats
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// generate initial geometry
	line = new THREE.Line( generateGeometry(), new THREE.LineBasicMaterial( {
		vertexColors: true,
		linewidth: 2,
	} ) );

	helper = new MeshBVHHelper( line, params.helperDepth );

	scene.add( line, helper );

	updateBVH();

	// GUI
	const gui = new GUI();

	const helperFolder = gui.addFolder( 'helper' );
	helperFolder.add( params, 'displayHelper' );
	helperFolder.add( params, 'displayParents' ).onChange( v => {

		helper.displayParents = v;
		helper.update();

	} );
	helperFolder.add( params, 'helperDepth', 1, 25, 1 ).name( 'depth' ).onChange( v => {

		helper.depth = parseInt( v );
		helper.update();

	} );
	helperFolder.open();

	const linesFolder = gui.addFolder( 'lines' );
	linesFolder.add( params, 'useBVH' ).onChange( updateBVH );
	linesFolder.add( params, 'strategy', { CENTER, AVERAGE, SAH } ).onChange( updateBVH );
	linesFolder.add( params, 'indirect' ).onChange( updateBVH );
	linesFolder.open();

	window.addEventListener( 'resize', onWindowResize, false );
	window.addEventListener( 'pointermove', onPointerMove, false );

}

function generateCurve( segments ) {

	const points = [];
	const norm = new THREE.Vector3();
	const tangent = new THREE.Vector3();
	const v0 = new THREE.Vector3();
	const v1 = new THREE.Vector3();

	const getSurfacePoint = ( t, target ) => {

		// Torus knot parameters
		const p = 3; // number of times the knot winds around the torus longitudinally
		const q = 10; // number of times the knot winds around the torus meridionally
		const R = 1.0; // major radius
		const r = 0.4; // minor radius (tube radius)

		const theta = t * Math.PI * 2;
		const phi = p * theta;
		const psi = q * theta;

		const x = ( R + r * Math.cos( psi ) ) * Math.cos( phi );
		const y = ( R + r * Math.cos( psi ) ) * Math.sin( phi );
		const z = r * Math.sin( psi );

		target.set( x, y, z );

	};

	for ( let i = 0; i <= segments; i ++ ) {

		const t0 = i / segments;
		const t1 = t0 + 1e-4;

		getSurfacePoint( t0, v0 );
		getSurfacePoint( t1, v1 );

		norm.copy( v0 ).normalize();
		tangent.subVectors( v1, v0 ).normalize();

		norm.applyAxisAngle( tangent, 1000 * t0 * 2 * Math.PI );

		v0
			// .multiplyScalar( Math.sin( t0 * Math.PI ) )
			.addScaledVector( norm, 0.05 * ( Math.sin( 50 * t0 * Math.PI ) + 2 ) );
		points.push( v0.clone() );

	}

	return points;

}

function generateGeometry() {

	const positions = [];
	const colors = [];

	const points = generateCurve( 1e6 );
	const color = new THREE.Color();
	for ( let i = 0; i < points.length - 1; i ++ ) {

		const p1 = points[ i ];
		const t = i / ( points.length - 1 );
		color.setHSL( t * 3, 1.0, 0.6 );

		positions.push( p1.x, p1.y, p1.z );
		colors.push( color.r, color.g, color.b );

	}


	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( colors, 3 ) );

	return geometry;

}

function updateBVH() {

	if ( params.useBVH ) {

		console.time( 'LineBVH' );
		line.geometry.computeBoundsTree( {
			strategy: parseInt( params.strategy ),
			indirect: params.indirect,
			type: LineBVH,
			maxLeafTris: 1,
		} );
		console.timeEnd( 'LineBVH' );

	} else {

		line.geometry.disposeBoundsTree();

	}

	helper.update();

}

function updateRaycast() {

	raycaster.setFromCamera( mouse, camera );
	raycaster.firstHitOnly = true;

	const startTime = window.performance.now();
	const intersects = raycaster.intersectObject( line );
	const delta = window.performance.now() - startTime;

	const hit = intersects[ 0 ];
	if ( hit ) {

		sphereCollision.position.copy( hit.point );
		sphereCollision.visible = true;

	} else {

		sphereCollision.visible = false;

	}

	outputContainer.innerText = `${ delta.toFixed( 2 ) }ms`;

}

function onPointerMove( event ) {

	mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
	mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;

}

function onWindowResize() {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	renderer.setSize( window.innerWidth, window.innerHeight );

}

function render() {

	requestAnimationFrame( render );

	if ( helper ) {

		helper.visible = params.displayHelper;

	}

	line.rotation.y = performance.now() * 1e-4;

	updateRaycast();

	renderer.render( scene, camera );

	stats.update();

}
