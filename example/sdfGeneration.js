import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'stats.js';
import { GenerateMeshBVHWorker } from '../src/workers/GenerateMeshBVHWorker.js';
import { StaticGeometryGenerator } from '..';
import { GenerateSDFMaterial } from './utils/GenerateSDFMaterial.js';

const params = {

	gpuGeneration: true,
	size: 50,
	margin: 0.1,
	regenerate: () => updateSDF(),

};

let renderer, camera, scene, knot, clock, gui, helper, group, stats;
let outputContainer, loadContainer, loadBar, loadText, bvh, geometry, sdfTex, sdfPass;
let bvhGenerationWorker;

init();
render();

function init() {

	const bgColor = 0x111111;

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
	scene.fog = new THREE.Fog( 0x111111, 20, 60 );

	const light = new THREE.DirectionalLight( 0xffffff, 1 );
	light.position.set( 1, 1, 1 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xffffff, 0.2 ) );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 0, 0, 4 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	new OrbitControls( camera, renderer.domElement );

	clock = new THREE.Clock();

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	sdfPass = new FullScreenQuad( new GenerateSDFMaterial() );

	bvhGenerationWorker = new GenerateMeshBVHWorker();

	new GLTFLoader()
		.loadAsync( 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Suzanne/glTF/Suzanne.gltf' )
		.then( gltf => {

			const staticGen = new StaticGeometryGenerator( gltf.scene );
			staticGen.attributes = [ 'position', 'normal' ];
			staticGen.useGroups = false;

			geometry = staticGen.generate().center();

			return bvhGenerationWorker.generate( geometry, { maxLeafTris: 1 } );

		} )
		.then( result => {

			bvh = result;

			const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
			scene.add( mesh );

			updateSDF();

		} );

	gui = new GUI();

	const generation = gui.addFolder( 'generation' );
	generation.add( params, 'gpuGeneration' );
	generation.add( params, 'size', 10, 200, 1 );
	generation.add( params, 'margin', 0, 1 );
	generation.add( params, 'regenerate' );

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

}

function updateSDF() {

	const dim = params.size;
	const matrix = new THREE.Matrix4();
	const center = new THREE.Vector3();
	const quat = new THREE.Quaternion();
	const scale = new THREE.Vector3();

	geometry.boundingBox.getCenter( center );
	scale.subVectors( geometry.boundingBox.max, geometry.boundingBox.min );
	scale.x += params.margin;
	scale.y += params.margin;
	scale.z += params.margin;
	matrix.compose( center, quat, scale ).invert();

	if ( sdfTex ) {

		sdfTex.dispose();

	}

	const pxWidth = 1 / dim;
	const halfWidth = 0.5 * pxWidth;

	const startTime = window.performance.now();
	if ( params.gpuGeneration ) {

		sdfTex = new THREE.WebGL3DRenderTarget( dim, dim, dim );
		sdfTex.texture.format = THREE.RedFormat;
		sdfTex.texture.type = THREE.FloatType;
		sdfTex.texture.minFilter = THREE.LinearFilter;
		sdfTex.texture.magFilter = THREE.LinearFilter;

		sdfPass.material.uniforms.bvh.value.updateFrom( bvh );
		sdfPass.material.uniforms.matrix.value.copy( matrix );

		for ( let i = 0; i < dim; i ++ ) {

			sdfPass.material.uniforms.zValue.value = i * pxWidth + halfWidth;

			renderer.setRenderTarget( sdfTex, i );
			sdfPass.render( renderer );

		}

		// initiate readback to get a rough estimate of time taken to generate the sdf
		renderer.readRenderTargetPixels( sdfTex, 0, 0, 1, 1, new Float32Array( 4 ) );
		renderer.setRenderTarget( null );

	} else {

		sdfTex = new THREE.Data3DTexture( new Float32Array( dim ** 3 ), dim, dim, dim );
		sdfTex.format = THREE.RedFormat;
		sdfTex.type = THREE.FloatType;
		sdfTex.minFilter = THREE.LinearFilter;
		sdfTex.magFilter = THREE.LinearFilter;

		const posAttr = geometry.attributes.position;
		const indexAttr = geometry.index;
		const point = new THREE.Vector3();
		const normal = new THREE.Vector3();
		const delta = new THREE.Vector3();
		const target = {};
		const tri = new THREE.Triangle();
		for ( let x = 0; x < dim; x ++ ) {

			for ( let y = 0; y < dim; y ++ ) {

				for ( let z = 0; z < dim; z ++ ) {

					point.set(
						halfWidth + x * pxWidth - 0.5,
						halfWidth + y * pxWidth - 0.5,
						halfWidth + z * pxWidth - 0.5,
					).applyMatrix4( matrix );

					const index = x + y * dim + z * dim * dim;
					const dist = bvh.closestPointToPoint( point, target );

					// get the face normal to determine if the distance should be positive or negative
					const faceIndex = target.faceIndex;
					const i0 = indexAttr.getX( faceIndex * 3 + 0 );
					const i1 = indexAttr.getX( faceIndex * 3 + 1 );
					const i2 = indexAttr.getX( faceIndex * 3 + 2 );
					tri.setFromAttributeAndIndices( posAttr, i0, i1, i2 );
					tri.getNormal( normal );
					delta.subVectors( target.point, point );

					sdfTex.image.data[ index ] = normal.dot( delta ) > 0.0 ? - dist : dist;

				}

			}

		}

	}

	const delta = window.performance.now() - startTime;
	outputContainer.innerText = `${ delta.toFixed( 2 ) }ms`;

}

function render() {

	stats.update();
	requestAnimationFrame( render );

	if ( helper ) {

		helper.visible = params.displayHelper;

	}

	renderer.render( scene, camera );

}
