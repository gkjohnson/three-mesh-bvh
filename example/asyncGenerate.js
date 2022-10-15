import * as THREE from 'three';
import Stats from 'stats.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { GenerateMeshBVHWorker } from '../src/workers/GenerateMeshBVHWorker.js';
import { acceleratedRaycast, MeshBVH, MeshBVHVisualizer } from '..';

THREE.Mesh.raycast = acceleratedRaycast;

const params = {

	useWebWorker: true,
	radius: 1,
	tube: 0.3,
	tubularSegments: 500,
	radialSegments: 500,
	p: 3,
	q: 5,

	displayHelper: false,
	helperDepth: 10,

};

let renderer, camera, scene, knot, clock, gui, helper, group, stats;
let outputContainer, loadContainer, loadBar, loadText;
let bvhGenerationWorker;
let generating = false;

init();
render();

function init() {

	const bgColor = 0xffca28;

	outputContainer = document.getElementById( 'output' );
	loadContainer = document.getElementById( 'loading-container' );
	loadBar = document.querySelector( '#loading-container .bar' );
	loadText = document.querySelector( '#loading-container .text' );

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.outputEncoding = THREE.sRGBEncoding;
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();
	scene.fog = new THREE.Fog( 0xffca28, 20, 60 );

	const light = new THREE.DirectionalLight( 0xffffff, 1 );
	light.position.set( 1, 1, 1 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xb0bec5, 0.8 ) );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 0, 0, 4 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	clock = new THREE.Clock();

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	group = new THREE.Group();
	scene.add( group );

	for ( let i = 0; i < 400; i ++ ) {

		const sphere = new THREE.Mesh(
			new THREE.SphereGeometry( 1, 32, 32 ),
			new THREE.MeshBasicMaterial()
		);
		sphere.position.set(
			Math.random() - 0.5,
			Math.random() - 0.5,
			Math.random() - 0.5
		).multiplyScalar( 70 );
		sphere.scale.setScalar( Math.random() * 0.3 + 0.1 );
		group.add( sphere );

	}

	bvhGenerationWorker = new GenerateMeshBVHWorker();

	gui = new GUI();
	const helperFolder = gui.addFolder( 'helper' );
	helperFolder.add( params, 'displayHelper' ).name( 'enabled' ).onChange( v => {

		if ( v && helper ) {

			helper.update();

		}

	} );
	helperFolder.add( params, 'helperDepth', 1, 50, 1 ).onChange( v => {

		if ( helper ) {

			helper.depth = v;
			helper.update();

		}

	} );
	helperFolder.open();

	const knotFolder = gui.addFolder( 'knot' );
	knotFolder.add( params, 'useWebWorker' );
	knotFolder.add( params, 'radius', 0.5, 2, 0.01 );
	knotFolder.add( params, 'tube', 0.2, 1.2, 0.01 );
	knotFolder.add( params, 'tubularSegments', 50, 2000, 1 );
	knotFolder.add( params, 'radialSegments', 5, 2000, 1 );
	knotFolder.add( params, 'p', 1, 10, 1 );
	knotFolder.add( params, 'q', 1, 10, 1 );
	knotFolder.add( { regenerateKnot }, 'regenerateKnot' ).name( 'regenerate' );
	knotFolder.open();

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
		group.remove( knot );
		group.remove( helper );

	}

	const stallStartTime = window.performance.now();
	const geomStartTime = window.performance.now();
	knot = new THREE.Mesh(
		new THREE.TorusKnotGeometry(
			params.radius,
			params.tube,
			params.tubularSegments,
			params.radialSegments,
			params.p,
			params.q
		),
		new THREE.MeshStandardMaterial( {
			color: new THREE.Color( 0x4db6ac ).convertSRGBToLinear(),
			roughness: 0.75

		} )
	);
	const geomTime = window.performance.now() - geomStartTime;
	const startTime = window.performance.now();
	let totalStallTime;
	if ( params.useWebWorker ) {

		const onProgress = v => {

			const perc = ( v * 100 ).toFixed( 0 );
			loadContainer.style.visibility = 'visible';
			loadBar.style.width = `${ perc }%`;
			loadText.innerText = `${ perc }%`;

		};

		bvhGenerationWorker.generate( knot.geometry, { onProgress } ).then( bvh => {

			loadContainer.style.visibility = 'hidden';

			knot.geometry.boundsTree = bvh;
			group.add( knot );

			const deltaTime = window.performance.now() - startTime;
			generating = false;

			helper = new MeshBVHVisualizer( knot, 0 );
			helper.depth = params.helperDepth;

			if ( params.displayHelper ) {

				helper.update();

			}

			group.add( helper );

			outputContainer.textContent =
				`Geometry Generation Time : ${ geomTime.toFixed( 3 ) }ms\n` +
				`BVH Generation Time : ${ deltaTime.toFixed( 3 ) }ms\n` +
				`Frame Stall Time : ${ totalStallTime.toFixed( 3 ) }`;

		} );

		totalStallTime = window.performance.now() - stallStartTime;

	} else {

		knot.geometry.boundsTree = new MeshBVH( knot.geometry );
		totalStallTime = window.performance.now() - stallStartTime;

		group.add( knot );

		const deltaTime = window.performance.now() - startTime;
		generating = false;

		helper = new MeshBVHVisualizer( knot );
		helper.depth = params.helperDepth;
		helper.update();
		group.add( helper );

		outputContainer.textContent =
			`Geometry Generation Time : ${ geomTime.toFixed( 3 ) }ms\n` +
			`BVH Generation Time : ${ deltaTime.toFixed( 3 ) }ms\n` +
			`Frame Stall Time : ${ totalStallTime.toFixed( 3 ) }`;

	}

}

function render() {

	stats.update();
	requestAnimationFrame( render );

	let delta = clock.getDelta();
	group.rotation.x += 0.4 * delta;
	group.rotation.y += 0.6 * delta;

	if ( helper ) {

		helper.visible = params.displayHelper;

	}

	renderer.render( scene, camera );

}
