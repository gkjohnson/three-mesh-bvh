import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BufferGeometryUtils } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';

import { GUI } from 'dat.gui';
import {
	acceleratedRaycast, computeBoundsTree, disposeBoundsTree, MeshBVHVisualizer,
	SAH, CENTER, AVERAGE, getBVHExtremes, estimateMemoryInBytes, MeshBVH,
} from '../src/index.js';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

let scene, camera, renderer, light, mesh;
let renderTarget, fsQuad;
let bvh, materials;

const modelPath = '../models/DragonAttenuation.glb';
const params = {
	resolution: {
		resolutionScale: 2,
		smoothImageScaling: false,
		stretchImage: true,
	},
	pathTracing: {
		bounces: 5,
		directLightSampling: true,
		importanceSampling: true,
		focalLength: 50,
		apertureSize: 0,
	},
	material: {
		color: '#ffffff',
		roughness: 1.0,
		metalness: 0.0,
		ior: 1.5,
		transmission: 0.0,
	},
};

init();
render();

function init() {

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( 0, 1 );
	renderer.domElement.style.position = 'absolute';
	renderer.domElement.style.left = '50%';
	renderer.domElement.style.top = '50%';
	renderer.domElement.style.transform = 'translate(-50%, -50%)';
	document.body.appendChild( renderer.domElement );

	// render target
	renderTarget = new THREE.WebGLRenderTarget( 1, 1, {
		format: THREE.RedFormat,
		type: THREE.FloatType,

		// TODO: Use integer buffers once better supported in three.js
		// format: THREE.RedIntegerFormat,
		// type: THREE.UnsignedIntType,
		// internalFormat: 'R16UI'
	} );

	// fsQuad = new Pass.FullScreenQuad( new TraverseMaterial( {

	// 	map: renderTarget.texture,
	// 	depthWrite: false,

	// } ) );

	// scene setup
	scene = new THREE.Scene();

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( - 2.5, 1.5, 2.5 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	// light
	light = new THREE.DirectionalLight();
	light.position.set( 1, 1, 1 );
	// scene.add( light );

	light = new THREE.HemisphereLight( 0xffffff, 0x666666, 1 );
	scene.add( light );

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

		mesh.material = new THREE.MeshStandardMaterial();
		mesh.geometry.center().scale( 0.25, 0.25, 0.25 ).rotateX( Math.PI / 2 );
		mesh.position.set( 0, 0, 0 );
		mesh.scale.set( 1, 1, 1 );
		mesh.quaternion.identity();

		const plane = new THREE.PlaneBufferGeometry();
		plane.rotateX( - Math.PI / 2 ).translate( 0, mesh.geometry.boundingBox.min.y, 0 ).scale( 10, 1, 10 );

		const ground = new THREE.Mesh(
			plane,
			new THREE.MeshStandardMaterial(),
		);

		const results = mergeMeshes( [ mesh, ground ], true );
		const merged = new THREE.Mesh( results.geometry, new THREE.MeshStandardMaterial() );
		scene.add( merged );

		bvh = new MeshBVH( results.geometry, { strategy: SAH, maxLeafTris: 1 } );
		materials = results.materials;

	} );

	const gui = new GUI();
	const resolutionFolder = gui.addFolder( 'resolution' );
	resolutionFolder.add( params.resolution, 'resolutionScale', 1, 5, 1 ).onChange( onResize );
	resolutionFolder.add( params.resolution, 'smoothImageScaling' ).onChange( onResize );
	resolutionFolder.add( params.resolution, 'stretchImage' ).onChange( onResize );
	resolutionFolder.open();

	const pathTracingFolder = gui.addFolder( 'path tracing' );
	pathTracingFolder.add( params.pathTracing, 'bounces', 1, 10, 1 ).onChange( resetImage );
	pathTracingFolder.add( params.pathTracing, 'directLightSampling' ).onChange( resetImage );
	pathTracingFolder.add( params.pathTracing, 'importanceSampling' ).onChange( resetImage );
	pathTracingFolder.add( params.pathTracing, 'apertureSize', 0, 0.1, 0.0001 ).onChange( resetImage );
	pathTracingFolder.add( params.pathTracing, 'focusDistance', 0.1, 5, 0.001 ).onChange( resetImage );
	pathTracingFolder.open();

	const materialFolder = gui.addFolder( 'material' );
	materialFolder.addColor( params.material, 'color' ).onChange( resetImage );
	materialFolder.add( params.material, 'roughness', 0, 1.0, 0.001 ).onChange( resetImage );
	materialFolder.add( params.material, 'metalness', 0, 1.0, 0.001 ).onChange( resetImage );
	materialFolder.add( params.material, 'transmission', 0, 1.0, 0.001 ).onChange( resetImage );
	materialFolder.add( params.material, 'ior', 0.5, 2.5, 0.001 ).onChange( resetImage );
	materialFolder.open();

	onResize();

}

function mergeMeshes( meshes, cloneGeometry = true ) {

	const transformedGeometry = [];
	const materials = [];
	for ( let i = 0, l = meshes.length; i < l; i ++ ) {

		const mesh = meshes[ i ];
		const originalGeometry = meshes[ i ].geometry;
		const geom = cloneGeometry ? originalGeometry.clone() : cloneGeometry;
		mesh.updateMatrixWorld();
		geom.applyMatrix4( mesh.matrixWorld );

		const vertexCount = geom.attributes.position.count;
		const materialIndexArray = new Uint8Array( vertexCount ).fill( i );
		geom.setAttribute( 'materialIndex', new THREE.BufferAttribute( materialIndexArray, 1, false ) );

		transformedGeometry.push( geom );
		materials.push( mesh.material );

	}

	const geometry = BufferGeometryUtils.mergeBufferGeometries( transformedGeometry, false );
	return { geometry, materials };

}

function onResize() {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	const divisor = Math.pow( 2, parseFloat( params.resolution.resolutionScale ) - 1 );
	if ( params.resolution.stretchImage ) {

		const mult = window.devicePixelRatio;
		renderer.setSize( window.innerWidth, window.innerHeight );
		renderer.setPixelRatio( mult / divisor );
		renderTarget.setSize(
			window.innerWidth * mult / divisor,
			window.innerHeight * mult / divisor,
		);

	} else {

		const mult = window.devicePixelRatio;
		renderer.setSize( Math.floor( window.innerWidth / divisor ), Math.floor( window.innerHeight / divisor ) );
		renderer.setPixelRatio( mult );
		renderTarget.setSize(
			window.innerWidth * mult / divisor,
			window.innerHeight * mult / divisor,
		);

	}

	renderer.domElement.style.imageRendering = params.resolution.smoothImageScaling ? 'auto' : 'pixelated';
	resetImage();

}

function resetImage() {

}

function getColorSample( point, camera, target ) {


}

function render() {

	requestAnimationFrame( render );

	renderer.render( scene, camera );

}

