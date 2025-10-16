import * as THREE from 'three/webgpu';
import { uniform, wgslFn, storage, globalId, storageTexture, } from 'three/tsl';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'stats.js';

import { GenerateMeshBVHWorker } from 'three-mesh-bvh/worker';
import { StaticGeometryGenerator } from 'three-mesh-bvh';
import { closestPointToPoint } from 'three-mesh-bvh/webgpu';

import { RayMarchSDFNodeMaterial } from './utils/RayMarchSDFNodeMaterial';
import { RenderSDFLayerNodeMaterial } from './utils/RenderSDFLayerNodeMaterial';

const WORKGROUP_SIZE = [ 4, 4, 4 ];
const params = {

	resolution: 75,
	margin: 0.2,
	regenerate: () => updateSDF(),

	mode: 'raymarching',
	layer: 0,
	surface: 0.1,

};

let renderer, camera, scene, gui, stats, boxHelper;
let outputContainer, bvh, geometry, sdfTex, mesh;
let layerPass, raymarchPass;
let bvhGenerationWorker;
let computeKernel;
const inverseBoundsMatrix = new THREE.Matrix4();

init().then( render );

async function init() {

	if ( Boolean( await navigator.gpu.requestAdapter() ) === false ) {

		document.body.appendChild( getErrorMessage() );

		throw new Error( 'No WebGPU support' );

	}

	outputContainer = document.getElementById( 'output' );

	// renderer setup
	renderer = new THREE.WebGPURenderer();
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( 0, 0 );
	document.body.appendChild( renderer.domElement );
	await renderer.init();

	// scene setup
	scene = new THREE.Scene();

	const light = new THREE.DirectionalLight( 0xffffff, 1 );
	light.position.set( 1, 1, 1 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xffffff, 0.2 ) );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 1, 1, 2 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	boxHelper = new THREE.Box3Helper( new THREE.Box3() );
	scene.add( boxHelper );

	new OrbitControls( camera, renderer.domElement );

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// load model and generate bvh
	bvhGenerationWorker = new GenerateMeshBVHWorker();

	const gltf = await new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/stanford-bunny/bunny.glb' );

	gltf.scene.updateMatrixWorld( true );

	const staticGen = new StaticGeometryGenerator( gltf.scene );
	staticGen.attributes = [ 'position', 'normal' ];
	staticGen.useGroups = false;

	geometry = staticGen.generate().center();

	bvh = await bvhGenerationWorker.generate( geometry, { maxLeafTris: 1 } );

	mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
	scene.add( mesh );

	const geom_index = new THREE.StorageBufferAttribute( mesh.geometry.index.array, 3 );
	const geom_position = new THREE.StorageBufferAttribute( mesh.geometry.attributes.position.array, 3 );
	const bvhNodes = new THREE.StorageBufferAttribute( new Float32Array( bvh._roots[ 0 ] ), 8 );

	const computeShaderParams = {
		matrix: uniform( new THREE.Matrix4() ),
		dim: uniform( 0 ),

		bvh_index: storage( geom_index, 'uvec3', geom_index.count ).toReadOnly(),
		bvh_position: storage( geom_position, 'vec3', geom_position.count ).toReadOnly(),
		bvh: storage( bvhNodes, 'BVHNode', bvhNodes.count ).toReadOnly(),

		globalId: globalId,
		output: storageTexture( sdfTex ),
	};

	const computeShader = wgslFn( /* wgsl */ `

		fn computeSdf(
			bvh_index: ptr<storage, array<vec3u>, read>,
			bvh_position: ptr<storage, array<vec3f>, read>,
			bvh: ptr<storage, array<BVHNode>, read>,

			matrix: mat4x4f,
			dim: u32,
			globalId: vec3u,

			output: texture_storage_3d<r32float, write>,
		) -> void {
			if (globalId.x >= dim) {
				return;
			}
			if (globalId.y >= dim) {
				return;
			}
			if (globalId.z >= dim) {
				return;
			}

			let pxWidth = 1.0 / f32(dim);
			let halfWidth = 0.5 * pxWidth;
			let pointHomo = vec4f(
				halfWidth + f32(globalId.x) * pxWidth - 0.5,
				halfWidth + f32(globalId.y) * pxWidth - 0.5,
				halfWidth + f32(globalId.z) * pxWidth - 0.5,
				1.0
			) * matrix;
			let point = pointHomo.xyz / pointHomo.w;

			let res = bvhClosestPointToPoint(bvh_index, bvh_position, bvh, point, 10000.0);
			let value = res.side * sqrt( res.distanceSq );

			let mipLevel = 0;
			textureStore(output, globalId, vec4f(value, 0.0, 0.0, 0.0));
		}

	`, [ closestPointToPoint ] );

	computeKernel = computeShader( computeShaderParams ).computeKernel( WORKGROUP_SIZE );

	rebuildGUI();

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

	updateSDF();

	layerPass = new FullScreenQuad( new RenderSDFLayerNodeMaterial( sdfTex ) );
	raymarchPass = new FullScreenQuad( new RayMarchSDFNodeMaterial( sdfTex ) );

}

// build the gui with parameters based on the selected display mode
function rebuildGUI() {

	if ( gui ) {

		gui.destroy();

	}

	params.layer = Math.min( params.resolution, params.layer );

	gui = new GUI();

	const generationFolder = gui.addFolder( 'generation' );

	generationFolder.add( params, 'resolution', 10, 200, 1 );
	generationFolder.add( params, 'margin', 0, 1 );
	generationFolder.add( params, 'regenerate' );

	const displayFolder = gui.addFolder( 'display' );
	displayFolder.add( params, 'mode', [ 'geometry', 'raymarching', 'layer', 'grid layers' ] ).onChange( () => {

		rebuildGUI();

	} );

	if ( params.mode === 'layer' ) {

		displayFolder.add( params, 'layer', 0, params.resolution - 1, 1 );

	}

	if ( params.mode === 'raymarching' ) {

		displayFolder.add( params, 'surface', - 0.2, 0.5 );

	}

}

// update the sdf texture based on the selected parameters
function updateSDF() {

	const dim = params.resolution;
	const matrix = new THREE.Matrix4();
	const center = new THREE.Vector3();
	const quat = new THREE.Quaternion();
	const scale = new THREE.Vector3();

	// compute the bounding box of the geometry including the margin which is used to
	// define the range of the SDF
	geometry.boundingBox.getCenter( center );
	scale.subVectors( geometry.boundingBox.max, geometry.boundingBox.min );
	scale.x += 2 * params.margin;
	scale.y += 2 * params.margin;
	scale.z += 2 * params.margin;
	matrix.compose( center, quat, scale );
	inverseBoundsMatrix.copy( matrix ).invert();

	// update the box helper
	boxHelper.box.copy( geometry.boundingBox );
	boxHelper.box.min.x -= params.margin;
	boxHelper.box.min.y -= params.margin;
	boxHelper.box.min.z -= params.margin;
	boxHelper.box.max.x += params.margin;
	boxHelper.box.max.y += params.margin;
	boxHelper.box.max.z += params.margin;

	// dispose and recreate storage 3D texture for this update
	if ( sdfTex ) {

		sdfTex.dispose();

	}

	sdfTex = new THREE.Storage3DTexture( dim, dim, dim );
	sdfTex.format = THREE.RedFormat;
	sdfTex.type = THREE.FloatType;
	sdfTex.generateMipmaps = false;
	sdfTex.needsUpdate = true;
	sdfTex.wrapR = THREE.ClampToEdgeWrapping;
	sdfTex.wrapS = THREE.ClampToEdgeWrapping;
	sdfTex.wrapT = THREE.ClampToEdgeWrapping;

	// Rebind compute and material nodes to the new texture
	if ( computeKernel ) {

		computeKernel.computeNode.parameters.output.value = sdfTex;

	}

	if ( layerPass ) {

		const mat = layerPass.material;
		mat.fragmentNode.parameters.sdf.value = sdfTex;
		mat.fragmentNode.parameters.sdf_sampler.node.value = sdfTex;

	}

	if ( raymarchPass ) {

		const mat = raymarchPass.material;
		mat.fragmentNode.parameters.sdf.value = sdfTex;
		mat.fragmentNode.parameters.sdf_sampler.node.value = sdfTex;

	}

	const startTime = window.performance.now();

	computeKernel.computeNode.parameters.matrix.value.copy( matrix );
	computeKernel.computeNode.parameters.dim.value = dim;

	const dispatchSize = [
		Math.ceil( dim / WORKGROUP_SIZE[ 0 ] ),
		Math.ceil( dim / WORKGROUP_SIZE[ 1 ] ),
		Math.ceil( dim / WORKGROUP_SIZE[ 2 ] ),
	];
	renderer.compute( computeKernel, dispatchSize );
	if ( renderer.backend.device !== null ) {

		renderer.backend.device.queue.onSubmittedWorkDone().then( () => {

			// update the timing display
			const endTime = window.performance.now();
			const delta = endTime - startTime;
			outputContainer.innerText = `${delta.toFixed( 2 )}ms`;

		} );

	}

	rebuildGUI();

}

function render() {

	stats.update();
	requestAnimationFrame( render );

	if ( ! sdfTex ) {

		// render nothing
		return;

	} else if ( params.mode === 'geometry' ) {

		// render the rasterized geometry
		renderer.render( scene, camera );

	} else if ( params.mode === 'layer' || params.mode === 'grid layers' ) {

		// // render a layer of the 3d texture
		// let tex;
		const material = layerPass.material;

		material.fragmentNode.parameters.layer.value = params.layer;
		material.fragmentNode.parameters.grid_mode.value = ( params.mode === 'grid layers' );

		layerPass.render( renderer );

	} else if ( params.mode === 'raymarching' ) {

		camera.updateMatrixWorld();
		mesh.updateMatrixWorld();

		const material = raymarchPass.material;

		material.fragmentNode.parameters.surface.value = params.surface;
		material.fragmentNode.parameters.normalStep.value.set( 1, 1, 1 ).divideScalar( params.resolution );
		material.fragmentNode.parameters.projectionInverse.value.copy( camera.projectionMatrixInverse );

		const sdfInv = new THREE.Matrix4()
			.copy( mesh.matrixWorld ).invert()
			.premultiply( inverseBoundsMatrix )
			.multiply( camera.matrixWorld );

		material.fragmentNode.parameters.sdfTransformInverse.value.copy( sdfInv );
		sdfInv.invert();
		material.fragmentNode.parameters.sdfTransform.value.copy( sdfInv );

		raymarchPass.render( renderer );

	}

}

function getErrorMessage() {

	const message = 'Your browser does not support <a href="https://gpuweb.github.io/gpuweb/" style="color:blue">WebGPU</a> yet';

	const element = document.createElement( 'div' );
	element.id = 'webgpumessage';
	element.style.fontFamily = 'monospace';
	element.style.fontSize = '13px';
	element.style.fontWeight = 'normal';
	element.style.textAlign = 'center';
	element.style.background = '#fff';
	element.style.color = '#000';
	element.style.padding = '1.5em';
	element.style.maxWidth = '400px';
	element.style.margin = '5em auto 0';

	element.innerHTML = message;

	return element;

}
