import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import Stats from 'three/addons/libs/stats.module.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import {
	attribute, uniform, wgslFn, varyingProperty, instanceIndex, textureStore, texture,
	storage, cameraProjectionMatrix, modelWorldMatrix, cameraViewMatrix
} from "three/tsl";


import {
	MeshBVH,
	MeshBVHBufferArrays,
	SAH
} from '../src/index.js';

import { intersectsBVHNodeBounds, intersectsBounds, ndcToCameraRay, normalSampleBarycoord } from '../src/gpu/wgsl/common_functions.wgsl.js';
import { intersectsTriangle, intersectTriangles, bvhIntersectFirstHit } from '../src/gpu/wgsl/bvh_ray_functions.wgsl.js';
import { colorSpaceToWorking } from 'three/tsl';


const params = {
	enableRaytracing: true,
	animate: true,
	resolutionScale: 1.0 / window.devicePixelRatio,
	smoothNormals: true,
};

let renderer, camera, scene, gui, stats;
let rtQuad, mesh, clock;
let rtMaterial, computeBVH;


await init();
render();

async function init() {

	renderer = new THREE.WebGPURenderer( {

		canvas: document.createElement( 'canvas' ),
		antialias: true,
		forceWebGL: false,

	} );
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


	const meshBVHDatas = new MeshBVHBufferArrays();
	meshBVHDatas.updateFrom( bvh );


	const vUv = varyingProperty( "vec2", "vUv" );  

	const bvh_position = new THREE.StorageBufferAttribute( meshBVHDatas.position, 4 );
	const bvh_bounds = new THREE.StorageBufferAttribute( meshBVHDatas.bvhBounds, 4 );
	const bvh_index = new THREE.StorageBufferAttribute( meshBVHDatas.index, 4 );
	const normals = new THREE.StorageBufferAttribute( knotGeometry.attributes.normal.array, 3 );

	const width = Math.ceil( window.innerWidth );
	const height = Math.ceil( window.innerHeight );

	console.log(width)
	console.log(height)

	const rayTex = new THREE.StorageTexture( width, height );
	rayTex.format = THREE.RGBAFormat;
	rayTex.type = THREE.UnsignedByteType;
	rayTex.magFilter = THREE.LinearFilter;


	const computeShaderParams = {
		index: instanceIndex,
		rayTex: textureStore( rayTex ),
		invProjectionMatrix: uniform( new THREE.Matrix4() ),
		cameraWorldMatrix: uniform( new THREE.Matrix4() ),
		invModelMatrix: uniform( new THREE.Matrix4() ),
		bvh_position: storage( bvh_position, 'vec4', bvh_position.count ).toReadOnly(),
		bvh_bounds: storage( bvh_bounds, 'BVHNode', bvh_bounds.count ).toReadOnly(),
		bvh_index: storage( bvh_index, 'uvec4', bvh_index.count ).toReadOnly(),
		normals: storage( normals, 'vec3', normals.count ).toReadOnly(),
	}

	const vertexShaderParams = {
		projectionMatrix: cameraProjectionMatrix,
		modelWorldMatrix: modelWorldMatrix,
		cameraViewMatrix: cameraViewMatrix,
		position: attribute( "position" ),
		uv: attribute( "uv" ),
	};

	const fragmentShaderParams = {
		vUv: vUv,
		rayTex: texture( rayTex ),
		sample: texture( rayTex ),
	};


	const computeShader = wgslFn(`

		fn compute(
			rayTex: texture_storage_2d<rgba8unorm, write>,
			index: u32,
			invProjectionMatrix: mat4x4<f32>,
			cameraWorldMatrix: mat4x4<f32>,
			invModelMatrix: mat4x4<f32>,
			bvh_position: ptr<storage, array<vec4<f32>>, read>,
			bvh_bounds: ptr<storage, array<BVHNode>, read>,
			bvh_index: ptr<storage, array<vec4<u32>>, read>,
			normals: ptr<storage, array<vec3<f32>>, read>,
		) -> void {

			let width = textureDimensions( rayTex ).x;
			let height = textureDimensions( rayTex ).y;

			let posX = index % width;
			let posY = index / width;

			if ( posX >= width || posY >= height ) {
				return;
			}

			let uv = vec2<f32>( f32( posX ) / f32( width ), f32( posY ) / f32( height ) );
			let ndc = uv * 2.0 - vec2<f32>( 1.0, 1.0 );

			let ray = ndcToCameraRay( ndc, invModelMatrix * cameraWorldMatrix, invProjectionMatrix );

			let hitResult = bvhIntersectFirstHit( bvh_index, bvh_position, bvh_bounds, ray.origin, ray.direction );

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

			textureStore( rayTex, vec2<u32>( posX, posY ), result );

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

			boundingBoxMin: vec4<f32>,
			boundingBoxMax: vec4<f32>,

		};

	`, [

		ndcToCameraRay, intersectsBVHNodeBounds, intersectsBounds,
		bvhIntersectFirstHit, intersectsTriangle, intersectTriangles,
		normalSampleBarycoord

	] );


	const vertexShader = wgslFn(`

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


	const fragmentShader = wgslFn(`

		fn fragmentShader(
			vUv: vec2<f32>,
			rayTex: texture_2d<f32>,
			sample: sampler
		) -> vec4<f32> {

			return textureSample( rayTex, sample, vUv );

		}

	`);


	computeBVH = computeShader( computeShaderParams ).compute( width * height );

	rtMaterial = new THREE.MeshBasicNodeMaterial();
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

	requestAnimationFrame( render );

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
		renderer.compute( computeBVH );

		rtQuad.render( renderer );

	} else {

		renderer.render( scene, camera );

	}

}
