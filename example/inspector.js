import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GUI } from 'dat.gui';
import {
	acceleratedRaycast, computeBoundsTree, disposeBoundsTree, MeshBVHVisualizer,
	SAH, CENTER, AVERAGE, getBVHExtremes, estimateMemoryInBytes,
} from '../src/index.js';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

let scene, camera, renderer, helper, mesh, outputContainer, benchmarkContainer;
let benchmarkViz;

const modelPath = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/DragonAttenuation/glTF-Binary/DragonAttenuation.glb';
const params = {

	options: {
		strategy: SAH,
		maxLeafTris: 10,
		maxDepth: 40,
		rebuild: function () {

			updateBVH();

		},
	},

	benchmark: {

		displayRays: false,
		firstHitOnly: true,
		rotations: 10,
		castCount: 1000,

	}

};

function init() {

	outputContainer = document.getElementById( 'output' );
	benchmarkContainer = document.getElementById( 'benchmark' );

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( 0, 1 );
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( - 2.5, 2.5, 2.5 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	new OrbitControls( camera, renderer.domElement );

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

	// Load dragon
	const loader = new GLTFLoader();
	loader.load( modelPath, gltf => {

		gltf.scene.traverse( c => {

			if ( c.isMesh && c.name === 'Dragon' ) {

				mesh = c;

			}

		} );

		mesh.material = new THREE.MeshBasicMaterial( { color: 0 } );
		scene.add( mesh );

		helper = new MeshBVHVisualizer( mesh, 40 );
		helper.displayEdges = false;
		helper.displayParents = true;
		helper.color.set( 0xffffff );
		helper.opacity = 5 / 255;
		helper.depth = 40;
		scene.add( helper );

		updateBVH();

		runBenchmark( true );

	} );

	benchmarkViz = new THREE.LineSegments();
	benchmarkViz.material.opacity = 0.2;
	benchmarkViz.material.transparent = true;
	benchmarkViz.material.depthWrite = false;
	benchmarkViz.frustumCulled = false;
	scene.add( benchmarkViz );

	const gui = new GUI();
	const bvhFolder = gui.addFolder( 'BVH' );
	bvhFolder.add( params.options, 'strategy', { CENTER, AVERAGE, SAH } );
	bvhFolder.add( params.options, 'maxLeafTris', 1, 30, 1 );
	bvhFolder.add( params.options, 'maxDepth', 1, 40, 1 );
	bvhFolder.add( params.options, 'rebuild' );
	bvhFolder.open();

	const benchmarkFolder = gui.addFolder( 'Benchmark' );
	benchmarkFolder.add( params.benchmark, 'displayRays' );
	benchmarkFolder.add( params.benchmark, 'firstHitOnly' ).onChange( resetBenchmark );
	benchmarkFolder.add( params.benchmark, 'castCount', 100, 5000, 1 ).onChange( () => {

		resetBenchmark();
		runBenchmark( true );

	} );
	benchmarkFolder.add( params.benchmark, 'rotations', 1, 20, 1 ).onChange( () => {

		resetBenchmark();
		runBenchmark( true );

	} );
	benchmarkFolder.open();

}

function updateBVH() {

	const startTime = performance.now();
	mesh.geometry.computeBoundsTree( {
		strategy: parseInt( params.options.strategy ),
		maxLeafTris: params.options.maxLeafTris,
		maxDepth: params.options.maxDepth,
	} );
	const deltaTime = performance.now() - startTime;
	helper.update();

	resetBenchmark();

	const info = getBVHExtremes( mesh.geometry.boundsTree )[ 0 ];
	outputContainer.innerText =
		`construction time       : ${ deltaTime.toFixed( 2 ) }ms\n` +
		`surface area score      : ${ info.surfaceAreaScore.toFixed( 2 ) }\n` +
		`total nodes             : ${ info.nodeCount }\n` +
		`total leaf nodes        : ${ info.leafNodeCount }\n` +
		`surface area score      : ${ info.surfaceAreaScore.toFixed( 2 ) }\n` +
		`min / max tris per leaf : ${ info.tris.min } / ${ info.tris.max }\n` +
		`min / max depth         : ${ info.depth.min } / ${ info.depth.max }\n` +
		`memory (incl. geometry) : ${ ( estimateMemoryInBytes( mesh.geometry.boundsTree ) * 1e-6 ).toFixed( 3 ) } mb \n` +
		`memory (excl. geometry) : ${ ( estimateMemoryInBytes( mesh.geometry.boundsTree._roots ) * 1e-6 ).toFixed( 3 ) } mb`;

}

function runBenchmark( updateGeom = false ) {

	let points = null;
	let newGeometry = null;
	if ( updateGeom ) {

		mesh.updateMatrixWorld();
		newGeometry = new THREE.BufferGeometry();
		benchmarkViz.geometry.dispose();
		points = [];

	}

	const raycaster = new THREE.Raycaster();
	raycaster.firstHitOnly = params.benchmark.firstHitOnly;

	const rayCount = params.benchmark.castCount;
	const rotations = params.benchmark.rotations;
	const { ray } = raycaster;
	const { origin, direction } = ray;

	const startTime = performance.now();
	for ( let i = 0; i < rayCount; i ++ ) {

		const step = i / rayCount;
		const y = step - 0.5;
		origin.set(
			Math.cos( 0.75 * Math.PI * y ) * Math.sin( rotations * 2 * Math.PI * i / rayCount ),
			2 * y,
			Math.cos( 0.75 * Math.PI * y ) * Math.cos( rotations * 2 * Math.PI * i / rayCount ),
		).multiplyScalar( 2.5 );

		direction.copy( origin ).multiplyScalar( - 1 ).normalize();

		raycaster.intersectObject( mesh );

		if ( updateGeom ) {

			const hit = raycaster.intersectObject( mesh )[ 0 ];

			points.push( origin.clone() );
			if ( hit ) {

				points.push( hit.point.clone() );

			} else {

				points.push( new THREE.Vector3() );

			}

		}

	}

	const deltaTime = performance.now() - startTime;

	if ( updateGeom ) {

		newGeometry.setFromPoints( points );
		benchmarkViz.geometry = newGeometry;

	}

	return deltaTime;

}

let sampleCount = 0;
let currTime = 0;

function resetBenchmark() {

	sampleCount = 0;
	currTime = 0;

}

function render() {

	requestAnimationFrame( render );

	if ( mesh ) {

		sampleCount = Math.min( sampleCount + 1, 50 );
		currTime += ( runBenchmark() - currTime ) / sampleCount;
		benchmarkContainer.innerText = `\nbenchmark rolling avg   : ${ currTime.toFixed( 3 ) } ms`;

	}

	benchmarkViz.visible = params.benchmark.displayRays;

	renderer.render( scene, camera );

}


init();
render();
