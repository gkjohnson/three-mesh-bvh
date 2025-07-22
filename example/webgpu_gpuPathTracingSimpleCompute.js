import * as THREE from 'three';
import { WebGPURenderer, StorageBufferAttribute, StorageTexture, MeshBasicNodeMaterial } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import Stats from 'three/addons/libs/stats.module.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import {
	attribute, uniform, wgslFn, varyingProperty, textureStore, texture, colorSpaceToWorking,
	storage, cameraProjectionMatrix, modelWorldMatrix, cameraViewMatrix, workgroupId, localId
} from 'three/tsl';
import { MeshBVH, SAH } from '../src/index.js';
import { intersectsBVHNodeBounds, intersectsBounds, ndcToCameraRay, normalSampleBarycoord } from '../src/gpu/wgsl/common_functions.wgsl.js';
import { intersectsTriangle, intersectTriangles, bvhIntersectFirstHit } from '../src/gpu/wgsl/bvh_ray_functions.wgsl.js';

const params = {
	enableRaytracing: true,
	animate: true,
	resolutionScale: 1.0 / window.devicePixelRatio,
	smoothNormals: true,
};

let renderer, camera, scene, gui, stats;
let rtQuad, mesh, clock;
let rtMaterial, computeBVH;
let dispatchSize = [];

init();

async function init() {

	renderer = new WebGPURenderer( {

		canvas: document.createElement( 'canvas' ),
		antialias: true,
		forceWebGL: false,

	} );
	renderer.setAnimationLoop( render );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setClearColor( 0x09141a );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	document.body.appendChild( renderer.domElement );

	await renderer.init();

	// scene setup
	scene = new THREE.Scene();

	const light = new THREE.DirectionalLight( 0xffffff, 1 );
	light.position.set( 1, 1, 1 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xb0bec5, 0.5 ) );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 0, 0, 4 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	const knotGeometry = new THREE.TorusKnotGeometry( 1, 0.3, 300, 50 );

	const bvh = new MeshBVH( knotGeometry, { maxLeafTris: 1, strategy: SAH } );


	mesh = new THREE.Mesh( knotGeometry, new THREE.MeshStandardMaterial() );
	scene.add( mesh );

	clock = new THREE.Clock();

	//------------------------end-threejs-setup-start-example-code-----------------------------------

	const vUv = varyingProperty( 'vec2', 'vUv' );

	const bvh_position = new StorageBufferAttribute( knotGeometry.attributes.position.array, 3 );
	const bvh_index = new StorageBufferAttribute( knotGeometry.index.array, 3 );
	const bvhNodes = new StorageBufferAttribute( new Float32Array( bvh._roots[ 0 ] ), 8 );
	const normals = new StorageBufferAttribute( knotGeometry.attributes.normal.array, 3 );

	const width = Math.ceil( window.innerWidth );
	const height = Math.ceil( window.innerHeight );

	const rayTex = new StorageTexture( width, height );
	rayTex.format = THREE.RGBAFormat;
	rayTex.type = THREE.UnsignedByteType;
	rayTex.magFilter = THREE.LinearFilter;

	const workgroupSize = [ 16, 16, 1 ];

	dispatchSize = [
		Math.ceil( width / workgroupSize[ 0 ] ),
		Math.ceil( height / workgroupSize[ 1 ] ),
		1,
	];

	const computeShaderParams = {
		writeTex: textureStore( rayTex ),
		invProjectionMatrix: uniform( new THREE.Matrix4() ),
		cameraWorldMatrix: uniform( new THREE.Matrix4() ),
		invModelMatrix: uniform( new THREE.Matrix4() ),
		bvh_position: storage( bvh_position, 'vec3', bvh_position.count ).toReadOnly(),
		bvh_index: storage( bvh_index, 'uvec3', bvh_index.count ).toReadOnly(),
		bvh: storage( bvhNodes, 'BVHNode', bvhNodes.count ).toReadOnly(),
		normals: storage( normals, 'vec3', normals.count ).toReadOnly(),
		workgroupSize: uniform( new THREE.Vector3().fromArray( workgroupSize ) ),
		workgroupId: workgroupId,
		localId: localId
	};

	const vertexShaderParams = {
		projectionMatrix: cameraProjectionMatrix,
		modelWorldMatrix: modelWorldMatrix,
		cameraViewMatrix: cameraViewMatrix,
		position: attribute( 'position' ),
		uv: attribute( 'uv' ),
	};

	const fragmentShaderParams = {
		vUv: vUv,
		rayTex: texture( rayTex ),
		sample: texture( rayTex ),
	};


	const computeShader = wgslFn( /* wgsl */`

		fn compute(
			writeTex: texture_storage_2d<rgba8unorm, write>,
			invProjectionMatrix: mat4x4<f32>,
			cameraWorldMatrix: mat4x4<f32>,
			invModelMatrix: mat4x4<f32>,
			bvh_position: ptr<storage, array<vec3<f32>>, read>,
			bvh_index: ptr<storage, array<vec3<u32>>, read>,
			bvh: ptr<storage, array<BVHNode>, read>,
			normals: ptr<storage, array<vec3<f32>>, read>,
			workgroupSize: vec3<u32>,
			workgroupId: vec3<u32>,
			localId: vec3<u32>,
		) -> void {

			let dimensions = textureDimensions( writeTex );
			let indexUV = workgroupSize.xy * workgroupId.xy + localId.xy;

			let uv = vec2f( f32( indexUV.x ) / f32( dimensions.x ), f32( indexUV.y ) / f32( dimensions.y ) );

			let ndc = uv * 2.0 - vec2<f32>( 1.0, 1.0 );

			let ray = ndcToCameraRay( ndc, invModelMatrix * cameraWorldMatrix, invProjectionMatrix );

			let hitResult = bvhIntersectFirstHit( bvh_index, bvh_position, bvh, ray.origin, ray.direction );

			let normal = normalSampleBarycoord(
				hitResult.barycoord,
				hitResult.faceIndices.xyz,
				normals
			);

			let result = select(
				vec4<f32>( 0.0366, 0.0813, 0.1057, 1.0 ),
				vec4<f32>( normal, 1.0 ),
				hitResult.didHit
			);

			textureStore( writeTex, indexUV, result );

		}

		const BVH_STACK_DEPTH: u32 = 60u;
		const INFINITY: f32 = 1e20;
		const TRI_INTERSECT_EPSILON: f32 = 1e-5;

		struct Ray {

			origin: vec3<f32>,
			direction: vec3<f32>,

		};

		struct IntersectionResult {

			didHit: bool,
			faceIndices: vec4<u32>,
			faceNormal: vec3<f32>,
			barycoord: vec3<f32>,
			side: f32,
			dist: f32,

		};

		struct BVHNode {
			boundingBoxMin: array<f32, 3>,
			boundingBoxMax: array<f32, 3>,
			rightChildOrTriangleOffset: u32,
			splitAxisOrTriangleCount: u32,
		};

	`, [

		ndcToCameraRay, intersectsBVHNodeBounds, intersectsBounds,
		bvhIntersectFirstHit, intersectsTriangle, intersectTriangles,
		normalSampleBarycoord

	] );

	const vertexShader = wgslFn( /* wgsl */`

		fn vertexShader(
			projectionMatrix: mat4x4<f32>,
			modelWorldMatrix: mat4x4<f32>,
			cameraViewMatrix: mat4x4<f32>,
			position: vec3<f32>,
			uv: vec2<f32>
		) -> vec4<f32> {

			var outPosition = projectionMatrix * cameraViewMatrix * modelWorldMatrix * vec4<f32>( position, 1.0 );

			varyings.vUv = uv;

			return outPosition;

		}

	`, [ vUv ] );

	const fragmentShader = wgslFn( /* wgsl */`

		fn fragmentShader(
			vUv: vec2<f32>,
			rayTex: texture_2d<f32>,
			sample: sampler
		) -> vec4<f32> {

			return textureSample( rayTex, sample, vUv );

		}

	` );


	computeBVH = computeShader( computeShaderParams ).computeKernel( workgroupSize );

	rtMaterial = new MeshBasicNodeMaterial();
	rtMaterial.vertexNode = vertexShader( vertexShaderParams );
	rtMaterial.fragmentNode = colorSpaceToWorking( fragmentShader( fragmentShaderParams ), THREE.SRGBColorSpace );


	rtQuad = new FullScreenQuad( rtMaterial );


	new OrbitControls( camera, renderer.domElement );

	gui = new GUI();
	gui.add( params, 'enableRaytracing' );
	gui.add( params, 'animate' );
	gui.add( params, 'smoothNormals' ).onChange( v => {

		rtQuad.material.defines.SMOOTH_NORMALS = Number( v );
		rtQuad.material.needsUpdate = true;

	} );
	gui.add( params, 'resolutionScale', 0.1, 1, 0.01 ).onChange( resize );
	gui.open();

	window.addEventListener( 'resize', resize, false );
	resize();

}

function resize() {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	const w = window.innerWidth;
	const h = window.innerHeight;
	const dpr = window.devicePixelRatio * params.resolutionScale;
	renderer.setSize( w, h );
	renderer.setPixelRatio( dpr );

}

function render() {

	stats.update();

	const delta = clock.getDelta();

	if ( params.animate ) {

		mesh.rotation.y += delta;


	}

	if ( params.enableRaytracing ) {

		camera.updateMatrixWorld();
		mesh.updateMatrixWorld();

		computeBVH.computeNode.parameters.cameraWorldMatrix.value = camera.matrixWorld;
		computeBVH.computeNode.parameters.invProjectionMatrix.value = camera.projectionMatrixInverse;
		computeBVH.computeNode.parameters.invModelMatrix.value = mesh.matrixWorld.invert();
		renderer.compute( computeBVH, dispatchSize );

		rtQuad.render( renderer );

	} else {

		renderer.render( scene, camera );

	}

}
