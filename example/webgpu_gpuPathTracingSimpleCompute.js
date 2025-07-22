import * as THREE from 'three';
import { WebGPURenderer, StorageBufferAttribute, StorageTexture, MeshBasicNodeMaterial } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import Stats from 'three/addons/libs/stats.module.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import {
	attribute, uniform, wgslFn, varyingProperty, textureStore, texture, colorSpaceToWorking,
	storage, workgroupId, localId
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
let fsQuad, mesh, clock, controls;
let fsMaterial, computeBVH, outputTex;
let dispatchSize = [];
const WORKGROUP_SIZE = [ 8, 8, 1 ];

init();

function init() {

	// renderer
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

	// scene init
	scene = new THREE.Scene();

	// light init
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

	// geometry init
	const knotGeometry = new THREE.TorusKnotGeometry( 1, 0.3, 300, 50 );
	const bvh = new MeshBVH( knotGeometry, { maxLeafTris: 1, strategy: SAH } );
	mesh = new THREE.Mesh( knotGeometry, new THREE.MeshStandardMaterial() );
	scene.add( mesh );

	// animation
	clock = new THREE.Clock();

	// TSL
	const bvh_position = new StorageBufferAttribute( knotGeometry.attributes.position.array, 3 );
	const bvh_index = new StorageBufferAttribute( knotGeometry.index.array, 3 );
	const bvhNodes = new StorageBufferAttribute( new Float32Array( bvh._roots[ 0 ] ), 8 );
	const normals = new StorageBufferAttribute( knotGeometry.attributes.normal.array, 3 );

	const computeShaderParams = {
		writeTex: textureStore( outputTex ),
		invProjectionMatrix: uniform( new THREE.Matrix4() ),
		cameraWorldMatrix: uniform( new THREE.Matrix4() ),
		invModelMatrix: uniform( new THREE.Matrix4() ),
		bvh_position: storage( bvh_position, 'vec3', bvh_position.count ).toReadOnly(),
		bvh_index: storage( bvh_index, 'uvec3', bvh_index.count ).toReadOnly(),
		bvh: storage( bvhNodes, 'BVHNode', bvhNodes.count ).toReadOnly(),
		normals: storage( normals, 'vec3', normals.count ).toReadOnly(),
		workgroupSize: uniform( new THREE.Vector3().fromArray( WORKGROUP_SIZE ) ),
		workgroupId: workgroupId,
		localId: localId
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

			// to screen coordinates
			let dimensions = textureDimensions( writeTex );
			let indexUV = workgroupSize.xy * workgroupId.xy + localId.xy;
			let uv = vec2f( indexUV ) / vec2f( dimensions );
			let ndc = uv * 2.0 - vec2f( 1.0 );

			// scene ray
			let ray = ndcToCameraRay( ndc, invModelMatrix * cameraWorldMatrix, invProjectionMatrix );

			// get hit result
			let hitResult = bvhIntersectFirstHit( bvh_index, bvh_position, bvh, ray.origin, ray.direction );

			// sample normal attribute
			let normal = normalSampleBarycoord( hitResult.barycoord, hitResult.faceIndices.xyz, normals );

			// write color
			let background = vec4f( 0.0366, 0.0813, 0.1057, 1.0 );
			let result = select( background, vec4f( normal, 1.0 ), hitResult.didHit );
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

		struct BVHBoundingBox {
			min: array<f32, 3>,
			max: array<f32, 3>,
		}

		struct BVHNode {
			bounds: BVHBoundingBox,
			rightChildOrTriangleOffset: u32,
			splitAxisOrTriangleCount: u32,
		};

	`, [

		ndcToCameraRay, intersectsBVHNodeBounds, intersectsBounds,
		bvhIntersectFirstHit, intersectsTriangle, intersectTriangles,
		normalSampleBarycoord

	] );

	computeBVH = computeShader( computeShaderParams ).computeKernel( WORKGROUP_SIZE );

	// screen quad
	const vUv = varyingProperty( 'vec2', 'vUv' );
	const wgslVertexShader = wgslFn( /* wgsl */`
		fn vertex( position: vec3f, uv: vec2f ) -> vec3<f32> {
			varyings.vUv = uv;
			return position;
		}
	`, [ vUv ] );

	fsMaterial = new MeshBasicNodeMaterial();
	fsMaterial.positionNode = wgslVertexShader( {
		position: attribute( 'position' ),
		uv: attribute( 'uv' )
	} );

	fsMaterial.colorNode = colorSpaceToWorking( texture( outputTex, vUv ), THREE.SRGBColorSpace );
	fsQuad = new FullScreenQuad( fsMaterial );

	// controls
	controls = new OrbitControls( camera, renderer.domElement );

	// gui
	gui = new GUI();
	gui.add( params, 'enableRaytracing' );
	gui.add( params, 'animate' );
	gui.add( params, 'smoothNormals' ).onChange( v => {

		fsQuad.material.defines.SMOOTH_NORMALS = Number( v );
		fsQuad.material.needsUpdate = true;

	} );
	gui.add( params, 'resolutionScale', 0.1, 2, 0.01 ).onChange( resize );
	gui.open();

	// resize
	window.addEventListener( 'resize', resize, false );
	resize();

}

function resize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	const dpr = window.devicePixelRatio;
	const scale = params.resolutionScale;

	camera.aspect = w / h;
	camera.updateProjectionMatrix();

	renderer.setSize( w, h );
	renderer.setPixelRatio( dpr );

	// reconstruct texture
	if ( outputTex ) {

		outputTex.dispose();

	}

	outputTex = new StorageTexture( w * dpr * scale, h * dpr * scale );
	outputTex.format = THREE.RGBAFormat;
	outputTex.type = THREE.UnsignedByteType;
	outputTex.magFilter = THREE.LinearFilter;

}

function render() {

	stats.update();

	const delta = clock.getDelta();

	if ( params.animate ) {

		mesh.rotation.y += delta;


	}

	if ( params.enableRaytracing ) {

		dispatchSize = [
			Math.ceil( outputTex.width / WORKGROUP_SIZE[ 0 ] ),
			Math.ceil( outputTex.height / WORKGROUP_SIZE[ 1 ] ),
			1,
		];

		camera.updateMatrixWorld();
		mesh.updateMatrixWorld();

		computeBVH.computeNode.parameters.writeTex.value = outputTex;
		computeBVH.computeNode.parameters.cameraWorldMatrix.value = camera.matrixWorld;
		computeBVH.computeNode.parameters.invProjectionMatrix.value = camera.projectionMatrixInverse;
		computeBVH.computeNode.parameters.invModelMatrix.value = mesh.matrixWorld.invert();
		renderer.compute( computeBVH, dispatchSize );

		fsMaterial.colorNode.colorNode.value = outputTex;
		fsQuad.render( renderer );

	} else {

		renderer.render( scene, camera );

	}

}
