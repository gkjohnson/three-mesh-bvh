import * as THREE from 'three';
import { GUI } from 'dat.gui';
import { generateAsync } from '../extra/generateAsync.js';
import { acceleratedRaycast } from '../src/index.js';

THREE.Mesh.raycast = acceleratedRaycast;

const params = {

	radius: 1,
	tube: 0.4,
	tubularSegments: 64,
	radialSegments: 8,
	p: 2,
	q: 3,

};

let renderer, camera, scene, knot, clock, gui, outputContainer;
let generating = false;

init();
render();

function init() {

	const bgColor = 0x263238 / 2;

	outputContainer = document.getElementById( 'info' );

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.gammaOutput = true;
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();
	scene.fog = new THREE.Fog( 0x263238 / 2, 20, 60 );

	const light = new THREE.DirectionalLight( 0xffffff, 0.5 );
	light.position.set( 1, 1, 1 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xffffff, 0.4 ) );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 0, 0, 4 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	clock = new THREE.Clock();

	gui = new GUI();
	gui.add( params, 'radius', 0.5, 2, 0.01 );
	gui.add( params, 'tube', 0.2, 1.2, 0.01 );
	gui.add( params, 'tubularSegments', 50, 500, 1 );
	gui.add( params, 'radialSegments', 5, 500, 1 );
	gui.add( params, 'p', 1, 10, 1 );
	gui.add( params, 'q', 1, 10, 1 );
	gui.add( { regenerateKnot }, 'regenerateKnot' ).name( 'regenerate' );

	regenerateKnot();

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

}

function regenerateKnot() {

	if ( generating ) {

		return;

	}
	generating = true;

	if ( knot ) {

		knot.material.dispose();
		knot.geometry.dispose();
		scene.remove( knot );

	}

	knot = new THREE.Mesh(
		new THREE.TorusKnotBufferGeometry(
			params.radius,
			params.tube,
			params.tubularSegments,
			params.radialSegments,
			params.p,
			params.q,
		),
		new THREE.MeshStandardMaterial( {

		} ),
	);

	let startTime = window.performance.now();
	generateAsync( knot.geometry ).then( bvh => {

		knot.geometry.boundsTree = bvh;
		scene.add( knot );
		generating = false;

		const deltaTime = window.performance.now() - startTime;
		outputContainer.textContent = `Generation Time : ${ deltaTime.toFixed( 3 ) }ms`;

	} );

}

function render() {

	requestAnimationFrame( render );

	let delta = clock.getDelta();
	knot.rotation.x += 0.4 * delta;
	knot.rotation.y += 0.6 * delta;

	renderer.render( scene, camera );

}
