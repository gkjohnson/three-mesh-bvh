import * as THREE from 'three';
import { WebGPURenderer, StorageBufferAttribute, StorageTexture, MeshBasicNodeMaterial } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import Stats from 'three/addons/libs/stats.module.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import {
	attribute, uniform, wgslFn, varyingProperty,
	textureStore, texture, colorSpaceToWorking,
	storage, workgroupId, localId,
	wgsl,
} from 'three/tsl';

// three-mesh-bvh
import { GPUMeshBVH, SorterType } from 'three-mesh-bvh/src/gpu/index.js';
import {
	ndcToCameraRay,
	intersectsTriangle,
	intersectsBoundsBVH2,
	bvh2NodeStruct,
	intersectionResultStruct,
	constants,
} from 'three-mesh-bvh/webgpu';

const params = {
	pause: false,
	rebuildEveryFrame: true,
	useRefit: true,
	useGpuTimestamps: false,
	exposure: 1.0,
	sunAzimuth: 35.0,
	sunElevation: 32.0,
	sunTemperature: 5600.0,
	sunBrightness: 1.8,
	resolutionScale: 0.5,
	smoothNormals: true,
	skeletonHelper: false,
	floorY: 0.12,
	walkSpeed: - 2.9,
	maxBounces: 3,
	samples: 1,
};

let renderer, camera, scene, helperScene, gui, stats, clock, controls;
let mixer, animationAction, skinnedMeshes, skeletonHelper, model;
let outputContainer;

// GPU BVH
let gpuBVH = null;
let device = null;
let hasTimestampQuery = false;

// Path tracing
let fsQuad, fsMaterial, computeKernel, presentKernel;
let outputTex, radianceTex, guideTex, hitPosTex;
let dispatchSize = [];
let renderWidth = 1;
let renderHeight = 1;
const WORKGROUP_SIZE = [ 8, 8, 1 ];
let presentShaderParams = null;

// Geometry buffers (updated each frame)
let indexArray = null;
let triCount = 0;

// GPU Skinning buffers and compute kernel
let gpuSkinningKernel = null;
let skinningBuffers = null; // { srcPositions, srcNormals, boneIndices, boneWeights, boneMatrices, dstPositions, dstNormals }
let totalVertexCount = 0;
let meshVertexOffsets = []; // Track where each mesh's vertices start in the merged buffer

// GPU buffers for direct GPU→GPU pipeline (no CPU readback)
let gpuIndexBuffer = null; // Static GPU index buffer for BVH builder
let gpuPositionBuffer = null; // Skinning output GPU buffer (positions, vec4f)

// TSL storage buffers (need to be recreated when BVH changes)
let geom_index, geom_position, geom_normals, bvh2Nodes, rootIndexBuffer;
let computeShaderParams = null;

// Timing stats
let avgEncodeTime = 0;
let avgSkinTime = 0;
let frameCount = 0;
let buildInProgress = false;
const sunDirectionVec = new THREE.Vector3();
const sunColorVec = new THREE.Vector3();
const sunTempColor = new THREE.Color();

// BVH buffer capacity tracking (for GPU→GPU copy without readback)
let bvhBufferCapacity = 0;

function createStorageTexture( width, height, type ) {

	const tex = new StorageTexture( width, height );
	tex.format = THREE.RGBAFormat;
	tex.type = type;
	tex.magFilter = THREE.LinearFilter;
	return tex;

}

function disposeTexturesWhenQueueIdle( textures ) {

	const staleTextures = textures.filter( ( tex ) => tex !== undefined && tex !== null );
	if ( staleTextures.length === 0 ) {

		return;

	}

	const disposeNow = () => {

		for ( const tex of staleTextures ) {

			tex.dispose();

		}

	};

	if ( device && device.queue && device.queue.onSubmittedWorkDone ) {

		device.queue.onSubmittedWorkDone().then( disposeNow ).catch( disposeNow );

	} else {

		disposeNow();

	}

}

function sunColorFromTemperature( kelvin, out = sunColorVec ) {

	const t = THREE.MathUtils.clamp( kelvin, 1000.0, 40000.0 ) / 100.0;
	let r = 255.0;
	let g = 255.0;
	let b = 255.0;

	if ( t > 66.0 ) {

		r = 329.698727446 * Math.pow( t - 60.0, - 0.1332047592 );
		g = 288.1221695283 * Math.pow( t - 60.0, - 0.0755148492 );

	} else {

		g = 99.4708025861 * Math.log( Math.max( t, 1.0 ) ) - 161.1195681661;

	}

	if ( t < 66.0 ) {

		if ( t <= 19.0 ) {

			b = 0.0;

		} else {

			b = 138.5177312231 * Math.log( Math.max( t - 10.0, 1.0 ) ) - 305.0447927307;

		}

	}

	sunTempColor.setRGB(
		THREE.MathUtils.clamp( r, 0.0, 255.0 ) / 255.0,
		THREE.MathUtils.clamp( g, 0.0, 255.0 ) / 255.0,
		THREE.MathUtils.clamp( b, 0.0, 255.0 ) / 255.0,
	).convertSRGBToLinear();
	out.set( sunTempColor.r, sunTempColor.g, sunTempColor.b );
	return out;

}

function sunDirectionFromAngles( azimuthDeg, elevationDeg, out = sunDirectionVec ) {

	const azimuth = THREE.MathUtils.degToRad( azimuthDeg );
	const elevation = THREE.MathUtils.degToRad( elevationDeg );
	const cosEl = Math.cos( elevation );
	out.set(
		Math.sin( azimuth ) * cosEl,
		Math.sin( elevation ),
		Math.cos( azimuth ) * cosEl,
	);
	if ( out.lengthSq() < 1e-8 ) {

		out.set( 0.0, 1.0, 0.0 );

	} else {

		out.normalize();

	}

	return out;

}

init();

async function init() {

	outputContainer = document.getElementById( 'output' );
	outputContainer.textContent = 'Initializing WebGPU...';

	// Request GPU adapter and device
	const adapter = await navigator.gpu.requestAdapter();
	if ( ! adapter ) {

		outputContainer.textContent = 'WebGPU not supported';
		return;

	}

	const requiredFeatures = [];
	if ( adapter.features.has( 'timestamp-query' ) ) {

		requiredFeatures.push( 'timestamp-query' );
		hasTimestampQuery = true;

	}

	if ( adapter.features.has( 'subgroups' ) ) {

		requiredFeatures.push( 'subgroups' );

	}

	device = await adapter.requestDevice( {
		requiredFeatures,
		requiredLimits: {
			maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
			maxStorageBuffersPerShaderStage: 10,
		},
	} );

	// Renderer
	renderer = new WebGPURenderer( {
		canvas: document.createElement( 'canvas' ),
		antialias: true,
		forceWebGL: false,
		device: device,
	} );

	if ( renderer.init ) {

		await renderer.init();

	}

	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setClearColor( 0x111111 );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	document.body.appendChild( renderer.domElement );

	// Scene
	scene = new THREE.Scene();
	helperScene = new THREE.Scene();

	const light = new THREE.DirectionalLight( 0xffffff, 3 );
	light.position.set( 5, 5, 2.5 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xb0bec5, 2.4 ) );

	// Camera
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 100 );
	camera.position.set( 6.5, 2.5, 6.5 );
	camera.updateProjectionMatrix();

	controls = new OrbitControls( camera, renderer.domElement );
	clock = new THREE.Clock();

	// Stats
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// GPU BVH builder
	const sorterType = requiredFeatures.includes( 'subgroups' ) ? SorterType.ONESWEEP : SorterType.BUILTIN;
	gpuBVH = new GPUMeshBVH( device, { sorterType } );

	outputContainer.textContent = 'Loading model...';

	// Load T-Rex model
	new GLTFLoader().load(
		'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/trex/scene.gltf',
		async ( gltf ) => {

			model = gltf.scene;

			// Collect all skinned meshes
			skinnedMeshes = [];
			console.log( '=== Meshes in T-Rex model ===' );
			model.traverse( ( object ) => {

				if ( object.isMesh ) {

					const type = object.isSkinnedMesh ? 'SkinnedMesh' : 'Mesh';
					const meshTriCount = object.geometry.index
						? object.geometry.index.count / 3
						: object.geometry.attributes.position.count / 3;
					console.log( `  ${type}: "${object.name}" - ${meshTriCount} tris` );

					if ( object.isSkinnedMesh ) {

						object.frustumCulled = false;
						skinnedMeshes.push( object );

					}

				}

			} );
			console.log( '=============================' );

			if ( skinnedMeshes.length === 0 ) {

				outputContainer.textContent = 'No skinned mesh found!';
				return;

			}

			console.log( `Using ${skinnedMeshes.length} skinned meshes` );

			model.updateMatrixWorld( true );
			scene.add( model );

			// Skeleton helper
			skeletonHelper = new THREE.SkeletonHelper( model );
			skeletonHelper.visible = params.skeletonHelper;
			helperScene.add( skeletonHelper );
			skeletonHelper.material.depthTest = false;

			// Animation
			mixer = new THREE.AnimationMixer( model );
			animationAction = mixer.clipAction( gltf.animations[ 0 ] );
			animationAction.play();

			// Camera target
			const box = new THREE.Box3().setFromObject( model );
			box.getCenter( controls.target );
			controls.target.z += 3;
			controls.update();

			// Initialize geometry arrays and build initial BVH
			await initializeGeometry();

			// Setup path tracing (needs BVH to be built first)
			await setupPathTracing();

			// GUI
			setupGUI();

			// Start render loop
			renderer.setAnimationLoop( render );

		}
	);

	window.addEventListener( 'resize', resize );

}

async function initializeGeometry() {

	// Calculate total vertex count across all skinned meshes (expanded by index)
	totalVertexCount = 0;
	meshVertexOffsets = [];

	for ( const mesh of skinnedMeshes ) {

		meshVertexOffsets.push( totalVertexCount );
		const geometry = mesh.geometry;
		const indexAttr = geometry.index;
		if ( indexAttr ) {

			totalVertexCount += indexAttr.count;

		} else {

			totalVertexCount += geometry.attributes.position.count;

		}

	}

	triCount = totalVertexCount / 3;
	console.log( `Total vertices: ${totalVertexCount}, triangles: ${triCount}` );

	// Allocate CPU arrays for collecting source data
	// We use vec4 for positions/normals to match WGSL storage layout (16-byte stride)
	const srcPositions = new Float32Array( totalVertexCount * 4 );
	const srcNormals = new Float32Array( totalVertexCount * 4 );
	const boneIndices = new Uint32Array( totalVertexCount * 4 );
	const boneWeights = new Float32Array( totalVertexCount * 4 );

	// Collect source data from all meshes (expanded by index)
	let offset = 0;
	for ( const mesh of skinnedMeshes ) {

		const geometry = mesh.geometry;
		const posAttr = geometry.attributes.position;
		const normalAttr = geometry.attributes.normal;
		const indexAttr = geometry.index;
		const skinIndexAttr = geometry.attributes.skinIndex;
		const skinWeightAttr = geometry.attributes.skinWeight;

		const vertexCount = indexAttr ? indexAttr.count : posAttr.count;

		for ( let i = 0; i < vertexCount; i ++ ) {

			const srcIdx = indexAttr ? indexAttr.array[ i ] : i;

			// Position (vec4, w=1 for position)
			srcPositions[ offset * 4 + 0 ] = posAttr.getX( srcIdx );
			srcPositions[ offset * 4 + 1 ] = posAttr.getY( srcIdx );
			srcPositions[ offset * 4 + 2 ] = posAttr.getZ( srcIdx );
			srcPositions[ offset * 4 + 3 ] = 1.0;

			// Normal (vec4, w=0 for direction)
			srcNormals[ offset * 4 + 0 ] = normalAttr.getX( srcIdx );
			srcNormals[ offset * 4 + 1 ] = normalAttr.getY( srcIdx );
			srcNormals[ offset * 4 + 2 ] = normalAttr.getZ( srcIdx );
			srcNormals[ offset * 4 + 3 ] = 0.0;

			// Bone indices (uvec4)
			boneIndices[ offset * 4 + 0 ] = skinIndexAttr.getX( srcIdx );
			boneIndices[ offset * 4 + 1 ] = skinIndexAttr.getY( srcIdx );
			boneIndices[ offset * 4 + 2 ] = skinIndexAttr.getZ( srcIdx );
			boneIndices[ offset * 4 + 3 ] = skinIndexAttr.getW( srcIdx );

			// Bone weights (vec4)
			boneWeights[ offset * 4 + 0 ] = skinWeightAttr.getX( srcIdx );
			boneWeights[ offset * 4 + 1 ] = skinWeightAttr.getY( srcIdx );
			boneWeights[ offset * 4 + 2 ] = skinWeightAttr.getZ( srcIdx );
			boneWeights[ offset * 4 + 3 ] = skinWeightAttr.getW( srcIdx );

			offset ++;

		}

	}

	// Get bone count from first skeleton (all meshes share the same skeleton)
	const skeleton = skinnedMeshes[ 0 ].skeleton;
	const boneCount = skeleton.bones.length;
	console.log( `Bone count: ${boneCount}` );

	// Allocate bone matrices array (mat4x4 = 16 floats per bone)
	const boneMatricesArray = new Float32Array( boneCount * 16 );

	// Output arrays (vec4 layout for proper WGSL alignment)
	const dstPositions = new Float32Array( totalVertexCount * 4 );
	const dstNormals = new Float32Array( totalVertexCount * 4 );

	// Create GPU storage buffers
	skinningBuffers = {
		srcPositions: new StorageBufferAttribute( srcPositions, 4 ),
		srcNormals: new StorageBufferAttribute( srcNormals, 4 ),
		boneIndices: new StorageBufferAttribute( boneIndices, 4 ),
		boneWeights: new StorageBufferAttribute( boneWeights, 4 ),
		boneMatrices: new StorageBufferAttribute( boneMatricesArray, 16 ),
		dstPositions: new StorageBufferAttribute( dstPositions, 4 ),
		dstNormals: new StorageBufferAttribute( dstNormals, 4 ),
		boneCount: boneCount,
	};

	// Create sequential index for merged geometry
	indexArray = new Uint32Array( totalVertexCount );
	for ( let i = 0; i < totalVertexCount; i ++ ) {

		indexArray[ i ] = i;

	}

	// Create GPU skinning compute shader
	await setupGPUSkinning();

	// Run initial GPU skinning
	await runGPUSkinning();

	// Create static GPU index buffer for BVH builder (STORAGE for BVH, COPY_DST for upload)
	gpuIndexBuffer = device.createBuffer( {
		size: indexArray.byteLength,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	} );
	device.queue.writeBuffer( gpuIndexBuffer, 0, indexArray );

	// Get skinning output GPU buffers directly (vec4f layout, stride=4)
	const backend = renderer.backend;
	gpuPositionBuffer = backend.get( skinningBuffers.dstPositions ).buffer;

	// Build initial BVH directly from GPU skinning output (no CPU readback!)
	outputContainer.textContent = `Warming up GPU BVH (${triCount} tris)...`;
	await gpuBVH.buildAsyncFromGPUBuffers( {
		positionBuffer: gpuPositionBuffer,
		indexBuffer: gpuIndexBuffer,
		primCount: triCount,
		positionStride: 4,
	} );

	outputContainer.textContent = 'Ready!';

}

async function setupGPUSkinning() {

	const SKIN_WORKGROUP_SIZE = 256;

	// GPU Skinning compute shader
	// Each thread processes one vertex
	const skinningShader = wgslFn( /* wgsl */`
		fn compute(
			srcPositions: ptr<storage, array<vec4f>, read>,
			srcNormals: ptr<storage, array<vec4f>, read>,
			boneIndices: ptr<storage, array<vec4u>, read>,
			boneWeights: ptr<storage, array<vec4f>, read>,
			boneMatrices: ptr<storage, array<mat4x4f>, read>,
			bindMatrix: mat4x4f,
			bindMatrixInverse: mat4x4f,
			vertexCount: u32,
			dstPositions: ptr<storage, array<vec4f>, read_write>,
			dstNormals: ptr<storage, array<vec4f>, read_write>,
			workgroupId: vec3u,
			localId: vec3u,
		) -> void {
			let globalId = workgroupId.x * 256u + localId.x;
			if ( globalId >= vertexCount ) {
				return;
			}

			// Read source data
			let srcPos = srcPositions[globalId];
			let srcNorm = srcNormals[globalId];
			let indices = boneIndices[globalId];
			let weights = boneWeights[globalId];

			// Transform source position/normal by bind matrix
			let boundPos = bindMatrix * srcPos;
			let boundNorm = bindMatrix * vec4f(srcNorm.xyz, 0.0);

			// Apply weighted bone transforms
			var skinnedPos = vec4f(0.0, 0.0, 0.0, 0.0);
			var skinnedNorm = vec4f(0.0, 0.0, 0.0, 0.0);

			// Bone 0
			if ( weights.x > 0.0 ) {
				let boneMat = boneMatrices[indices.x];
				skinnedPos += weights.x * (boneMat * boundPos);
				skinnedNorm += weights.x * (boneMat * boundNorm);
			}

			// Bone 1
			if ( weights.y > 0.0 ) {
				let boneMat = boneMatrices[indices.y];
				skinnedPos += weights.y * (boneMat * boundPos);
				skinnedNorm += weights.y * (boneMat * boundNorm);
			}

			// Bone 2
			if ( weights.z > 0.0 ) {
				let boneMat = boneMatrices[indices.z];
				skinnedPos += weights.z * (boneMat * boundPos);
				skinnedNorm += weights.z * (boneMat * boundNorm);
			}

			// Bone 3
			if ( weights.w > 0.0 ) {
				let boneMat = boneMatrices[indices.w];
				skinnedPos += weights.w * (boneMat * boundPos);
				skinnedNorm += weights.w * (boneMat * boundNorm);
			}

			// Apply bind matrix inverse
			skinnedPos = bindMatrixInverse * skinnedPos;
			skinnedNorm = bindMatrixInverse * skinnedNorm;

			// Normalize the normal
			let finalNorm = normalize(skinnedNorm.xyz);

			// Write output
			dstPositions[globalId] = vec4f(skinnedPos.xyz, 1.0);
			dstNormals[globalId] = vec4f(finalNorm, 0.0);
		}
	` );

	// Create compute kernel params
	const skinningParams = {
		srcPositions: storage( skinningBuffers.srcPositions, 'vec4f', totalVertexCount ).toReadOnly(),
		srcNormals: storage( skinningBuffers.srcNormals, 'vec4f', totalVertexCount ).toReadOnly(),
		boneIndices: storage( skinningBuffers.boneIndices, 'vec4<u32>', totalVertexCount ).toReadOnly(),
		boneWeights: storage( skinningBuffers.boneWeights, 'vec4f', totalVertexCount ).toReadOnly(),
		boneMatrices: storage( skinningBuffers.boneMatrices, 'mat4x4f', skinningBuffers.boneCount ).toReadOnly(),
		bindMatrix: uniform( new THREE.Matrix4() ),
		bindMatrixInverse: uniform( new THREE.Matrix4() ),
		vertexCount: uniform( totalVertexCount ),
		dstPositions: storage( skinningBuffers.dstPositions, 'vec4f', totalVertexCount ),
		dstNormals: storage( skinningBuffers.dstNormals, 'vec4f', totalVertexCount ),
		workgroupId: workgroupId,
		localId: localId,
	};

	skinningBuffers.params = skinningParams;

	gpuSkinningKernel = skinningShader( skinningParams ).computeKernel( [ SKIN_WORKGROUP_SIZE, 1, 1 ] );

}

async function runGPUSkinning() {

	// Update skeleton and bone matrices
	const mesh = skinnedMeshes[ 0 ];
	const skeleton = mesh.skeleton;
	skeleton.update();

	// Upload bone matrices to GPU
	skinningBuffers.boneMatrices.array.set( skeleton.boneMatrices );
	skinningBuffers.boneMatrices.needsUpdate = true;

	// Set bind matrices (use first mesh - they typically share the same skeleton)
	skinningBuffers.params.bindMatrix.value.copy( mesh.bindMatrix );
	skinningBuffers.params.bindMatrixInverse.value.copy( mesh.bindMatrixInverse );

	// Dispatch compute shader
	const workgroupCount = Math.ceil( totalVertexCount / 256 );
	renderer.compute( gpuSkinningKernel, [ workgroupCount, 1, 1 ] );

}

async function setupPathTracing() {

	// Create initial storage buffers
	// Index stays as uvec3 (used by BVH traversal)
	geom_index = new StorageBufferAttribute( indexArray, 3 );

	// Positions and normals: use skinning output directly (vec4f layout → array<f32>, stride 4)
	// Use the skinning output StorageBufferAttributes directly - they point to the GPU buffers
	geom_position = skinningBuffers.dstPositions;
	geom_normals = skinningBuffers.dstNormals;

	// Create BVH storage buffer with capacity for growth (avoid reallocations)
	// Use maxNodeCount (2 * primCount) for capacity since we won't know exact count
	bvhBufferCapacity = gpuBVH.maxNodeCount;
	const bvh2Array = new Float32Array( bvhBufferCapacity * 8 ); // 8 floats per node
	bvh2Nodes = new StorageBufferAttribute( bvh2Array, 8 );

	// Root index buffer - read on GPU to avoid CPU readback
	// clusterIdx[0] contains the root index after build
	rootIndexBuffer = new StorageBufferAttribute( new Uint32Array( [ 0 ] ), 1 );

	// Ensure render targets exist with the current viewport size before kernel creation.
	resize();

	computeShaderParams = {
		outputTex: textureStore( radianceTex ),
		guideTex: textureStore( guideTex ),
		hitPosTex: textureStore( hitPosTex ),
		smoothNormals: uniform( 1 ),
		inverseProjectionMatrix: uniform( new THREE.Matrix4() ),
		cameraToWorldMatrix: uniform( new THREE.Matrix4() ),
		worldToModelMatrix: uniform( new THREE.Matrix4() ),
		modelToWorldMatrix: uniform( new THREE.Matrix4() ),
		floorY: uniform( 0.12 ),
		time: uniform( 0.0 ),
		walkSpeed: uniform( params.walkSpeed ),
		sunDirection: uniform( new THREE.Vector3( 0.0, 1.0, 0.0 ) ),
		sunColor: uniform( new THREE.Vector3( 1.0, 1.0, 1.0 ) ),
		frameCount: uniform( 0 ),
		samples: uniform( 1 ),
		geom_index: storage( geom_index, 'uvec3', geom_index.count ).toReadOnly(),
		geom_position: storage( geom_position, 'f32', totalVertexCount * 4 ).toReadOnly(),
		geom_normals: storage( geom_normals, 'f32', totalVertexCount * 4 ).toReadOnly(),
		bvh: storage( bvh2Nodes, 'BVH2Node', bvhBufferCapacity ).toReadOnly(),
		rootIndexBuf: storage( rootIndexBuffer, 'u32', 1 ).toReadOnly(),
		workgroupSize: uniform( new THREE.Vector3() ),
		workgroupId: workgroupId,
		localId: localId
	};

	const utils = wgsl( /* wgsl */ `
		fn hash( seed: u32 ) -> u32 {
			// Simple hash for random numbers

			var s = seed;
			s = s ^ ( s >> 16u );
			s = s * 0x85ebca6bu;
			s = s ^ ( s >> 13u );
			s = s * 0xc2b2ae35u;
			s = s ^ ( s >> 16u );
			return s;
		}

		fn randomFloat( seed: ptr<function, u32> ) -> f32 {
			*seed = hash( *seed );
			return f32( *seed ) / f32( 0xffffffffu );
		}

		// Cosine-weighted hemisphere sampling for diffuse
		fn cosineSampleHemisphere( normal: vec3f, seed: ptr<function, u32> ) -> vec3f {
			let r1 = randomFloat( seed );
			let r2 = randomFloat( seed );
			let phi = 2.0 * 3.14159265 * r1;
			let cosTheta = sqrt( r2 );
			let sinTheta = sqrt( 1.0 - r2 );

			// Create orthonormal basis
			var tangent: vec3f;
			if ( abs( normal.x ) > 0.9 ) {
				tangent = normalize( cross( normal, vec3f( 0.0, 1.0, 0.0 ) ) );
			} else {
				tangent = normalize( cross( normal, vec3f( 1.0, 0.0, 0.0 ) ) );
			}
			let bitangent = cross( normal, tangent );

			return normalize(
				tangent * cos( phi ) * sinTheta +
				bitangent * sin( phi ) * sinTheta +
				normal * cosTheta
			);
		}

		// Box intersection (axis-aligned, in world space)
		fn intersectBox( rayOrigin: vec3f, rayDir: vec3f, boxMin: vec3f, boxMax: vec3f ) -> f32 {
			let invDir = 1.0 / rayDir;
			let t1 = ( boxMin - rayOrigin ) * invDir;
			let t2 = ( boxMax - rayOrigin ) * invDir;
			let tMin = min( t1, t2 );
			let tMax = max( t1, t2 );
			let tEnter = max( max( tMin.x, tMin.y ), tMin.z );
			let tExit = min( min( tMax.x, tMax.y ), tMax.z );
			if ( tEnter > tExit || tExit < 0.0 ) {
				return -1.0;
			}
			return select( tExit, tEnter, tEnter > 0.0 );
		}

		fn getBoxNormal( hitPoint: vec3f, boxMin: vec3f, boxMax: vec3f ) -> vec3f {
			let center = ( boxMin + boxMax ) * 0.5;
			let halfSize = ( boxMax - boxMin ) * 0.5;
			let local = hitPoint - center;
			let d = abs( local ) - halfSize;
			let maxAxis = max( max( d.x, d.y ), d.z );
			if ( abs( d.x - maxAxis ) < 0.001 ) {
				return vec3f( sign( local.x ), 0.0, 0.0 );
			} else if ( abs( d.y - maxAxis ) < 0.001 ) {
				return vec3f( 0.0, sign( local.y ), 0.0 );
			}
			return vec3f( 0.0, 0.0, sign( local.z ) );
		}

		// Use fract-based wrapping to handle negative moveOffset properly
		fn wrapZ( base: f32, offset: f32, period: f32, range: f32 ) -> f32 {
			return base + ( ( offset % period ) + period ) % period - range;
		}

		// Load vertex position from f32 array with stride 4 (vec4f layout)
		fn loadVertexPosition( positions: ptr<storage, array<f32>, read>, idx: u32 ) -> vec3f {
			let base = idx * 4u;
			return vec3f( positions[base], positions[base + 1u], positions[base + 2u] );
		}

		// Get interpolated vertex attribute from f32 array with stride 4
		fn getVertexAttributeF32( barycoord: vec3f, indices: vec3u, data: ptr<storage, array<f32>, read> ) -> vec3f {
			let b0 = indices.x * 4u;
			let b1 = indices.y * 4u;
			let b2 = indices.z * 4u;
			let v0 = vec3f( data[b0], data[b0 + 1u], data[b0 + 2u] );
			let v1 = vec3f( data[b1], data[b1 + 1u], data[b1 + 2u] );
			let v2 = vec3f( data[b2], data[b2 + 1u], data[b2 + 2u] );
			return v0 * barycoord.x + v1 * barycoord.y + v2 * barycoord.z;
		}

		// BVH2 traversal with stride-4 position loading (array<f32> instead of array<vec3f>)
		fn bvh2IntersectFirstHitF32(
			bvh_index: ptr<storage, array<vec3u>, read>,
			bvh_position: ptr<storage, array<f32>, read>,
			bvh: ptr<storage, array<BVH2Node>, read>,
			ray: Ray,
			rootIndex: u32,
		) -> IntersectionResult {

			const INVALID_IDX = 0xFFFFFFFFu;

			var pointer = 0;
			var stack: array<u32, BVH_STACK_DEPTH>;
			stack[ 0 ] = rootIndex;

			var bestHit: IntersectionResult;
			bestHit.didHit = false;
			bestHit.dist = INFINITY;

			loop {
				if ( pointer < 0 || pointer >= i32( BVH_STACK_DEPTH ) ) {
					break;
				}

				let currNodeIndex = stack[ pointer ];
				let node = bvh[ currNodeIndex ];
				pointer = pointer - 1;

				var boundsHitDistance: f32 = 0.0;
				if ( ! intersectsBoundsBVH2( ray, node.boundsMin, node.boundsMax, &boundsHitDistance ) || boundsHitDistance > bestHit.dist ) {
					continue;
				}

				let isLeaf = node.leftChild == INVALID_IDX;

				if ( isLeaf ) {
					let triIndex = node.rightChild;
					let indices = bvh_index[ triIndex ];
					let a = loadVertexPosition( bvh_position, indices.x );
					let b = loadVertexPosition( bvh_position, indices.y );
					let c = loadVertexPosition( bvh_position, indices.z );

					var triResult = intersectsTriangle( ray, a, b, c );
					if ( triResult.didHit && triResult.dist < bestHit.dist ) {
						bestHit = triResult;
						bestHit.indices = vec4u( indices.xyz, triIndex );
					}
				} else {
					let leftIndex = node.leftChild;
					let rightIndex = node.rightChild;

					let extent = node.boundsMax - node.boundsMin;
					var splitAxis = 0u;
					if ( extent.y > extent.x && extent.y > extent.z ) {
						splitAxis = 1u;
					} else if ( extent.z > extent.x ) {
						splitAxis = 2u;
					}

					let leftToRight = ray.direction[ splitAxis ] >= 0.0;
					let c1 = select( rightIndex, leftIndex, leftToRight );
					let c2 = select( leftIndex, rightIndex, leftToRight );

					pointer = pointer + 1;
					stack[ pointer ] = c2;
					pointer = pointer + 1;
					stack[ pointer ] = c1;
				}
			}

			return bestHit;
		}

	` );

	const computeShader = wgslFn( /* wgsl */`
			fn compute(
				outputTex: texture_storage_2d<rgba16float, write>,
				guideTex: texture_storage_2d<rgba16float, write>,
				hitPosTex: texture_storage_2d<rgba16float, write>,
				smoothNormals: u32,
				inverseProjectionMatrix: mat4x4f,
			cameraToWorldMatrix: mat4x4f,
			worldToModelMatrix: mat4x4f,
				modelToWorldMatrix: mat4x4f,
				floorY: f32,
				time: f32,
				walkSpeed: f32,
				sunDirection: vec3f,
				sunColor: vec3f,
				frameCount: u32,
				samples: u32,
			geom_position: ptr<storage, array<f32>, read>,
			geom_index: ptr<storage, array<vec3u>, read>,
			geom_normals: ptr<storage, array<f32>, read>,
			bvh: ptr<storage, array<BVH2Node>, read>,
			rootIndexBuf: ptr<storage, array<u32>, read>,
			workgroupSize: vec3u,
			workgroupId: vec3u,
			localId: vec3u
		) -> void {
			let dimensions = textureDimensions( outputTex );
			let indexUV = workgroupSize.xy * workgroupId.xy + localId.xy;
			if ( indexUV.x >= dimensions.x || indexUV.y >= dimensions.y ) { return; }

			let uv = vec2f( indexUV ) / vec2f( dimensions );
			let ndc = uv * 2.0 - vec2f( 1.0 );
			let rootIndex = rootIndexBuf[0];

			// Initialize RNG with pixel position and frame
			var rngSeed = indexUV.x + indexUV.y * dimensions.x + frameCount * dimensions.x * dimensions.y;

			// Create world-space ray
			var worldRay = ndcToCameraRay( ndc, cameraToWorldMatrix * inverseProjectionMatrix );
			let cameraToModelMatrix = worldToModelMatrix * cameraToWorldMatrix;

				// Lighting
				let sunDir = normalizeSafe( sunDirection, vec3f( 0.0, 1.0, 0.0 ) );

			// Moving offset for floor and boxes
			let moveOffset = time * walkSpeed;


			// Define colorful boxes with varied materials
			// Format: position, size, color, metalness (0=diffuse, 1=mirror)

			// Ground-level boxes (left side)
			let z0 = wrapZ( 0.0, moveOffset, 30.0, 15.0 );
			let box0Min = vec3f( -6.0, floorY, z0 - 1.5 );
			let box0Max = vec3f( -4.0, floorY + 2.5, z0 + 1.5 );
			let box0Color = vec3f( 0.9, 0.15, 0.15 ); // Red
			let box0Metal = 0.1;

			let z1 = wrapZ( 8.0, moveOffset, 25.0, 12.0 );
			let box1Min = vec3f( -7.0, floorY, z1 - 1.0 );
			let box1Max = vec3f( -5.0, floorY + 1.8, z1 + 1.0 );
			let box1Color = vec3f( 0.15, 0.8, 0.2 ); // Green
			let box1Metal = 0.2;

			let z2 = wrapZ( -6.0, moveOffset, 35.0, 20.0 );
			let box2Min = vec3f( -8.0, floorY, z2 - 1.2 );
			let box2Max = vec3f( -5.5, floorY + 3.5, z2 + 1.2 );
			let box2Color = vec3f( 0.2, 0.3, 0.9 ); // Blue
			let box2Metal = 0.6; // More reflective

			// Ground-level boxes (right side)
			let z3 = wrapZ( 3.0, moveOffset, 28.0, 14.0 );
			let box3Min = vec3f( 4.0, floorY, z3 - 1.0 );
			let box3Max = vec3f( 6.0, floorY + 2.0, z3 + 1.0 );
			let box3Color = vec3f( 0.95, 0.8, 0.1 ); // Yellow
			let box3Metal = 0.15;

			let z4 = wrapZ( -4.0, moveOffset, 32.0, 18.0 );
			let box4Min = vec3f( 5.5, floorY, z4 - 1.5 );
			let box4Max = vec3f( 8.0, floorY + 3.0, z4 + 1.5 );
			let box4Color = vec3f( 0.8, 0.2, 0.75 ); // Purple
			let box4Metal = 0.4;

			let z5 = wrapZ( 10.0, moveOffset, 26.0, 13.0 );
			let box5Min = vec3f( 4.5, floorY, z5 - 0.8 );
			let box5Max = vec3f( 6.0, floorY + 1.5, z5 + 0.8 );
			let box5Color = vec3f( 0.1, 0.85, 0.85 ); // Cyan
			let box5Metal = 0.25;

			// Floating boxes (varied heights)
			let z6 = wrapZ( 2.0, moveOffset, 24.0, 12.0 );
			let box6Min = vec3f( -5.0, floorY + 2.5, z6 - 0.6 );
			let box6Max = vec3f( -3.5, floorY + 4.0, z6 + 0.6 );
			let box6Color = vec3f( 1.0, 0.5, 0.0 ); // Orange
			let box6Metal = 0.8; // Highly reflective

			let z7 = wrapZ( -3.0, moveOffset, 22.0, 11.0 );
			let box7Min = vec3f( 3.0, floorY + 1.8, z7 - 0.7 );
			let box7Max = vec3f( 4.5, floorY + 3.2, z7 + 0.7 );
			let box7Color = vec3f( 0.95, 0.95, 0.95 ); // White/silver
			let box7Metal = 0.95; // Almost mirror

			let z8 = wrapZ( 6.0, moveOffset, 20.0, 10.0 );
			let box8Min = vec3f( -3.0, floorY + 3.0, z8 - 0.5 );
			let box8Max = vec3f( -1.5, floorY + 4.5, z8 + 0.5 );
			let box8Color = vec3f( 0.3, 0.9, 0.5 ); // Mint
			let box8Metal = 0.5;

			let z9 = wrapZ( -8.0, moveOffset, 27.0, 15.0 );
			let box9Min = vec3f( 2.0, floorY + 4.0, z9 - 0.8 );
			let box9Max = vec3f( 4.0, floorY + 6.0, z9 + 0.8 );
			let box9Color = vec3f( 0.9, 0.3, 0.4 ); // Coral
			let box9Metal = 0.05; // Very matte

				// Multi-sample path tracing
				var totalRadiance = vec3f( 0.0 );
				let baseWorldRay = ndcToCameraRay( ndc, cameraToWorldMatrix * inverseProjectionMatrix );
				var firstHitNormal = vec3f( 0.0, 0.0, 0.0 );
				var firstHitDepth = 0.0;
				var firstHitPosition = vec3f( 0.0 );
				var firstHitValid = false;

			for ( var sampleIdx = 0u; sampleIdx < samples; sampleIdx++ ) {
				// Reset for each sample
				var throughput = vec3f( 1.0 );
				var radiance = vec3f( 0.0 );
				var worldRay = baseWorldRay;

				// Normalize world ray direction for consistent distance comparisons
				let worldRayDirLen = length( worldRay.direction );
				worldRay.direction = worldRay.direction / worldRayDirLen;

				// Update RNG seed for this sample
				rngSeed = hash( rngSeed + sampleIdx * 12345u );

				for ( var bounce = 0u; bounce < 4u; bounce++ ) {
				var hitDist = 1e30f;  // World-space distance (not parametric t)
				var hitNormal = vec3f( 0.0, 1.0, 0.0 );
				var hitColor = vec3f( 0.5 );
				var hitMetalness = 0.0;  // Material property for boxes
				var hitType = 0u; // 0=miss, 1=dino, 2=floor, 3=box

				// === Test dinosaur (BVH in model space) ===
				var modelRay: Ray;
				modelRay.origin = ( worldToModelMatrix * vec4f( worldRay.origin, 1.0 ) ).xyz;
				modelRay.direction = ( worldToModelMatrix * vec4f( worldRay.direction, 0.0 ) ).xyz;
				// Compute scale factor between model and world space
				let modelDirLen = length( modelRay.direction );
				modelRay.direction = modelRay.direction / modelDirLen;

				let dinoHit = bvh2IntersectFirstHitF32( geom_index, geom_position, bvh, modelRay, rootIndex );
				if ( dinoHit.didHit ) {
					// Convert model-space distance to world-space distance
					let dinoWorldDist = dinoHit.dist / modelDirLen;
					if ( dinoWorldDist < hitDist && dinoWorldDist > 0.001 ) {
						hitDist = dinoWorldDist;
						var n = select(
							dinoHit.normal,
							normalize( getVertexAttributeF32( dinoHit.barycoord, dinoHit.indices.xyz, geom_normals ) ),
							smoothNormals > 0u
						);
						hitNormal = normalize( ( modelToWorldMatrix * vec4f( n, 0.0 ) ).xyz );
						hitColor = vec3f( 0.85, 0.85, 0.85 ); // White albedo
						hitMetalness = 0.25; // Slightly reflective
						hitType = 1u;
					}
				}

				// === Test floor (world space, normalized ray means t = distance) ===
				if ( worldRay.direction.y < -0.0001 && worldRay.origin.y > floorY ) {
					let floorDist = ( floorY - worldRay.origin.y ) / worldRay.direction.y;
					if ( floorDist > 0.001 && floorDist < hitDist ) {
						hitDist = floorDist;
						hitNormal = vec3f( 0.0, 1.0, 0.0 );
						let floorHitPoint = worldRay.origin + worldRay.direction * floorDist;
						// Moving checkerboard - use fract to handle negative coords properly
						let cx = floor( floorHitPoint.x * 0.3 + 1000.0 );  // Offset to avoid negative
						let cz = floor( ( floorHitPoint.z - moveOffset ) * 0.3 + 1000.0 );
						let checker = ( i32( cx ) + i32( cz ) ) % 2;
						hitColor = select( vec3f( 0.3, 0.3, 0.32 ), vec3f( 0.5, 0.5, 0.52 ), checker == 1 );
						hitType = 2u;
					}
				}

				// === Test boxes (unrolled, world space) ===
				var boxDist: f32;
				var boxHitPoint: vec3f;

				boxDist = intersectBox( worldRay.origin, worldRay.direction, box0Min, box0Max );
				if ( boxDist > 0.001 && boxDist < hitDist ) {
					hitDist = boxDist; boxHitPoint = worldRay.origin + worldRay.direction * boxDist;
					hitNormal = getBoxNormal( boxHitPoint, box0Min, box0Max ); hitColor = box0Color; hitMetalness = box0Metal; hitType = 3u;
				}
				boxDist = intersectBox( worldRay.origin, worldRay.direction, box1Min, box1Max );
				if ( boxDist > 0.001 && boxDist < hitDist ) {
					hitDist = boxDist; boxHitPoint = worldRay.origin + worldRay.direction * boxDist;
					hitNormal = getBoxNormal( boxHitPoint, box1Min, box1Max ); hitColor = box1Color; hitMetalness = box1Metal; hitType = 3u;
				}
				boxDist = intersectBox( worldRay.origin, worldRay.direction, box2Min, box2Max );
				if ( boxDist > 0.001 && boxDist < hitDist ) {
					hitDist = boxDist; boxHitPoint = worldRay.origin + worldRay.direction * boxDist;
					hitNormal = getBoxNormal( boxHitPoint, box2Min, box2Max ); hitColor = box2Color; hitMetalness = box2Metal; hitType = 3u;
				}
				boxDist = intersectBox( worldRay.origin, worldRay.direction, box3Min, box3Max );
				if ( boxDist > 0.001 && boxDist < hitDist ) {
					hitDist = boxDist; boxHitPoint = worldRay.origin + worldRay.direction * boxDist;
					hitNormal = getBoxNormal( boxHitPoint, box3Min, box3Max ); hitColor = box3Color; hitMetalness = box3Metal; hitType = 3u;
				}
				boxDist = intersectBox( worldRay.origin, worldRay.direction, box4Min, box4Max );
				if ( boxDist > 0.001 && boxDist < hitDist ) {
					hitDist = boxDist; boxHitPoint = worldRay.origin + worldRay.direction * boxDist;
					hitNormal = getBoxNormal( boxHitPoint, box4Min, box4Max ); hitColor = box4Color; hitMetalness = box4Metal; hitType = 3u;
				}
				boxDist = intersectBox( worldRay.origin, worldRay.direction, box5Min, box5Max );
				if ( boxDist > 0.001 && boxDist < hitDist ) {
					hitDist = boxDist; boxHitPoint = worldRay.origin + worldRay.direction * boxDist;
					hitNormal = getBoxNormal( boxHitPoint, box5Min, box5Max ); hitColor = box5Color; hitMetalness = box5Metal; hitType = 3u;
				}
				// Floating boxes
				boxDist = intersectBox( worldRay.origin, worldRay.direction, box6Min, box6Max );
				if ( boxDist > 0.001 && boxDist < hitDist ) {
					hitDist = boxDist; boxHitPoint = worldRay.origin + worldRay.direction * boxDist;
					hitNormal = getBoxNormal( boxHitPoint, box6Min, box6Max ); hitColor = box6Color; hitMetalness = box6Metal; hitType = 3u;
				}
				boxDist = intersectBox( worldRay.origin, worldRay.direction, box7Min, box7Max );
				if ( boxDist > 0.001 && boxDist < hitDist ) {
					hitDist = boxDist; boxHitPoint = worldRay.origin + worldRay.direction * boxDist;
					hitNormal = getBoxNormal( boxHitPoint, box7Min, box7Max ); hitColor = box7Color; hitMetalness = box7Metal; hitType = 3u;
				}
				boxDist = intersectBox( worldRay.origin, worldRay.direction, box8Min, box8Max );
				if ( boxDist > 0.001 && boxDist < hitDist ) {
					hitDist = boxDist; boxHitPoint = worldRay.origin + worldRay.direction * boxDist;
					hitNormal = getBoxNormal( boxHitPoint, box8Min, box8Max ); hitColor = box8Color; hitMetalness = box8Metal; hitType = 3u;
				}
				boxDist = intersectBox( worldRay.origin, worldRay.direction, box9Min, box9Max );
				if ( boxDist > 0.001 && boxDist < hitDist ) {
					hitDist = boxDist; boxHitPoint = worldRay.origin + worldRay.direction * boxDist;
					hitNormal = getBoxNormal( boxHitPoint, box9Min, box9Max ); hitColor = box9Color; hitMetalness = box9Metal; hitType = 3u;
				}

					// === Process hit ===
					if ( sampleIdx == 0u && bounce == 0u ) {
						if ( hitType != 0u ) {

							let hitPoint0 = worldRay.origin + worldRay.direction * hitDist;
							firstHitNormal = normalize( hitNormal );
							firstHitDepth = hitDist;
							firstHitPosition = hitPoint0;
							firstHitValid = true;
						} else {

							firstHitNormal = vec3f( 0.0, 0.0, 0.0 );
							firstHitDepth = 0.0;
							firstHitPosition = vec3f( 0.0 );
							firstHitValid = false;
						}
					}

					if ( hitType == 0u ) {
						radiance += throughput * skyRadiance( worldRay.direction, sunDir, sunColor );
						break;
					}

				let hitPoint = worldRay.origin + worldRay.direction * hitDist;

				// Direct lighting with shadow ray
				var directLight = vec3f( 0.0 );
				var shadowRay: Ray;
				shadowRay.origin = ( worldToModelMatrix * vec4f( hitPoint + hitNormal * 0.01, 1.0 ) ).xyz;
				shadowRay.direction = normalize( ( worldToModelMatrix * vec4f( sunDir, 0.0 ) ).xyz );
				let shadowHit = bvh2IntersectFirstHitF32( geom_index, geom_position, bvh, shadowRay, rootIndex );

				var inShadow = shadowHit.didHit;

				// Also check shadow against boxes (unrolled)
				let shadowOrigin = hitPoint + hitNormal * 0.01;
				if ( !inShadow && intersectBox( shadowOrigin, sunDir, box0Min, box0Max ) > 0.0 ) { inShadow = true; }
				if ( !inShadow && intersectBox( shadowOrigin, sunDir, box1Min, box1Max ) > 0.0 ) { inShadow = true; }
				if ( !inShadow && intersectBox( shadowOrigin, sunDir, box2Min, box2Max ) > 0.0 ) { inShadow = true; }
				if ( !inShadow && intersectBox( shadowOrigin, sunDir, box3Min, box3Max ) > 0.0 ) { inShadow = true; }
				if ( !inShadow && intersectBox( shadowOrigin, sunDir, box4Min, box4Max ) > 0.0 ) { inShadow = true; }
				if ( !inShadow && intersectBox( shadowOrigin, sunDir, box5Min, box5Max ) > 0.0 ) { inShadow = true; }
				if ( !inShadow && intersectBox( shadowOrigin, sunDir, box6Min, box6Max ) > 0.0 ) { inShadow = true; }
				if ( !inShadow && intersectBox( shadowOrigin, sunDir, box7Min, box7Max ) > 0.0 ) { inShadow = true; }
				if ( !inShadow && intersectBox( shadowOrigin, sunDir, box8Min, box8Max ) > 0.0 ) { inShadow = true; }
				if ( !inShadow && intersectBox( shadowOrigin, sunDir, box9Min, box9Max ) > 0.0 ) { inShadow = true; }

				if ( !inShadow ) {
					let NdotL = max( 0.0, dot( hitNormal, sunDir ) );
					directLight = sunColor * NdotL;
				}

				// Add direct lighting contribution
				radiance += throughput * hitColor * directLight;

				// Russian roulette after 2 bounces
				if ( bounce > 1u ) {
					let p = max( max( throughput.x, throughput.y ), throughput.z );
					if ( randomFloat( &rngSeed ) > p ) {
						break;
					}
					throughput /= p;
				}

				// Bounce - objects with metalness get reflections
				var bounceDir: vec3f;
				if ( hitMetalness > 0.01 ) {
					// Metallic surface: blend reflection and diffuse
					let reflectDir = reflect( worldRay.direction, hitNormal );
					let diffuseDir = cosineSampleHemisphere( hitNormal, &rngSeed );
					// Probabilistic selection based on metalness
					if ( randomFloat( &rngSeed ) < hitMetalness ) {
						// Specular reflection (roughness based on inverse metalness)
						let roughness = 0.1 * ( 1.0 - hitMetalness * 0.5 );
						let roughDir = cosineSampleHemisphere( reflectDir, &rngSeed );
						bounceDir = normalize( mix( reflectDir, roughDir, roughness ) );
						// Metallic reflection tints with surface color
						throughput *= mix( vec3f( 1.0 ), hitColor, hitMetalness );
					} else {
						// Diffuse
						bounceDir = diffuseDir;
						throughput *= hitColor;
					}
				} else {
					// Floor and matte surfaces: pure diffuse
					bounceDir = cosineSampleHemisphere( hitNormal, &rngSeed );
					throughput *= hitColor;
				}
					worldRay.origin = hitPoint + hitNormal * 0.001;
					worldRay.direction = bounceDir;
				} // end bounce loop

				totalRadiance += radiance;
			} // end sample loop

				// Average samples
				var finalRadiance = totalRadiance / f32( samples );

				textureStore( outputTex, indexUV, vec4f( finalRadiance, 1.0 ) );
				textureStore( guideTex, indexUV, vec4f( firstHitNormal, firstHitDepth ) );
				let hitMask = select( 0.0, 1.0, firstHitValid );
				textureStore( hitPosTex, indexUV, vec4f( firstHitPosition, hitMask ) );
			}
			fn normalizeSafe( v: vec3f, fallbackDir: vec3f ) -> vec3f {
				let lenSq = dot( v, v );
				if ( lenSq <= 1e-8 ) {
					return fallbackDir;
				}
				return v * inverseSqrt( lenSq );
			}

			fn vmfPdf( direction: vec3f, mu: vec3f, kappaInput: f32 ) -> f32 {
				let kappa = clamp( kappaInput, 1e-3, 3000.0 );
				let alignment = clamp( dot( mu, direction ), -1.0, 1.0 );
				let norm = kappa / ( 6.28318530718 * max( 1.0 - exp( -2.0 * kappa ), 1e-6 ) );
				return max( norm * exp( kappa * ( alignment - 1.0 ) ), 0.0 );
			}

			fn skyRadiance( dir: vec3f, sunDirection: vec3f, sunColor: vec3f ) -> vec3f {
				let skyDir = normalize( dir );
				let skyT = clamp( 0.5 * ( skyDir.y + 1.0 ), 0.0, 1.0 );
				let baseSky = mix( vec3f( 0.02, 0.03, 0.05 ), vec3f( 0.12, 0.17, 0.26 ), skyT );
				let sunDirSafe = normalizeSafe( sunDirection, vec3f( 0.0, 1.0, 0.0 ) );
				let sunDot = 0.5 * ( 1.0 + dot( sunDirSafe, skyDir ) );
				let broadLobe = 0.5 * pow( max( sunDot, 0.0 ), 4.0 );
				let sharpLobe = 5.0 * vmfPdf( skyDir, sunDirSafe, 3000.0 );
				return baseSky + max( sunColor, vec3f( 0.0 ) ) * ( broadLobe + sharpLobe );
			}


		`, [ ndcToCameraRay, intersectsTriangle, intersectsBoundsBVH2, bvh2NodeStruct, intersectionResultStruct, constants, utils ] );

	computeKernel = computeShader( computeShaderParams ).computeKernel( WORKGROUP_SIZE );

	const presentShader = wgslFn( /* wgsl */`
		fn present(
			inputTex: texture_2d<f32>,
			outputTex: texture_storage_2d<rgba8unorm, write>,
			exposure: f32,
			workgroupSize: vec3u,
			workgroupId: vec3u,
			localId: vec3u
		) -> void {
			let dimensions = textureDimensions( outputTex );
			let indexUV = workgroupSize.xy * workgroupId.xy + localId.xy;
			if ( indexUV.x >= dimensions.x || indexUV.y >= dimensions.y ) { return; }

			var color = textureLoad( inputTex, vec2i( indexUV ), 0 ).rgb * exposure;
			color = color / ( color + vec3f( 1.0 ) ); // Reinhard tone map
			color = pow( color, vec3f( 1.0 / 2.2 ) ); // Gamma
			textureStore( outputTex, indexUV, vec4f( color, 1.0 ) );
		}
	` );

	presentShaderParams = {
		inputTex: texture( radianceTex ),
		outputTex: textureStore( outputTex ),
		exposure: uniform( params.exposure ),
		workgroupSize: uniform( new THREE.Vector3() ),
		workgroupId: workgroupId,
		localId: localId
	};

	presentKernel = presentShader( presentShaderParams ).computeKernel( WORKGROUP_SIZE );

	// Fullscreen quad for display
	const vUv = varyingProperty( 'vec2', 'vUv' );
	const vertexShader = wgslFn( /* wgsl */`
		fn vertex( position: vec3f, uv: vec2f ) -> vec3f {
			varyings.vUv = uv;
			return position;
		}
	`, [ vUv ] );

	fsMaterial = new MeshBasicNodeMaterial();
	fsMaterial.positionNode = vertexShader( {
		position: attribute( 'position' ),
		uv: attribute( 'uv' )
	} );
	fsMaterial.colorNode = colorSpaceToWorking( texture( outputTex, vUv ), THREE.SRGBColorSpace );
	fsQuad = new FullScreenQuad( fsMaterial );

}

function setupGUI() {

	gui = new GUI();
	gui.add( params, 'pause' ).onChange( ( v ) => {

		if ( animationAction ) animationAction.paused = v;

	} );
	gui.add( params, 'rebuildEveryFrame' );
	gui.add( params, 'useRefit' ).name( 'use refit' );
	if ( hasTimestampQuery ) {

		gui.add( params, 'useGpuTimestamps' ).name( 'gpu timestamps' );

	}

	gui.add( params, 'smoothNormals' );
	gui.add( params, 'floorY', - 1, 1, 0.05 ).name( 'floor height' );
	gui.add( params, 'walkSpeed', - 5, 5, 0.1 ).name( 'walk speed' );
	gui.add( params, 'samples', 1, 8, 1 ).name( 'samples per pixel' );
	const sunFolder = gui.addFolder( 'sun' );
	sunFolder.add( params, 'sunAzimuth', - 180.0, 180.0, 1.0 ).name( 'azimuth' );
	sunFolder.add( params, 'sunElevation', - 5.0, 89.0, 1.0 ).name( 'elevation' );
	sunFolder.add( params, 'sunTemperature', 1500.0, 12000.0, 50.0 ).name( 'temperature (K)' );
	sunFolder.add( params, 'sunBrightness', 0.0, 12.0, 0.1 ).name( 'brightness' );
	gui.add( params, 'exposure', 0.6, 2.0, 0.05 );
	gui.add( params, 'skeletonHelper' ).onChange( ( v ) => {

		if ( skeletonHelper ) skeletonHelper.visible = v;

	} );
	gui.add( params, 'resolutionScale', 0.1, 1, 0.1 ).onChange( resize );

}

async function rebuildBVH() {

	// Prevent concurrent builds
	if ( buildInProgress ) return;
	buildInProgress = true;

	try {

		// GPU Skinning - much faster than CPU!
		const skinStart = performance.now();
		await runGPUSkinning();
		const skinTime = performance.now() - skinStart;

		// Update BVH directly from GPU skinning output (no CPU readback!)
		const buildStart = performance.now();
		const useGpuTimestamps = hasTimestampQuery && params.useGpuTimestamps;
		let refitGpuLeaves = null;
		let refitGpuInternal = null;
		let refitGpuTotal = null;
		let rebuildGpuSetup = null;
		let rebuildGpuSort = null;
		let rebuildGpuHploc = null;
		if ( params.useRefit ) {

			if ( useGpuTimestamps ) {

				await gpuBVH.refit( { debugTiming: true } );
				const passTimings = gpuBVH.passTimings;
				refitGpuLeaves = passTimings.refitLeaves ?? null;
				refitGpuInternal = passTimings.refitInternal ?? null;
				refitGpuTotal = passTimings.refitGpuTotal ?? null;

			} else {

				await gpuBVH.refitAsync();

			}

		} else {

			if ( useGpuTimestamps ) {

				await gpuBVH.buildAsyncFromGPUBuffers( {
					positionBuffer: gpuPositionBuffer,
					indexBuffer: gpuIndexBuffer,
					primCount: triCount,
					positionStride: 4,
					debugTiming: true,
				} );
				const passTimings = gpuBVH.passTimings;
				rebuildGpuSetup = passTimings.setup ?? null;
				rebuildGpuSort = passTimings.sort ?? null;
				rebuildGpuHploc = passTimings.hploc ?? null;

			} else {

				await gpuBVH.buildAsyncFromGPUBuffers( {
					positionBuffer: gpuPositionBuffer,
					indexBuffer: gpuIndexBuffer,
					primCount: triCount,
					positionStride: 4,
				} );

			}

		}

		const encodeTime = performance.now() - buildStart;

		// Update running averages
		frameCount ++;
		const alpha = Math.min( frameCount, 60 );
		avgSkinTime += ( skinTime - avgSkinTime ) / alpha;
		avgEncodeTime += ( encodeTime - avgEncodeTime ) / alpha;

		// GPU→GPU copy BVH data (no CPU readback stall!)
		// Use maxNodeCount as upper bound since exact nodeCount isn't known without CPU readback
		const maxNodeCount = gpuBVH.maxNodeCount;
		const backend = renderer.backend;

		// GPU→GPU copy (fast path - no CPU roundtrip)
		const bvhDst = backend.get( bvh2Nodes );
		const rootIndexDst = backend.get( rootIndexBuffer );
		if ( bvhDst && bvhDst.buffer && rootIndexDst && rootIndexDst.buffer ) {

			const byteLength = maxNodeCount * 32; // 8 floats * 4 bytes
			const commandEncoder = device.createCommandEncoder();
			commandEncoder.copyBufferToBuffer( gpuBVH.bvh2Buffer, 0, bvhDst.buffer, 0, byteLength );
			// Copy root index from clusterIdx[0] (4 bytes)
			commandEncoder.copyBufferToBuffer( gpuBVH.clusterIdxBuffer, 0, rootIndexDst.buffer, 0, 4 );
			device.queue.submit( [ commandEncoder.finish() ] );
			// No await needed - queue ordering guarantees copy completes before ray trace

		}

		// Update display
		let output = `triangles: ${triCount}\n`;
		output += `GPU skinning: ${skinTime.toFixed( 2 )} ms (avg: ${avgSkinTime.toFixed( 2 )})\n`;
		output += `${params.useRefit ? 'BVH refit' : 'BVH encode'}: ${encodeTime.toFixed( 2 )} ms (avg: ${avgEncodeTime.toFixed( 2 )})\n`;
		output += `sun: az ${params.sunAzimuth.toFixed( 0 )}°, el ${params.sunElevation.toFixed( 0 )}°, ${params.sunTemperature.toFixed( 0 )}K, b ${params.sunBrightness.toFixed( 1 )}\n`;
		output += `exposure: ${params.exposure.toFixed( 2 )}\n`;
		if ( refitGpuTotal !== null && refitGpuLeaves !== null && refitGpuInternal !== null ) {

			output += `refit GPU timestamps: total ${refitGpuTotal.toFixed( 2 )} ms (leaves ${refitGpuLeaves.toFixed( 2 )}, internal ${refitGpuInternal.toFixed( 2 )})\n`;

		}

		if ( rebuildGpuSetup !== null && rebuildGpuSort !== null && rebuildGpuHploc !== null ) {

			const rebuildGpuTotal = rebuildGpuSetup + rebuildGpuSort + rebuildGpuHploc;
			output += `rebuild GPU timestamps: total ${rebuildGpuTotal.toFixed( 2 )} ms (setup ${rebuildGpuSetup.toFixed( 2 )}, sort ${rebuildGpuSort.toFixed( 2 )}, hploc ${rebuildGpuHploc.toFixed( 2 )})\n`;

		}

		const modePrefix = useGpuTimestamps ? 'timed (timestamp readback)' : 'zero CPU readback';
		output += `mode: fully GPU (${modePrefix}, ${params.useRefit ? 'refit' : 'rebuild'})`;

		outputContainer.textContent = output;

	} finally {

		buildInProgress = false;

	}

}

function resize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	const dpr = window.devicePixelRatio;
	const scale = params.resolutionScale;
	renderWidth = Math.max( 1, Math.floor( w * dpr * scale ) );
	renderHeight = Math.max( 1, Math.floor( h * dpr * scale ) );

	camera.aspect = w / h;
	camera.updateProjectionMatrix();

	renderer.setSize( w, h );
	renderer.setPixelRatio( dpr );

	const staleTextures = [ outputTex, radianceTex, guideTex, hitPosTex ];

	outputTex = createStorageTexture( renderWidth, renderHeight, THREE.UnsignedByteType );
	radianceTex = createStorageTexture( renderWidth, renderHeight, THREE.HalfFloatType );
	guideTex = createStorageTexture( renderWidth, renderHeight, THREE.HalfFloatType );
	hitPosTex = createStorageTexture( renderWidth, renderHeight, THREE.HalfFloatType );

	disposeTexturesWhenQueueIdle( staleTextures );

	frameCount = 0;

}

async function render() {

	stats.update();

	const delta = Math.min( clock.getDelta(), 0.033 );

	if ( mixer ) {

		mixer.update( delta );

	}

	if ( skeletonHelper ) {

		skeletonHelper.visible = params.skeletonHelper;

	}

	// Update skeleton matrices before skinning
	scene.updateMatrixWorld( true );

	// Rebuild BVH every frame if enabled (awaited to ensure consistent data)
	if ( params.rebuildEveryFrame && ! params.pause && skinnedMeshes && skinnedMeshes.length > 0 && ! buildInProgress ) {

		await rebuildBVH();

	}

	// Path trace
	if ( computeKernel && presentKernel && outputTex && radianceTex && guideTex && hitPosTex && model ) {

		dispatchSize = [
			Math.ceil( renderWidth / WORKGROUP_SIZE[ 0 ] ),
			Math.ceil( renderHeight / WORKGROUP_SIZE[ 1 ] ),
		];

		camera.updateMatrixWorld();
		model.updateMatrixWorld();

		// Set up transform matrices for world-space floor + model-space BVH intersection
		const modelMatrix = skinnedMeshes[ 0 ].matrixWorld;
		const modelMatrixInverse = modelMatrix.clone().invert();
		const sunDirWorld = sunDirectionFromAngles( params.sunAzimuth, params.sunElevation, sunDirectionVec );
		const sunLightColor = sunColorFromTemperature( params.sunTemperature, sunColorVec ).multiplyScalar( Math.max( params.sunBrightness, 0.0 ) );

		computeKernel.computeNode.parameters.outputTex.value = radianceTex;
		computeKernel.computeNode.parameters.guideTex.value = guideTex;
		computeKernel.computeNode.parameters.hitPosTex.value = hitPosTex;
		computeKernel.computeNode.parameters.smoothNormals.value = Number( params.smoothNormals );
		computeKernel.computeNode.parameters.inverseProjectionMatrix.value = camera.projectionMatrixInverse;
		computeKernel.computeNode.parameters.cameraToWorldMatrix.value.copy( camera.matrixWorld );
		computeKernel.computeNode.parameters.worldToModelMatrix.value.copy( modelMatrixInverse );
		computeKernel.computeNode.parameters.modelToWorldMatrix.value.copy( modelMatrix );
		computeKernel.computeNode.parameters.floorY.value = params.floorY;
		computeKernel.computeNode.parameters.time.value = clock.getElapsedTime();
		computeKernel.computeNode.parameters.walkSpeed.value = params.walkSpeed;
		computeKernel.computeNode.parameters.sunDirection.value.copy( sunDirWorld );
		computeKernel.computeNode.parameters.sunColor.value.copy( sunLightColor );
		computeKernel.computeNode.parameters.frameCount.value = frameCount;
		computeKernel.computeNode.parameters.samples.value = params.samples;
		computeKernel.computeNode.parameters.workgroupSize.value.fromArray( WORKGROUP_SIZE );

		renderer.compute( computeKernel, dispatchSize );
		presentKernel.computeNode.parameters.inputTex.value = radianceTex;
		presentKernel.computeNode.parameters.outputTex.value = outputTex;
		presentKernel.computeNode.parameters.exposure.value = params.exposure;
		presentKernel.computeNode.parameters.workgroupSize.value.fromArray( WORKGROUP_SIZE );
		renderer.compute( presentKernel, dispatchSize );

		fsMaterial.colorNode.colorNode.value = outputTex;
		fsQuad.render( renderer );

		if ( skeletonHelper && params.skeletonHelper ) {

			// The main image is path traced via compute + fullscreen quad, so helper lines
			// need an explicit raster overlay pass.
			const previousAutoClear = renderer.autoClear;
			renderer.autoClear = false;
			renderer.render( helperScene, camera );
			renderer.autoClear = previousAutoClear;

		}

	}

}
