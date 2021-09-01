import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BufferGeometryUtils } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';

import { GUI } from 'dat.gui';
import {
	acceleratedRaycast,
	computeBoundsTree,
	disposeBoundsTree,
	SAH,
	MeshBVH,
} from '../src/index.js';
import '@babel/polyfill';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

let scene, camera, renderer, light, mesh, clock;
let fsQuad, controls, bvh, materials;
let raycaster, dataTexture, samples, ssPoint, color, task, delay;
const DELAY_TIME = 300;
const FADE_DELAY = 150;

const modelPath = '../models/DragonAttenuation.glb';
const params = {
	resolution: {
		resolutionScale: 2,
		smoothImageScaling: false,
		stretchImage: true,
	},
	pathTracing: {
		antialiasing: true,
		bounces: 5,
		raysPerHit: 1,
		directLightSampling: true,
		importanceSampling: true,
		focusDistance: 50,
		apertureSize: 0,
	},
	material: {
		color: '#ffffff',
		emissive: '#ffffff',
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
	renderer.outputEncoding = THREE.sRGBEncoding;
	renderer.domElement.style.position = 'absolute';
	renderer.domElement.style.left = '0';
	renderer.domElement.style.top = '0';
	renderer.domElement.style.right = '0';
	renderer.domElement.style.bottom = '0';
	renderer.domElement.style.margin = 'auto';
	document.body.style.width = '100vw';
	document.body.style.height = '100vh';
	document.body.appendChild( renderer.domElement );

	fsQuad = new Pass.FullScreenQuad( new THREE.MeshBasicMaterial() );
	fsQuad.material.transparent = true;

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

	controls = new OrbitControls( camera, renderer.domElement );

	controls.addEventListener( 'change', resetImage );

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

	raycaster = new THREE.Raycaster();
	ssPoint = new THREE.Vector3();
	samples = 0;
	color = new THREE.Color();
	clock = new THREE.Clock();

	const gui = new GUI();
	const resolutionFolder = gui.addFolder( 'resolution' );
	resolutionFolder.add( params.resolution, 'resolutionScale', 1, 5, 1 ).onChange( onResize );
	resolutionFolder.add( params.resolution, 'smoothImageScaling' ).onChange( onResize );
	resolutionFolder.add( params.resolution, 'stretchImage' ).onChange( onResize );
	resolutionFolder.open();

	const pathTracingFolder = gui.addFolder( 'path tracing' );
	pathTracingFolder.add( params.pathTracing, 'antialiasing' ).onChange( resetImage );
	pathTracingFolder.add( params.pathTracing, 'directLightSampling' ).onChange( resetImage );
	pathTracingFolder.add( params.pathTracing, 'importanceSampling' ).onChange( resetImage );
	pathTracingFolder.add( params.pathTracing, 'bounces', 1, 10, 1 ).onChange( resetImage );
	pathTracingFolder.add( params.pathTracing, 'raysPerHit', 1, 10, 1 ).onChange( resetImage );
	pathTracingFolder.add( params.pathTracing, 'apertureSize', 0, 0.1, 0.0001 ).onChange( resetImage );
	pathTracingFolder.add( params.pathTracing, 'focusDistance', 0.1, 5, 0.001 ).onChange( resetImage );
	pathTracingFolder.open();

	const materialFolder = gui.addFolder( 'material' );
	materialFolder.addColor( params.material, 'color' ).onChange( resetImage );
	materialFolder.addColor( params.material, 'emissive' ).onChange( resetImage );
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

	function resizeDataTexture( w, h ) {

		if ( ! dataTexture || dataTexture.image.width !== w || dataTexture.image.height !== h ) {

			if ( dataTexture ) {

				dataTexture.dispose();

			}

			dataTexture = new THREE.DataTexture( new Float32Array( w * h * 4 ), w, h, THREE.RGBAFormat, THREE.FloatType );
			resetImage();

		}

	}

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	const dpr = window.devicePixelRatio;
	const divisor = Math.pow( 2, parseFloat( params.resolution.resolutionScale ) - 1 );
	if ( params.resolution.stretchImage ) {

		renderer.setSize( window.innerWidth, window.innerHeight );
		renderer.setPixelRatio( dpr / divisor );
		resizeDataTexture(
			Math.floor( window.innerWidth * dpr / divisor ),
			Math.floor( window.innerHeight * dpr / divisor ),
		);

	} else {

		renderer.setSize(
			Math.floor( window.innerWidth / divisor ),
			Math.floor( window.innerHeight / divisor )
		);
		renderer.setPixelRatio( dpr );
		resizeDataTexture(
			Math.floor( window.innerWidth * dpr / divisor ),
			Math.floor( window.innerHeight * dpr / divisor ),
		);

	}

	renderer.domElement.style.imageRendering = params.resolution.smoothImageScaling ? 'auto' : 'pixelated';

}

function resetImage() {

	dataTexture.image.data.fill( 0 );
	dataTexture.needsUpdate = true;
	samples = 0;
	task = runPathTracing();
	delay = 0;

}

function getColorSample( point, camera, target ) {

	raycaster.setFromCamera( { x: point.x * 2 - 1, y: point.y * 2 - 1 }, camera );

	const hit = bvh.raycastFirst( raycaster.ray );
	if ( hit ) {

		target.set( 0xff0000 );
		target.r = hit.face.normal.x;
		target.g = hit.face.normal.y;
		target.b = hit.face.normal.z;

	} else {

		const direction = raycaster.ray.direction;
		const value = ( direction.y + 0.5 ) / 2.0;

		target.setRGB( value, value, value );

	}

}

function* runPathTracing() {

	let lastStartTime = performance.now();
	const { width, height, data } = dataTexture.image;
	while ( true ) {

		// TODO: make this a more predictable function (maybe based on a fixed poisson sampling)
		let randomOffsetX = 0;
		let randomOffsetY = 0;
		if ( params.pathTracing.antialiasing ) {

			randomOffsetX = ( Math.random() - 0.5 ) / width;
			randomOffsetY = ( Math.random() - 0.5 ) / height;

		}

		for ( let y = height - 1; y >= 0; y -- ) {

			for ( let x = 0; x < width; x ++ ) {

				ssPoint.set( randomOffsetX + x / ( width - 1 ), randomOffsetY + y / ( height - 1 ) );
				getColorSample( ssPoint, camera, color );

				const index = ( y * width + x ) * 4;
				if ( samples === 0 ) {

					data[ index + 0 ] = color.r;
					data[ index + 1 ] = color.g;
					data[ index + 2 ] = color.b;
					data[ index + 3 ] = 1.0;

				} else {

					// TODO: see if we can just accumulate and divide the total values out in a shader
					// to skip these calculations
					const r = data[ index + 0 ];
					const g = data[ index + 1 ];
					const b = data[ index + 2 ];
					data[ index + 0 ] += ( color.r - r ) / ( samples + 1 );
					data[ index + 1 ] += ( color.g - g ) / ( samples + 1 );
					data[ index + 2 ] += ( color.b - b ) / ( samples + 1 );

				}

				if ( performance.now() - lastStartTime > 16 ) {

					yield;
					lastStartTime = performance.now();

				}

			}

		}

		samples ++;

	}

}

function render() {

	requestAnimationFrame( render );

	scene.updateMatrixWorld( true );
	camera.updateMatrixWorld( true );
	if ( bvh ) {

		task.next();
		dataTexture.needsUpdate = true;

	}



	let fade = 0;
	if ( delay > FADE_DELAY ) {

		fade = Math.min( ( delay - FADE_DELAY ) / ( DELAY_TIME - FADE_DELAY ), 1.0 );

	}

	fsQuad.material.map = dataTexture;
	fsQuad.material.opacity = fade;

	renderer.render( scene, camera );
	renderer.autoClear = false;
	fsQuad.render( renderer );
	renderer.autoClear = true;

	if ( delay < DELAY_TIME ) {

		delay += clock.getDelta() * 1e3;

	}

}

