import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'stats.js';
import { GenerateMeshBVHWorker } from '../src/workers/GenerateMeshBVHWorker.js';
import { StaticGeometryGenerator } from '..';
import { GenerateSDFMaterial } from './utils/GenerateSDFMaterial.js';
import { RenderSDFLayerMaterial } from './utils/RenderSDFLayerMaterial.js';
import { RenderSDFMaterial } from './utils/RenderSDFMaterial.js';

// TODO
// fix rendering gpu sdf
// raymarching
// visuals
// use gltf model instead of torus knot
// comments

const params = {

	gpuGeneration: true,
	size: 50,
	margin: 0.1,
	regenerate: () => updateSDF(),

	mode: 'layer',
	layer: 0,

};

let renderer, camera, scene, gui, stats, boxHelper;
let outputContainer, bvh, geometry, sdfTex, mesh;
let sdfPass, layerPass, raymarchPass;
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

	boxHelper = new THREE.Box3Helper( new THREE.Box3() );
	scene.add( boxHelper );

	new OrbitControls( camera, renderer.domElement );

	clock = new THREE.Clock();

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	sdfPass = new FullScreenQuad( new GenerateSDFMaterial() );

	layerPass = new FullScreenQuad( new RenderSDFLayerMaterial() );

	raymarchPass = new FullScreenQuad( new RenderSDFMaterial() );

	bvhGenerationWorker = new GenerateMeshBVHWorker();

	// new GLTFLoader()
	// 	.loadAsync( 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Suzanne/glTF/Suzanne.gltf' )
	// 	.then( gltf => {

	// 		const staticGen = new StaticGeometryGenerator( gltf.scene );
	// 		staticGen.attributes = [ 'position', 'normal' ];
	// 		staticGen.useGroups = false;

	// 		geometry = staticGen.generate().center();

	// 		return bvhGenerationWorker.generate( geometry, { maxLeafTris: 1 } );

	// 	} )
	// 	.then( result => {

	// 		bvh = result;

	// 		const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
	// 		scene.add( mesh );

	// 		updateSDF();

	// 	} );

	Promise.resolve()
		.then( () => {

			const scene = new THREE.Scene();
			const mesh = new THREE.Mesh(
				new THREE.TorusKnotGeometry(),
				new THREE.MeshStandardMaterial(),
			);
			scene.add( mesh );

			const staticGen = new StaticGeometryGenerator( scene );
			staticGen.attributes = [ 'position', 'normal' ];
			staticGen.useGroups = false;

			geometry = staticGen.generate().center();

			return bvhGenerationWorker.generate( geometry, { maxLeafTris: 1 } );

		} )
		.then( result => {

			bvh = result;

			mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
			scene.add( mesh );

			updateSDF();

		} );

	rebuildGUI();

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

}

function rebuildGUI() {

	if ( gui ) {

		gui.destroy();

	}

	params.layer = 0;

	gui = new GUI();

	const generationFolder = gui.addFolder( 'generation' );
	generationFolder.add( params, 'gpuGeneration' );
	generationFolder.add( params, 'size', 10, 200, 1 );
	generationFolder.add( params, 'margin', 0, 1 );
	generationFolder.add( params, 'regenerate' );

	const displayFolder = gui.addFolder( 'display' );
	displayFolder.add( params, 'mode', [ 'geometry', 'raymarching', 'layer' ] );
	displayFolder.add( params, 'layer', 0, params.size, 1 );

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
	matrix.compose( center, quat, scale );

	boxHelper.box.copy( geometry.boundingBox );
	boxHelper.box.min.x -= params.margin;
	boxHelper.box.min.y -= params.margin;
	boxHelper.box.min.z -= params.margin;
	boxHelper.box.max.x += params.margin;
	boxHelper.box.max.y += params.margin;
	boxHelper.box.max.z += params.margin;

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
		sdfTex.needsUpdate = true;

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

					// adjust by half width of the pixel so we sample the pixel center
					// and offset by half the box size.
					point.set(
						halfWidth + x * pxWidth - 0.5,
						halfWidth + y * pxWidth - 0.5,
						halfWidth + z * pxWidth - 0.5,
					).applyMatrix4( matrix );

					const index = x + y * dim + z * dim * dim;
					const dist = bvh.closestPointToPoint( point, target ).distance;

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

	rebuildGUI();

}

function render() {

	stats.update();
	requestAnimationFrame( render );

	if ( ! sdfTex ) {

		return;

	} else if ( params.mode === 'geometry' ) {

		renderer.render( scene, camera );

	} else if ( params.mode === 'layer' ) {

		if ( sdfTex.isData3DTexture ) {

			layerPass.material.uniforms.layer.value = params.layer / sdfTex.image.width;
			layerPass.material.uniforms.sdfTex.value = sdfTex;

		} else {

			layerPass.material.uniforms.layer.value = params.layer / sdfTex.width;
			layerPass.material.uniforms.sdfTex.value = sdfTex.texture;

		}

		layerPass.render( renderer );

	} else if ( params.mode === 'raymarching' ) {

		camera.updateMatrixWorld();
		mesh.updateMatrixWorld();

		raymarchPass.material.uniforms.sdfTex.value = sdfTex;
		raymarchPass.material.uniforms.projectionInverse.value.copy( camera.projectionMatrixInverse );
		raymarchPass.material.uniforms.sdfTransformInverse.value.copy( mesh.matrixWorld ).multiply( camera.matrixWorldInverse );

	}

}
