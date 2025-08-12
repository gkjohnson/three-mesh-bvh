import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'stats.js';
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/worker';
import { StaticGeometryGenerator } from 'three-mesh-bvh';
import { GenerateSDFMaterial } from './utils/GenerateSDFMaterial.js';
import { RenderSDFLayerMaterial } from './utils/RenderSDFLayerMaterial.js';
import { RayMarchSDFMaterial } from './utils/RayMarchSDFMaterial.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { WebGPURenderer, StorageBufferAttribute } from 'three/webgpu';

import { uniform, wgslFn, storage, globalId } from 'three/tsl';

import { closestPointToPoint } from 'three-mesh-bvh/webgpu';

const MAX_RESOLUTION = 200;
const MIN_RESOLUTION = 10;
const WORKGROUP_SIZE = [ 16, 16, 1 ];
const params = {

	generationMode: 'WebGL',
	resolution: 75,
	margin: 0.2,
	regenerate: () => updateSDF(),

	mode: 'raymarching',
	layer: 0,
	surface: 0.1,

};

let renderer, camera, scene, gui, stats, boxHelper;
let outputContainer, bvh, geometry, sdfTex, mesh;
let generateSdfPass, layerPass, raymarchPass;
let bvhGenerationWorker;
let webgpuRenderer, computeKernel, outputBuffer;
const inverseBoundsMatrix = new THREE.Matrix4();

init().then( render );

async function init() {

	outputContainer = document.getElementById( 'output' );

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( 0, 0 );
	document.body.appendChild( renderer.domElement );

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

	// sdf pass to generate the 3d texture
	generateSdfPass = new FullScreenQuad( new GenerateSDFMaterial() );

	// screen pass to render a single layer of the 3d texture
	layerPass = new FullScreenQuad( new RenderSDFLayerMaterial() );

	// screen pass to render the sdf ray marching
	raymarchPass = new FullScreenQuad( new RayMarchSDFMaterial() );

	// load model and generate bvh
	bvhGenerationWorker = new GenerateMeshBVHWorker();

	await new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/stanford-bunny/bunny.glb' )
		.then( gltf => {

			gltf.scene.updateMatrixWorld( true );

			const staticGen = new StaticGeometryGenerator( gltf.scene );
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

	webgpuRenderer = new WebGPURenderer( {
		forceWebGL: false,
	} );

	const geom_index = new StorageBufferAttribute( mesh.geometry.index.array, 3 );
	const geom_position = new StorageBufferAttribute( mesh.geometry.attributes.position.array, 3 );
	const bvhNodes = new StorageBufferAttribute( new Float32Array( bvh._roots[ 0 ] ), 8 );
	outputBuffer = new StorageBufferAttribute( new Float32Array( MAX_RESOLUTION ** 3 ), 1 );

	const computeShaderParams = {
		matrix: uniform( new THREE.Matrix4() ),
		dim: uniform( 0 ),

		bvh_index: storage( geom_index, 'uvec3', geom_index.count ).toReadOnly(),
		bvh_position: storage( geom_position, 'vec3', geom_position.count ).toReadOnly(),
		bvh: storage( bvhNodes, 'BVHNode', bvhNodes.count ).toReadOnly(),

		globalId: globalId,
		output: storage( outputBuffer ),
	};

	const computeShader = wgslFn( /* wgsl */ `

		fn computeSdf( 
			bvh_index: ptr<storage, array<vec3u>, read>,
			bvh_position: ptr<storage, array<vec3f>, read>,
			bvh: ptr<storage, array<BVHNode>, read>,

			matrix: mat4x4f,
			dim: u32,
			globalId: vec3u,

			output: ptr<storage, array<f32>, read_write>,
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

			let index = globalId.x + globalId.y * dim + globalId.z * dim * dim;
			output[index] = res.side * sqrt( res.distanceSq );
		}

	`, [ closestPointToPoint ] );

	computeKernel = computeShader( computeShaderParams ).computeKernel( WORKGROUP_SIZE );

	rebuildGUI();

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

}

// build the gui with parameters based on the selected display mode
function rebuildGUI() {

	if ( gui ) {

		gui.destroy();

	}

	params.layer = Math.min( params.resolution, params.layer );

	gui = new GUI();

	const generationFolder = gui.addFolder( 'generation' );
	const generationOptions = [ 'CPU', 'WebGL' ];
	if ( webgpuRenderer?.backend?.isWebGPUBackend ) {

		generationOptions.push( 'WebGPU' );

	}

	generationFolder.add( params, 'generationMode', generationOptions );
	generationFolder.add( params, 'resolution', MIN_RESOLUTION, MAX_RESOLUTION, 1 );
	generationFolder.add( params, 'margin', 0, 1 );
	generationFolder.add( params, 'regenerate' );

	const displayFolder = gui.addFolder( 'display' );
	displayFolder.add( params, 'mode', [ 'geometry', 'raymarching', 'layer', 'grid layers' ] ).onChange( () => {

		rebuildGUI();

	} );

	if ( params.mode === 'layer' ) {

		displayFolder.add( params, 'layer', 0, params.resolution, 1 );

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

	// dispose of the existing sdf
	if ( sdfTex ) {

		sdfTex.dispose();

	}

	const pxWidth = 1 / dim;
	const halfWidth = 0.5 * pxWidth;

	const startTime = window.performance.now();
	switch ( params.generationMode ) {

		case 'WebGL': {

			// create a new 3d render target texture
			const floatLinearExtSupported = renderer.extensions.get( 'OES_texture_float_linear' );
			sdfTex = new THREE.WebGL3DRenderTarget( dim, dim, dim );
			sdfTex.texture.format = THREE.RedFormat;
			sdfTex.texture.type = floatLinearExtSupported ? THREE.FloatType : THREE.HalfFloatType;
			sdfTex.texture.minFilter = THREE.LinearFilter;
			sdfTex.texture.magFilter = THREE.LinearFilter;
			renderer.initRenderTarget( sdfTex );

			// prep the sdf generation material pass
			generateSdfPass.material.uniforms.bvh.value.updateFrom( bvh );
			generateSdfPass.material.uniforms.matrix.value.copy( matrix );

			// create a 2d render target to render in to
			const scratchVec = new THREE.Vector3();
			const scratchTarget = new THREE.WebGLRenderTarget( dim, dim );
			scratchTarget.texture.format = THREE.RedFormat;
			scratchTarget.texture.type = floatLinearExtSupported ? THREE.FloatType : THREE.HalfFloatType;

			// render into each layer
			for ( let i = 0; i < dim; i ++ ) {

				generateSdfPass.material.uniforms.zValue.value = i * pxWidth + halfWidth;

				renderer.setRenderTarget( scratchTarget );
				generateSdfPass.render( renderer );

				// copy the data into the 3d texture since rendering directly into the target causes significant gpu artifacts
				// See issue #720
				scratchVec.z = i;
				renderer.copyTextureToTexture( scratchTarget.texture, sdfTex.texture, null, scratchVec );

			}

			// initiate read back to get a rough estimate of time taken to generate the sdf
			renderer.readRenderTargetPixels( scratchTarget, 0, 0, 1, 1, new Float32Array( 4 ) );
			renderer.setRenderTarget( null );
			scratchTarget.dispose();
			break;

		}

		case 'CPU': {

			// create a new 3d data texture
			sdfTex = new THREE.Data3DTexture( new Float32Array( dim ** 3 ), dim, dim, dim );
			sdfTex.format = THREE.RedFormat;
			sdfTex.type = THREE.FloatType;
			sdfTex.minFilter = THREE.LinearFilter;
			sdfTex.magFilter = THREE.LinearFilter;
			sdfTex.needsUpdate = true;

			const point = new THREE.Vector3();
			const ray = new THREE.Ray();
			const target = {};

			// iterate over all pixels and check distance
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

						// raycast inside the mesh to determine if the distance should be positive or negative
						ray.origin.copy( point );
						ray.direction.set( 0, 0, 1 );
						const hit = bvh.raycastFirst( ray, THREE.DoubleSide );
						const isInside = hit && hit.face.normal.dot( ray.direction ) > 0.0;

						// set the distance in the texture data
						sdfTex.image.data[ index ] = isInside ? - dist : dist;

					}

				}

			}

			break;

		}

		case 'WebGPU': {

			computeKernel.computeNode.parameters.matrix.value.copy( matrix );
			computeKernel.computeNode.parameters.dim.value = dim;

			const dispatchSize = [ Math.ceil( dim / 16 ), Math.ceil( dim / 16 ), dim ];
			webgpuRenderer.computeAsync( computeKernel, dispatchSize ).then( () => {

				return webgpuRenderer.getArrayBufferAsync( outputBuffer );

			} ).then( arrayBuf => {

				const result = new Float32Array( arrayBuf );

				// create a new 3d data texture
				sdfTex = new THREE.Data3DTexture( result, dim, dim, dim );
				sdfTex.format = THREE.RedFormat;
				sdfTex.type = THREE.FloatType;
				sdfTex.minFilter = THREE.LinearFilter;
				sdfTex.magFilter = THREE.LinearFilter;
				sdfTex.needsUpdate = true;

				const delta = window.performance.now() - startTime;
				outputContainer.innerText = `${ delta.toFixed( 2 ) }ms`;

			} );


			break;

		}

	}

	// update the timing display
	const delta = window.performance.now() - startTime;
	outputContainer.innerText = `${ delta.toFixed( 2 ) }ms`;

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

		// render a layer of the 3d texture
		let tex;
		const material = layerPass.material;
		if ( sdfTex.isData3DTexture ) {

			material.uniforms.layer.value = params.layer / sdfTex.image.width;
			material.uniforms.sdfTex.value = sdfTex;
			tex = sdfTex;

		} else {

			material.uniforms.layer.value = params.layer / sdfTex.width;
			material.uniforms.sdfTex.value = sdfTex.texture;
			tex = sdfTex.texture;

		}

		material.uniforms.layers.value = tex.image.width;

		const gridMode = params.mode === 'layer' ? 0 : 1;
		if ( gridMode !== material.defines.DISPLAY_GRID ) {

			material.defines.DISPLAY_GRID = gridMode;
			material.needsUpdate = true;

		}

		layerPass.render( renderer );

	} else if ( params.mode === 'raymarching' ) {

		// render the ray marched texture
		camera.updateMatrixWorld();
		mesh.updateMatrixWorld();

		let tex;
		if ( sdfTex.isData3DTexture ) {

			tex = sdfTex;

		} else {

			tex = sdfTex.texture;

		}

		const { width, depth, height } = tex.image;
		raymarchPass.material.uniforms.sdfTex.value = tex;
		raymarchPass.material.uniforms.normalStep.value.set( 1 / width, 1 / height, 1 / depth );
		raymarchPass.material.uniforms.surface.value = params.surface;
		raymarchPass.material.uniforms.projectionInverse.value.copy( camera.projectionMatrixInverse );
		raymarchPass.material.uniforms.sdfTransformInverse.value.copy( mesh.matrixWorld ).invert().premultiply( inverseBoundsMatrix ).multiply( camera.matrixWorld );
		raymarchPass.render( renderer );

	}

}
