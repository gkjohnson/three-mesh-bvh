import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import {
	acceleratedRaycast, computeBoundsTree, disposeBoundsTree, LineSegmentsBVH, MeshBVHHelper,
	SAH, CENTER, AVERAGE,
} from 'three-mesh-bvh';

THREE.LineSegments.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const params = {
	displayHelper: false,
	helperDepth: 10,
	displayParents: false,

	useBVH: true,
	complexity: 500000,
	strategy: 0,
	indirect: false,
};

let renderer, camera, scene, controls, stats, outputContainer;
let lineSegments, helper;
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
	camera.position.set( 1.5, 1.5, 1.5 );
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
		new THREE.SphereGeometry( 0.025, 16, 16 ),
		new THREE.MeshBasicMaterial( { color: 0xff0000, transparent: true, opacity: 0.75 } )
	);
	sphereCollision.visible = false;
	scene.add( sphereCollision );

	// stats
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// generate initial geometry
	regenerateGeometry();

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

function generateComplexCurve( segments ) {

	const points = [];
	const up = new THREE.Vector3( 0, 1, 0 );
	const norm = new THREE.Vector3();
	const tangent = new THREE.Vector3();
	const v0 = new THREE.Vector3();
	const v1 = new THREE.Vector3();

	const getSurfacePoint = ( t, target ) => {

		let x = Math.sin( t * Math.PI );
		let y = Math.cos( t * Math.PI );
		let z = 0;

		target.set( x, y, z ).applyAxisAngle( up, 20 * t * 2 * Math.PI );

	};

	for ( let i = 0; i <= segments; i ++ ) {

		const t0 = i / segments;
		const t1 = t0 + 1e-4;

		getSurfacePoint( t0, v0 );
		getSurfacePoint( t1, v1 );

		norm.copy( v0 ).normalize();
		tangent.subVectors( v1, v0 ).normalize();

		norm.applyAxisAngle( tangent, 2000 * t0 * 2 * Math.PI );

		v0
			// .multiplyScalar( Math.sin( t0 * Math.PI ) )
			.addScaledVector( norm, 0.03 * ( Math.sin( 100 * t0 * Math.PI ) + 2 ) * Math.sin( t0 * Math.PI ) );
		points.push( v0.clone() );

	}

	return points;

}

function regenerateGeometry() {

	if ( lineSegments ) {

		scene.remove( lineSegments );
		lineSegments.geometry.dispose();
		lineSegments.material.dispose();

	}

	if ( helper ) {

		scene.remove( helper );

	}

	const positions = [];
	const colors = [];

	// Generate single complex curve
	const points = generateComplexCurve( params.complexity );

	// Convert points to line segments with color gradient
	for ( let i = 0; i < points.length - 1; i ++ ) {

		const p1 = points[ i ];
		const p2 = points[ i + 1 ];

		// Create rainbow gradient along the curve
		const t = i / ( points.length - 1 );
		const color = new THREE.Color().setHSL( t, 1.0, 0.6 );

		positions.push( p1.x, p1.y, p1.z );
		positions.push( p2.x, p2.y, p2.z );

		colors.push( color.r, color.g, color.b );
		colors.push( color.r, color.g, color.b );

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( colors, 3 ) );

	const material = new THREE.LineBasicMaterial( {
		vertexColors: true,
		linewidth: 2,
	} );

	lineSegments = new THREE.LineSegments( geometry, material );
	scene.add( lineSegments );

	updateBVH();

}

function updateBVH() {

	if ( params.useBVH ) {

		console.time( 'LineSegmentsBVH' );
		lineSegments.geometry.computeBoundsTree( {
			strategy: parseInt( params.strategy ),
			indirect: params.indirect,
			type: LineSegmentsBVH,
		} );
		console.timeEnd( 'LineSegmentsBVH' );

	} else {

		lineSegments.geometry.disposeBoundsTree();

	}

	if ( helper ) {

		scene.remove( helper );

	}

	if ( lineSegments.geometry.boundsTree ) {

		helper = new MeshBVHHelper( lineSegments, params.helperDepth );
		helper.displayParents = params.displayParents;
		helper.visible = params.displayHelper;
		scene.add( helper );

	}

}

function updateRaycast() {

	raycaster.setFromCamera( mouse, camera );
	raycaster.firstHitOnly = true;

	const startTime = window.performance.now();
	const intersects = raycaster.intersectObject( lineSegments );
	const delta = window.performance.now() - startTime;

	const hit = intersects[ 0 ];
	if ( hit ) {

		sphereCollision.position.copy( hit.point );
		sphereCollision.visible = true;

	} else {

		sphereCollision.visible = false;

	}

	const totalSegments = lineSegments.geometry.attributes.position.count / 2;
	outputContainer.innerText = `${ delta.toFixed( 2 ) }ms | ${ totalSegments.toLocaleString() } line segments`;

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

	lineSegments.rotation.y = performance.now() * 1e-4;

	updateRaycast();

	renderer.render( scene, camera );

	stats.update();

}
