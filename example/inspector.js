import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';

import { GUI } from 'dat.gui';
import {
	acceleratedRaycast, computeBoundsTree, disposeBoundsTree, MeshBVHVisualizer,
	SAH, CENTER, AVERAGE, getBVHExtremes, estimateMemoryInBytes,
} from '../src/index.js';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

let scene, camera, renderer, helper, mesh, outputContainer, benchmarkContainer;
let benchmarkViz, renderTarget, fsQuad;
let mouse = new THREE.Vector2();
const readBuffer = new Float32Array( 1 );

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

	visualization: {

		displayMesh: true,
		traversalThreshold: 50,
		boundsOpacity: 5 / 255,

	},

	benchmark: {

		displayRays: false,
		firstHitOnly: true,
		rotations: 10,
		castCount: 1000,

	}

};

class TraverseMaterial extends THREE.ShaderMaterial {

	constructor( params ) {

		super( {

			uniforms: {
				map: { value: null },
				threshold: { value: 35 },
				boundsOpacity: { value: 5 },
			},

			vertexShader: /* glsl */`
				varying vec2 vUv;
				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}
			`,

			fragmentShader: /* glsl */`
				uniform sampler2D map;
				uniform float threshold;
				uniform float boundsOpacity;
				varying vec2 vUv;
				void main() {

					float count = texture2D( map, vUv ).r;

					if ( count > threshold ) {

						gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );

					} else {

						gl_FragColor = vec4( boundsOpacity * count );
						gl_FragColor.a = 1.0;

					}

				}
			`,

		} );

		Object.defineProperties( this, {

			map: {

				get() {

					return this.uniforms.map.value;

				},
				set( v ) {

					this.uniforms.map.value = v;

				}

			},
			threshold: {

				get() {

					return this.uniforms.threshold.value;

				},
				set( v ) {

					this.uniforms.threshold.value = v;

				}

			},
			boundsOpacity: {

				get() {

					return this.uniforms.boundsOpacity.value;

				},
				set( v ) {

					this.uniforms.boundsOpacity.value = v;

				}

			}

		} );

		this.setValues( params );

	}

}

function init() {

	outputContainer = document.getElementById( 'output' );
	benchmarkContainer = document.getElementById( 'benchmark' );

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( 0, 1 );
	document.body.appendChild( renderer.domElement );

	// render target
	renderTarget = new THREE.WebGLRenderTarget( 1, 1, {
		format: THREE.RedFormat,
		// format: THREE.RedIntegerFormat,
		type: THREE.FloatType,
		// internalFormat: 'R16UI'
	} );

	fsQuad = new Pass.FullScreenQuad( new TraverseMaterial( {

		map: renderTarget.texture,
		depthWrite: false,

	} ) );

	// scene setup
	scene = new THREE.Scene();

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( - 2.5, 2.5, 2.5 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	new OrbitControls( camera, renderer.domElement );

	window.addEventListener( 'resize', onResize, false );
	onResize();

	// Load dragon
	const loader = new GLTFLoader();
	loader.load( modelPath, gltf => {

		gltf.scene.traverse( c => {

			if ( c.isMesh && c.name === 'Dragon' ) {

				mesh = c;

			}

		} );

		mesh.material = new THREE.MeshBasicMaterial( { colorWrite: false } );
		mesh.geometry.center();
		mesh.position.set( 0, 0, 0 );
		scene.add( mesh );

		helper = new MeshBVHVisualizer( mesh, 40 );
		helper.displayEdges = false;
		helper.displayParents = true;
		helper.color.set( 0xffffff );
		helper.opacity = 1;
		helper.depth = 40;
		window.HELPER = helper;

		const material = helper.meshMaterial;
		material.blending = THREE.CustomBlending;
		material.blendDst = THREE.OneFactor;

		scene.add( helper );

		updateBVH();

		runBenchmark( true );

	} );

	benchmarkViz = new THREE.LineSegments();
	benchmarkViz.material.opacity = 0.1;
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

	const vizFolder = gui.addFolder( 'Visualization' );
	vizFolder.add( params.visualization, 'displayMesh' );
	vizFolder.add( params.visualization, 'traversalThreshold', 1, 300, 1 );
	vizFolder.add( params.visualization, 'boundsOpacity', 0, 0.05, 0.001 );
	vizFolder.open();

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

	window.addEventListener( 'mousemove', e => {

		mouse.set( e.clientX, window.innerHeight - e.clientY );

	} );

}

function onResize() {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );

	renderTarget.setSize(
		window.innerWidth * window.devicePixelRatio,
		window.innerHeight * window.devicePixelRatio,
	);

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
		`construction time        : ${ deltaTime.toFixed( 2 ) }ms\n` +
		`surface area score       : ${ info.surfaceAreaScore.toFixed( 2 ) }\n` +
		`total nodes              : ${ info.nodeCount }\n` +
		`total leaf nodes         : ${ info.leafNodeCount }\n` +
		`surface area score       : ${ info.surfaceAreaScore.toFixed( 2 ) }\n` +
		`min / max tris per leaf  : ${ info.tris.min } / ${ info.tris.max }\n` +
		`min / max depth          : ${ info.depth.min } / ${ info.depth.max }\n` +
		`memory (incl. geometry)  : ${ ( estimateMemoryInBytes( mesh.geometry.boundsTree ) * 1e-6 ).toFixed( 3 ) } mb \n` +
		`memory (excl. geometry)  : ${ ( estimateMemoryInBytes( mesh.geometry.boundsTree._roots ) * 1e-6 ).toFixed( 3 ) } mb`;

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

		direction.set(
			Math.cos( rotations * 5 * y ),
			Math.sin( rotations * 10 * y ),
			Math.sin( rotations * 5 * y ),
		).sub( origin ).normalize();

		raycaster.intersectObject( mesh );

		if ( updateGeom ) {

			const hit = raycaster.intersectObject( mesh )[ 0 ];

			points.push( origin.clone() );
			if ( hit ) {

				points.push( hit.point.clone() );

			} else {

				const v = new THREE.Vector3();
				ray.at( 5, v );
				points.push( v );

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

	// read the buffer from the last frame of rendering so we don't block
	// waiting for this frame to finish.
	renderer.readRenderTargetPixels(
		renderTarget,
		mouse.x, mouse.y, 1, 1,
		readBuffer,
	);

	if ( mesh ) {

		sampleCount = Math.min( sampleCount + 1, 50 );
		currTime += ( runBenchmark() - currTime ) / sampleCount;
		benchmarkContainer.innerText =
			`\ntraversal depth at mouse : ${ Math.round( readBuffer[ 0 ] ) }\n` +
			`benchmark rolling avg    : ${ currTime.toFixed( 3 ) } ms`;

	}

	fsQuad.material.threshold = params.visualization.traversalThreshold;
	fsQuad.material.boundsOpacity = params.visualization.boundsOpacity;

	// render bvh
	benchmarkViz.visible = false;
	renderer.autoClear = true;
	if ( mesh ) mesh.visible = params.visualization.displayMesh;
	renderer.setRenderTarget( renderTarget );
	renderer.render( scene, camera );

	renderer.setRenderTarget( null );
	fsQuad.render( renderer );

	// render rays
	renderer.autoClear = false;
	benchmarkViz.visible = params.benchmark.displayRays;

	if ( mesh ) renderer.render( mesh, camera );
	renderer.render( benchmarkViz, camera );

}


init();
render();
