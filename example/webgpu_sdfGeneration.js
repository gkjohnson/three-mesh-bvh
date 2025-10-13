import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'stats.js';
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/worker';
import { StaticGeometryGenerator } from 'three-mesh-bvh';
import { GenerateSDFMaterial } from './utils/GenerateSDFMaterial.js';
import { RenderSDFLayerMaterial } from './utils/RenderSDFLayerMaterial.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

import { uniform, wgslFn, storage, globalId, uv, varying, texture3D, positionGeometry, storageTexture, sampler, } from 'three/tsl';

import { closestPointToPoint } from 'three-mesh-bvh/webgpu';

const MAX_RESOLUTION = 200;
const MIN_RESOLUTION = 10;
const WORKGROUP_SIZE = [ 16, 16, 1 ];
const params = {

	gpuGeneration: true,
	resolution: 25,
	currentImageResolution: 25,
	margin: 0.2,
	regenerate: () => updateSDF(),

	mode: 'layer',
	layer: 0,
	surface: 0.1,

};

let renderer, camera, scene, gui, stats, boxHelper;
let outputContainer, bvh, geometry, sdfTex, mesh;
let layerPass, raymarchPass;
let sdfLayerMaterialFragmentShader;
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

	sdfTex = new THREE.Storage3DTexture( MAX_RESOLUTION, MAX_RESOLUTION, MAX_RESOLUTION );
	sdfTex.format = THREE.RedFormat;
	sdfTex.type = THREE.FloatType;
	sdfTex.generateMipmaps = false;
	sdfTex.needsUpdate = true;
	sdfTex.wrapR = THREE.ClampToEdgeWrapping;
	sdfTex.wrapS = THREE.ClampToEdgeWrapping;
	sdfTex.wrapT = THREE.ClampToEdgeWrapping;

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// screen pass to render the sdf ray marching
	// raymarchPass = new FullScreenQuad( new RayMarchSDFMaterial() );

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

		} );

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

	// screen pass to render a single layer of the 3d texture
	const sdfLayerMaterial = new THREE.NodeMaterial();

	const distToColor = wgslFn( /* wgsl */`
		fn distToColor(dist: f32) -> vec4f {
			if (dist > 0.0) {
				return vec4f(0.0, dist, 0.0, 1.0);
			} else {
				return vec4f(-dist, 0.0, 0.0, 1.0);
			}
		}
	` );

	const fragmentShaderParams = {
		dim: uniform( 0 ),
		layer: uniform( 0 ),
		grid_mode: uniform( false ),

		uv: varying( uv() ),
		sdf_sampler: sampler( sdfTex ),
		sdf: texture3D( sdfTex ),
	};
	sdfLayerMaterialFragmentShader = wgslFn( /* wgsl */ `

		fn layer(
			dim: u32,
			layer: u32,
			grid_mode: bool,

			uv: vec2f,
			sdf_sampler: sampler,
			sdf: texture_3d<f32>,
		) -> vec4f {
			let actualDimension = textureDimensions( sdf ).x;
			let scaleFactor = f32(dim) / f32(actualDimension);

			var texelCoords = vec3f(scaleFactor * uv, f32(layer) / f32(actualDimension));

			if (grid_mode) {
				let square_size = ceil(sqrt(f32(dim)));
				let max_image_offset = vec2f(square_size - 1.0, square_size - 1.0);
				let new_uv = uv * square_size;
				let image_offset = min(floor(new_uv), max_image_offset);
				let in_image_uv = new_uv - image_offset;
				let z_layer = image_offset.x + (square_size - 1 - image_offset.y) * square_size;
				if (z_layer >= f32(dim)) {
					return vec4f(0.0, 0.0, 0.0, 1.0);
				}
				texelCoords = vec3f(scaleFactor * in_image_uv, z_layer / f32(actualDimension));
			}
			let dist = textureSample(sdf, sdf_sampler, texelCoords).r;
			return distToColor(dist);
		}

	`, [ distToColor ] );

	const vertexShaderParams = {
		position: positionGeometry,
	};
	const fullScreenQuadVertex = wgslFn( /* wgsl */ `

		fn noop(position: vec4f) -> vec4f {
			return position;
		}

	` );
	sdfLayerMaterial.fragmentNode = sdfLayerMaterialFragmentShader( fragmentShaderParams );
	sdfLayerMaterial.vertexNode = fullScreenQuadVertex( vertexShaderParams );
	layerPass = new FullScreenQuad( sdfLayerMaterial );

	// screen pass to render the sdf ray marching (WGSL)
	const raymarchMaterial = new THREE.NodeMaterial();

	const raymarchFragmentParams = {
		surface: uniform( 0 ),
		dim: uniform( 0 ),
		normalStep: uniform( new THREE.Vector3() ),
		projectionInverse: uniform( new THREE.Matrix4() ),
		sdfTransformInverse: uniform( new THREE.Matrix4() ),
		sdfTransform: uniform( new THREE.Matrix4() ),

		uv: varying( uv() ),
		sdf_sampler: sampler( sdfTex ),
		sdf: texture3D( sdfTex ),
	};

	const rayBoxDistFn = wgslFn( /* wgsl */ `
		fn rayBoxDist(boundsMin: vec3f, boundsMax: vec3f, rayOrigin: vec3f, rayDir: vec3f) -> vec2f {
			let t0 = (boundsMin - rayOrigin) / rayDir;
			let t1 = (boundsMax - rayOrigin) / rayDir;
			let tmin = min(t0, t1);
			let tmax = max(t0, t1);

			let distA = max( max( tmin.x, tmin.y ), tmin.z );
			let distB = min( tmax.x, min( tmax.y, tmax.z ) );

			let distToBox = max( 0.0, distA );
			let distInsideBox = max( 0.0, distB - distToBox );
			return vec2f( distToBox, distInsideBox );
		}
	` );

	const raymarchFragmentShader = wgslFn( /* wgsl */ `
		fn raymarch(
			surface: f32,
			dim: u32,
			projectionInverse: mat4x4f,
			sdfTransformInverse: mat4x4f,
			sdfTransform: mat4x4f,
			normalStep: vec3f,

			uv: vec2f,
			sdf_sampler: sampler,
			sdf: texture_3d<f32>,
		) -> vec4f {
			const MAX_STEPS: i32 = 500;
			const SURFACE_EPSILON: f32 = 0.001;
			let actualDimension = textureDimensions( sdf ).x;
			let scaleFactor = f32(dim) / f32(actualDimension);

			let clipSpace = 2.0 * uv - vec2f( 1.0, 1.0 );

			let rayOrigin = vec3f( 0.0, 0.0, 0.0 );
			let homogenousDirection = projectionInverse * vec4f( clipSpace, -1.0, 1.0 );
			let rayDirection = normalize( homogenousDirection.xyz / homogenousDirection.w );

			let sdfRayOrigin = ( sdfTransformInverse * vec4f( rayOrigin, 1.0 ) ).xyz;
			let sdfRayDirection = normalize( ( sdfTransformInverse * vec4f( rayDirection, 0.0 ) ).xyz );

			let boxIntersectionInfo = rayBoxDist( vec3f( -0.5 ), vec3f( 0.5 ), sdfRayOrigin, sdfRayDirection );
			let distToBox = boxIntersectionInfo.x;
			let distInsideBox = boxIntersectionInfo.y;
			let intersectsBox = distInsideBox > 0.0;

			var color = vec4f( 0.0 );

			if ( intersectsBox ) {

				var intersectsSurface = false;
				var localPoint = vec4f( sdfRayOrigin + sdfRayDirection * ( distToBox + 1e-5 ), 1.0 );
				var point = sdfTransform * localPoint;

				for ( var i: i32 = 0; i < MAX_STEPS; i = i + 1 ) {

					let uv3 = ( sdfTransformInverse * point ).xyz + vec3f( 0.5 );

					if ( uv3.x < 0.0 || uv3.x > 1.0 || uv3.y < 0.0 || uv3.y > 1.0 || uv3.z < 0.0 || uv3.z > 1.0 ) {
						break;
					}

					let distanceToSurface = textureSample( sdf, sdf_sampler, scaleFactor * uv3 ).r - surface;
					if ( distanceToSurface < SURFACE_EPSILON ) {
						intersectsSurface = true;
						break;
					}

					point = vec4f(point.xyz + rayDirection * distanceToSurface, point.w);
				}

				if ( intersectsSurface ) {

					let uv3 = ( sdfTransformInverse * point ).xyz + vec3f( 0.5 );

					let dx = textureSample( sdf, sdf_sampler, scaleFactor * (uv3 + vec3f( normalStep.x, 0.0, 0.0 )) ).r
						   - textureSample( sdf, sdf_sampler, scaleFactor * (uv3 - vec3f( normalStep.x, 0.0, 0.0 )) ).r;

					let dy = textureSample( sdf, sdf_sampler, scaleFactor * (uv3 + vec3f( 0.0, normalStep.y, 0.0 )) ).r
						   - textureSample( sdf, sdf_sampler, scaleFactor * (uv3 - vec3f( 0.0, normalStep.y, 0.0 )) ).r;

					let dz = textureSample( sdf, sdf_sampler, scaleFactor * (uv3 + vec3f( 0.0, 0.0, normalStep.z )) ).r
						   - textureSample( sdf, sdf_sampler, scaleFactor * (uv3 - vec3f( 0.0, 0.0, normalStep.z )) ).r;

					let normal = normalize( vec3f( dx, dy, dz ) );

					let lightDirection = normalize( vec3f( 1.0, 1.0, 1.0 ) );
					let lightIntensity =
						saturate( dot( normal, lightDirection ) ) +
						saturate( dot( normal, -lightDirection ) ) * 0.05 +
						0.1;

					color = vec4f( vec3f( lightIntensity ), 1.0 );
				}
			}

			return color;
		}
	`, [ rayBoxDistFn ] );

	raymarchMaterial.fragmentNode = raymarchFragmentShader( raymarchFragmentParams );
	raymarchMaterial.vertexNode = fullScreenQuadVertex( vertexShaderParams );
	raymarchPass = new FullScreenQuad( raymarchMaterial );

}

// build the gui with parameters based on the selected display mode
function rebuildGUI() {

	if ( gui ) {

		gui.destroy();

	}

	params.layer = Math.min( params.resolution, params.layer );

	gui = new GUI();

	const generationFolder = gui.addFolder( 'generation' );

	generationFolder.add( params, 'gpuGeneration' );
	generationFolder.add( params, 'resolution', MIN_RESOLUTION, MAX_RESOLUTION, 1 );
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

	// dispose of the existing sdf
	// if ( sdfTex ) {

	// 	sdfTex.dispose();

	// }

	const pxWidth = 1 / dim;
	const halfWidth = 0.5 * pxWidth;

	const startTime = window.performance.now();
	if ( params.gpuGeneration ) {

		computeKernel.computeNode.parameters.matrix.value.copy( matrix );
		computeKernel.computeNode.parameters.dim.value = dim;

		const dispatchSize = [
			Math.ceil( dim / WORKGROUP_SIZE[ 0 ] ),
			Math.ceil( dim / WORKGROUP_SIZE[ 1 ] ),
			Math.ceil( dim / WORKGROUP_SIZE[ 2 ] ),
		];
		renderer.computeAsync( computeKernel, dispatchSize ).then( () => {

			const delta = window.performance.now() - startTime;
			outputContainer.innerText = `${ delta.toFixed( 2 ) }ms`;

		} );

	} else {

		const data = new Float32Array( dim ** 3 );

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
					data[ index ] = isInside ? - dist : dist;

				}

			}

		}

		// create a new 3d data texture
		// TODO: figure out how to load the texture to the gpu
		// sdfTex = new THREE.Texture( data, dim, dim, dim );
		// sdfTex.format = THREE.RedFormat;
		// sdfTex.type = THREE.FloatType;
		// sdfTex.needsUpdate = true;

	}

	params.currentImageResolution = params.resolution;
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

		// // render a layer of the 3d texture
		// let tex;
		const material = layerPass.material;

		material.fragmentNode.parameters.dim.value = params.currentImageResolution;
		material.fragmentNode.parameters.layer.value = params.layer;
		material.fragmentNode.parameters.grid_mode.value = ( params.mode === 'grid layers' );
		// material.uniforms.layer.value = params.layer / sdfTex.width;
		// material.uniforms.sdfTex.value = sdfTex.texture;
		// tex = sdfTex.texture;

		// material.uniforms.layers.value = tex.image.width;

		// const gridMode = params.mode === 'layer' ? 0 : 1;
		// if ( gridMode !== material.defines.DISPLAY_GRID ) {

		// 	material.defines.DISPLAY_GRID = gridMode;
		// 	material.needsUpdate = true;

		// }

		layerPass.render( renderer );

	} else if ( params.mode === 'raymarching' ) {

		// render the ray marched texture (WGSL)
		camera.updateMatrixWorld();
		mesh.updateMatrixWorld();

		const material = raymarchPass.material;

		// uniforms
		material.fragmentNode.parameters.surface.value = params.surface;
		material.fragmentNode.parameters.dim.value = params.currentImageResolution;
		material.fragmentNode.parameters.normalStep.value.set( 1, 1, 1 ).divideScalar( params.currentImageResolution );
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
