import * as THREE from 'three';
import { WebGPURenderer, StorageBufferAttribute, StorageTexture, MeshBasicNodeMaterial } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import Stats from 'three/addons/libs/stats.module.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import {
	attribute, uniform, wgslFn, varyingProperty,
	textureStore, texture, colorSpaceToWorking,
	storage, workgroupId, localId,
} from 'three/tsl';

// three-mesh-bvh
import { MeshBVH, SAH } from 'three-mesh-bvh';
import { GPUMeshBVH, SorterType } from 'three-mesh-bvh/src/gpu/index.js';
import { ndcToCameraRay, bvh2IntersectFirstHit, getVertexAttribute } from 'three-mesh-bvh/webgpu';

// Geometry types
const GeometryType = {
	SPHERE: 'sphere',
	TORUS: 'torus',
	INFERNO_BEAST: 'infernoBeast',
	TREX: 'trex',
};

// Read sorter type from URL params (persists across refresh)
function getSorterFromURL() {

	const urlParams = new URLSearchParams( window.location.search );
	const sorter = urlParams.get( 'sorter' );
	if ( sorter === 'onesweep' ) return SorterType.ONESWEEP;
	return SorterType.BUILTIN;

}

// Read geometry type from URL params
function getGeometryFromURL() {

	const urlParams = new URLSearchParams( window.location.search );
	const geometry = urlParams.get( 'geometry' );
	if ( geometry === 'sphere' ) return GeometryType.SPHERE;
	if ( geometry === 'infernoBeast' ) return GeometryType.INFERNO_BEAST;
	if ( geometry === 'trex' ) return GeometryType.TREX;
	return GeometryType.TORUS; // default

}

const params = {
	enableRaytracing: true,
	animate: true,
	resolutionScale: 0.1, // Low for BVH build testing (not traversal)
	smoothNormals: true,
	useBVH2: true, // true = BVH2 direct traversal (no flatten), false = flattened BVH
	sorterType: getSorterFromURL(),
	geometryType: getGeometryFromURL(),
};

// Geometry loading functions
async function loadGeometry( type ) {

	switch ( type ) {

		case GeometryType.SPHERE:
			return new THREE.SphereGeometry( 1, 128, 64 ); // ~16k tris

		case GeometryType.INFERNO_BEAST:
			return await loadInfernoBeast();

		case GeometryType.TREX:
			return await loadTRex();

		case GeometryType.TORUS:
		default:
			return new THREE.TorusKnotGeometry( 1, 0.3, 1000, 150 ); // ~300k tris

	}

}

async function loadInfernoBeast() {

	const loader = new GLTFLoader();

	return new Promise( ( resolve, reject ) => {

		loader.load(
			'/inferno-beast-from-space-from-jurafjvs-cc0-2.glb',
			( gltf ) => {

				// Merge all meshes from the model
				const geometries = [];

				gltf.scene.traverse( ( child ) => {

					if ( child.isMesh && child.geometry ) {

						const geom = child.geometry.clone();
						child.updateWorldMatrix( true, false );
						geom.applyMatrix4( child.matrixWorld );
						geometries.push( geom );

					}

				} );

				if ( geometries.length === 0 ) {

					reject( new Error( 'No meshes found in GLB' ) );
					return;

				}

				// Merge into single geometry
				const merged = mergeGeometries( geometries );

				// Scale and center
				merged.computeBoundingBox();
				const box = merged.boundingBox;
				const center = box.getCenter( new THREE.Vector3() );
				const size = box.getSize( new THREE.Vector3() );
				const maxDim = Math.max( size.x, size.y, size.z );
				const scale = 2.0 / maxDim;

				const matrix = new THREE.Matrix4()
					.makeScale( scale, scale, scale )
					.multiply( new THREE.Matrix4().makeTranslation( - center.x, - center.y, - center.z ) );
				merged.applyMatrix4( matrix );

				resolve( merged );

			},
			undefined,
			( error ) => reject( new Error( `Failed to load GLB: ${error.message}` ) )
		);

	} );

}

async function loadTRex() {

	const loader = new GLTFLoader();

	return new Promise( ( resolve, reject ) => {

		loader.load(
			'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/trex/scene.gltf',
			( gltf ) => {

				// Merge all meshes from the model
				const geometries = [];

				gltf.scene.traverse( ( child ) => {

					if ( child.isMesh && child.geometry ) {

						const geom = child.geometry.clone();
						child.updateWorldMatrix( true, false );
						geom.applyMatrix4( child.matrixWorld );
						geometries.push( geom );

					}

				} );

				if ( geometries.length === 0 ) {

					reject( new Error( 'No meshes found in GLTF' ) );
					return;

				}

				// Merge into single geometry
				const merged = mergeGeometries( geometries );

				// Scale and center
				merged.computeBoundingBox();
				const box = merged.boundingBox;
				const center = box.getCenter( new THREE.Vector3() );
				const size = box.getSize( new THREE.Vector3() );
				const maxDim = Math.max( size.x, size.y, size.z );
				const scale = 2.0 / maxDim;

				const matrix = new THREE.Matrix4()
					.makeScale( scale, scale, scale )
					.multiply( new THREE.Matrix4().makeTranslation( - center.x, - center.y, - center.z ) );
				merged.applyMatrix4( matrix );

				resolve( merged );

			},
			undefined,
			( error ) => reject( new Error( `Failed to load GLTF: ${error.message}` ) )
		);

	} );

}

function mergeGeometries( geometriesArray ) {

	// Count total triangles
	let totalTriangles = 0;
	for ( const geom of geometriesArray ) {

		if ( geom.index ) {

			totalTriangles += geom.index.count / 3;

		} else {

			totalTriangles += geom.attributes.position.count / 3;

		}

	}

	const positions = new Float32Array( totalTriangles * 9 );
	let offset = 0;

	for ( const geom of geometriesArray ) {

		const posAttr = geom.attributes.position;
		const indexAttr = geom.index;

		if ( indexAttr ) {

			for ( let i = 0; i < indexAttr.count; i ++ ) {

				const idx = indexAttr.array[ i ];
				positions[ offset ++ ] = posAttr.getX( idx );
				positions[ offset ++ ] = posAttr.getY( idx );
				positions[ offset ++ ] = posAttr.getZ( idx );

			}

		} else {

			const arr = posAttr.array;
			for ( let i = 0; i < arr.length; i ++ ) {

				positions[ offset ++ ] = arr[ i ];

			}

		}

	}

	const merged = new THREE.BufferGeometry();
	merged.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
	merged.computeVertexNormals();

	// Generate index buffer (needed for BVH)
	const indexCount = totalTriangles * 3;
	const indices = new Uint32Array( indexCount );
	for ( let i = 0; i < indexCount; i ++ ) {

		indices[ i ] = i;

	}

	merged.setIndex( new THREE.BufferAttribute( indices, 1 ) );

	return merged;

}

let renderer, camera, scene, gui, stats;
let fsQuad, mesh, clock;
let fsMaterial, computeKernelBVH2, computeKernelFlattened, outputTex;
let dispatchSize = [];
const WORKGROUP_SIZE = [ 8, 8, 1 ];

init();

async function init() {

	// Request GPU adapter and device with required features and limits
	const adapter = await navigator.gpu.requestAdapter();

	// Build feature list based on adapter support
	const requiredFeatures = [];
	if ( adapter.features.has( 'timestamp-query' ) ) {

		requiredFeatures.push( 'timestamp-query' );

	}

	if ( adapter.features.has( 'subgroups' ) ) {

		requiredFeatures.push( 'subgroups' );

	}

	const device = await adapter.requestDevice( {
		requiredFeatures,
		requiredLimits: {
			maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
			maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage,
		},
	} );

	// renderer
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
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.01, 100 );
	camera.position.set( 0, 0, 4 );
	camera.updateProjectionMatrix();

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// Load geometry based on URL param
	console.log( `Loading geometry: ${params.geometryType}` );
	const knotGeometry = await loadGeometry( params.geometryType );
	mesh = new THREE.Mesh( knotGeometry, new THREE.MeshStandardMaterial() );
	scene.add( mesh );

	// Build CPU BVH for comparison
	const cpuStart = performance.now();
	const cpuBVH = new MeshBVH( knotGeometry.clone(), { maxLeafTris: 1, strategy: SAH } );
	const cpuBuildTime = performance.now() - cpuStart;

	// Build GPU BVH (without flatten - use BVH2 directly)
	// Set debugTiming: true to see per-phase breakdown (adds ~1ms overhead from awaits)
	// Set debugTiming: false (default) for production single-submission build
	// Sorter options: 'builtin' (original), 'simple' (refactored), 'onesweep' (high-perf)
	const gpuBVH = new GPUMeshBVH( device, { sorterType: params.sorterType } );
	await gpuBVH.build( knotGeometry, { useFlatten: false, debugTiming: false } );
	console.log( `Using sorter: ${gpuBVH.sorterType}` );

	// Read back BVH2 format
	const bvh2Array = await readbackBVH( device, gpuBVH.bvh2Buffer, gpuBVH.nodeCount );
	const rootIndex = gpuBVH.rootIndex;
	logBVHStats( knotGeometry, bvh2Array, gpuBVH, cpuBVH, cpuBuildTime, rootIndex );

	// Note: Flattened BVH toggle disabled since we're not building it
	// To re-enable comparison, change useFlatten to true above

	// animation
	clock = new THREE.Clock();

	// TSL - shared geometry buffers
	const geom_index = new StorageBufferAttribute( knotGeometry.index.array, 3 );
	const geom_position = new StorageBufferAttribute( knotGeometry.attributes.position.array, 3 );
	const geom_normals = new StorageBufferAttribute( knotGeometry.attributes.normal.array, 3 );

	// BVH2 (direct, no flatten) compute kernel
	const bvh2Nodes = new StorageBufferAttribute( bvh2Array, 8 );
	const computeShaderParamsBVH2 = {
		outputTex: textureStore( outputTex ),
		smoothNormals: uniform( 1 ),
		rootIndex: uniform( rootIndex ),
		inverseProjectionMatrix: uniform( new THREE.Matrix4() ),
		cameraToModelMatrix: uniform( new THREE.Matrix4() ),
		geom_index: storage( geom_index, 'uvec3', geom_index.count ).toReadOnly(),
		geom_position: storage( geom_position, 'vec3', geom_position.count ).toReadOnly(),
		geom_normals: storage( geom_normals, 'vec3', geom_normals.count ).toReadOnly(),
		bvh: storage( bvh2Nodes, 'BVH2Node', bvh2Nodes.count ).toReadOnly(),
		workgroupSize: uniform( new THREE.Vector3() ),
		workgroupId: workgroupId,
		localId: localId
	};

	const computeShaderBVH2 = wgslFn( /* wgsl */`
		fn compute(
			outputTex: texture_storage_2d<rgba8unorm, write>,
			smoothNormals: u32,
			rootIndex: u32,
			inverseProjectionMatrix: mat4x4f,
			cameraToModelMatrix: mat4x4f,
			geom_position: ptr<storage, array<vec3f>, read>,
			geom_index: ptr<storage, array<vec3u>, read>,
			geom_normals: ptr<storage, array<vec3f>, read>,
			bvh: ptr<storage, array<BVH2Node>, read>,
			workgroupSize: vec3u,
			workgroupId: vec3u,
			localId: vec3u,
		) -> void {
			let dimensions = textureDimensions( outputTex );
			let indexUV = workgroupSize.xy * workgroupId.xy + localId.xy;
			let uv = vec2f( indexUV ) / vec2f( dimensions );
			let ndc = uv * 2.0 - vec2f( 1.0 );
			var ray = ndcToCameraRay( ndc, cameraToModelMatrix * inverseProjectionMatrix );
			let hitResult = bvh2IntersectFirstHit( geom_index, geom_position, bvh, ray, rootIndex );
			if ( hitResult.didHit && hitResult.dist < 1.0 ) {
				let normal = select(
					hitResult.normal,
					normalize( getVertexAttribute( hitResult.barycoord, hitResult.indices.xyz, geom_normals ) ),
					smoothNormals > 0u,
				);
				textureStore( outputTex, indexUV, vec4f( normal, 1.0 ) );
			} else {
				let background = vec4f( 0.0366, 0.0813, 0.1057, 1.0 );
				textureStore( outputTex, indexUV, background );
			}
		}
	`, [ ndcToCameraRay, bvh2IntersectFirstHit, getVertexAttribute ] );

	computeKernelBVH2 = computeShaderBVH2( computeShaderParamsBVH2 ).computeKernel( WORKGROUP_SIZE );

	// Flattened BVH kernel not created (useFlatten: false)
	// Toggle will only use BVH2
	computeKernelFlattened = null;

	// screen quad
	const vUv = varyingProperty( 'vec2', 'vUv' );
	const wgslVertexShader = wgslFn( /* wgsl */`
		fn vertex( position: vec3f, uv: vec2f ) -> vec3f {
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
	new OrbitControls( camera, renderer.domElement );

	// gui
	gui = new GUI();
	gui.add( params, 'enableRaytracing' );
	gui.add( params, 'animate' );
	gui.add( params, 'smoothNormals' );
	// gui.add( params, 'useBVH2' ).name( 'BVH2 (no flatten)' ); // Toggle disabled - using BVH2 only
	gui.add( params, 'resolutionScale', 0.1, 1, 0.01 ).onChange( resize );
	gui.add( params, 'sorterType', {
		'Built-in': SorterType.BUILTIN,
		'OneSweep': SorterType.ONESWEEP,
	} ).name( 'Sorter' ).onChange( ( value ) => {

		const url = new URL( window.location );
		if ( value === SorterType.BUILTIN ) {

			url.searchParams.delete( 'sorter' );

		} else {

			url.searchParams.set( 'sorter', value );

		}

		window.location.href = url.toString();

	} );
	gui.add( params, 'geometryType', {
		'Sphere (16k)': GeometryType.SPHERE,
		'Torus Knot (300k)': GeometryType.TORUS,
		'Inferno Beast (900k)': GeometryType.INFERNO_BEAST,
		'T-Rex (4k)': GeometryType.TREX,
	} ).name( 'Geometry' ).onChange( ( value ) => {

		const url = new URL( window.location );
		if ( value === GeometryType.TORUS ) {

			url.searchParams.delete( 'geometry' );

		} else {

			url.searchParams.set( 'geometry', value );

		}

		window.location.href = url.toString();

	} );
	gui.open();

	// resize
	window.addEventListener( 'resize', resize, false );
	resize();

	// start animation loop after everything is initialized
	renderer.setAnimationLoop( render );

}

async function readbackBVH( device, bvhBuffer, nodeCount ) {

	const byteLength = nodeCount * 32;
	const readBuffer = device.createBuffer( {
		size: byteLength,
		usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
	} );

	const commandEncoder = device.createCommandEncoder();
	commandEncoder.copyBufferToBuffer( bvhBuffer, 0, readBuffer, 0, byteLength );
	device.queue.submit( [ commandEncoder.finish() ] );

	await readBuffer.mapAsync( GPUMapMode.READ );
	const mapped = readBuffer.getMappedRange();
	const copy = mapped.slice( 0 );
	readBuffer.unmap();
	readBuffer.destroy();

	return new Float32Array( copy );

}

function logBVHStats( geometry, bvhArray, gpuBVH, cpuBVH, cpuBuildTime, rootIndex ) {

	const primCount = Math.floor( geometry.index.count / 3 );
	const gpuNodeCount = gpuBVH.nodeCount;
	const gpuBuildTime = gpuBVH.buildTimeMs;

	geometry.computeBoundingBox();
	const bounds = geometry.boundingBox;

	// BVH2 node layout: boundsMin (vec3f), leftChild (u32), boundsMax (vec3f), rightChild (u32)
	// Each node is 8 floats = 32 bytes
	const rootOffset = rootIndex * 8;
	const rootMin = new THREE.Vector3( bvhArray[ rootOffset + 0 ], bvhArray[ rootOffset + 1 ], bvhArray[ rootOffset + 2 ] );
	const rootMax = new THREE.Vector3( bvhArray[ rootOffset + 4 ], bvhArray[ rootOffset + 5 ], bvhArray[ rootOffset + 6 ] );

	const okMin = rootMin.x <= bounds.min.x + 1e-3 && rootMin.y <= bounds.min.y + 1e-3 && rootMin.z <= bounds.min.z + 1e-3;
	const okMax = rootMax.x >= bounds.max.x - 1e-3 && rootMax.y >= bounds.max.y - 1e-3 && rootMax.z >= bounds.max.z - 1e-3;
	const boundsOk = okMin && okMax;

	// Expected nodes for a binary tree: 2n - 1 internal + leaf nodes
	const expectedNodes = 2 * primCount - 1;
	const nodeCountOk = gpuNodeCount >= primCount && gpuNodeCount <= 2 * primCount;

	// CPU BVH stats
	const cpuNodeCount = cpuBVH._roots[ 0 ].byteLength / 32; // 32 bytes per node

	const speedup = cpuBuildTime / gpuBuildTime;

	const infoEl = document.getElementById( 'info' );
	if ( infoEl ) {

		infoEl.textContent = `${ primCount } tris | GPU: ${ gpuBuildTime.toFixed( 1 ) }ms | CPU: ${ cpuBuildTime.toFixed( 1 ) }ms | Speedup: ${ speedup.toFixed( 1 ) }x`;

	}

	console.log( '=== BVH Build Comparison ===' );
	console.log( `Triangles: ${ primCount }` );
	console.log( '' );
	console.log( '--- GPU BVH2 (H-PLOC, no flatten) ---' );
	console.log( `Nodes: ${ gpuNodeCount } (expected ~${ expectedNodes }, ok: ${ nodeCountOk })` );
	console.log( `Root index: ${ rootIndex }` );
	console.log( `Build time: ${ gpuBuildTime.toFixed( 2 ) }ms` );
	console.log( `Throughput: ${ ( primCount / gpuBuildTime * 1000 / 1000 ).toFixed( 1 ) }k tris/sec` );

	// CPU prep timing (geometry extraction, buffer allocation, upload)
	const prep = gpuBVH.cpuPrepTimings;
	if ( prep ) {

		console.log( '' );
		console.log( 'CPU prep breakdown:' );
		console.log( `  Geometry extract: ${ prep.extract.toFixed( 2 ) }ms (${ ( prep.extract / gpuBuildTime * 100 ).toFixed( 1 ) }%)` );
		console.log( `  Buffer alloc:     ${ prep.alloc.toFixed( 2 ) }ms (${ ( prep.alloc / gpuBuildTime * 100 ).toFixed( 1 ) }%)` );
		console.log( `  Geometry upload:  ${ prep.upload.toFixed( 2 ) }ms (${ ( prep.upload / gpuBuildTime * 100 ).toFixed( 1 ) }%)` );
		if ( prep.pipeline > 0.01 ) {

			console.log( `  Pipeline create:  ${ prep.pipeline.toFixed( 2 ) }ms (${ ( prep.pipeline / gpuBuildTime * 100 ).toFixed( 1 ) }%)` );

		}

		if ( prep.sorterInit > 0.01 ) {

			console.log( `  Sorter init:      ${ prep.sorterInit.toFixed( 2 ) }ms (${ ( prep.sorterInit / gpuBuildTime * 100 ).toFixed( 1 ) }%)` );

		}

		console.log( `  CPU prep total:   ${ prep.total.toFixed( 2 ) }ms (${ ( prep.total / gpuBuildTime * 100 ).toFixed( 1 ) }%)` );

	}

	// Pass breakdown (only available with debugTiming: true)
	const t = gpuBVH.passTimings;
	if ( t && t.setup !== undefined ) {

		console.log( '' );
		const timingMode = t.gpuTimestamps ? 'GPU timestamps' : 'multi-submit';
		console.log( `GPU pass breakdown (${ timingMode }):` );
		if ( t.setupBounds !== undefined ) {

			console.log( `  Bounds+init:   ${ t.setupBounds.toFixed( 2 ) }ms (${ ( t.setupBounds / gpuBuildTime * 100 ).toFixed( 1 ) }%)` );
			console.log( `  Morton codes:  ${ t.setupMorton.toFixed( 2 ) }ms (${ ( t.setupMorton / gpuBuildTime * 100 ).toFixed( 1 ) }%)` );

		}

		console.log( `  Setup total:   ${ t.setup.toFixed( 2 ) }ms (${ ( t.setup / gpuBuildTime * 100 ).toFixed( 1 ) }%)` );
		console.log( `  Radix sort:    ${ t.sort.toFixed( 2 ) }ms (${ ( t.sort / gpuBuildTime * 100 ).toFixed( 1 ) }%)` );
		console.log( `  H-PLOC (${ t.hplocIterations } iters): ${ t.hploc.toFixed( 2 ) }ms (${ ( t.hploc / gpuBuildTime * 100 ).toFixed( 1 ) }%)` );
		if ( t.flatten > 0 ) {

			console.log( `  Flatten:       ${ t.flatten.toFixed( 2 ) }ms (${ ( t.flatten / gpuBuildTime * 100 ).toFixed( 1 ) }%)` );

		}

		if ( t.readback > 0.01 ) {

			console.log( `  Readback:      ${ t.readback.toFixed( 2 ) }ms (${ ( t.readback / gpuBuildTime * 100 ).toFixed( 1 ) }%)` );

		}

		// Calculate GPU work total vs overhead
		const gpuWork = t.setup + t.sort + t.hploc + ( t.flatten || 0 );
		const overhead = gpuBuildTime - gpuWork - ( prep ? prep.total : 0 ) - ( t.readback || 0 );
		if ( overhead > 0.5 ) {

			console.log( `  Sync overhead: ~${ overhead.toFixed( 2 ) }ms (${ ( overhead / gpuBuildTime * 100 ).toFixed( 1 ) }%)` );

		}

	} else if ( t ) {

		console.log( '' );
		console.log( `Single-submission build (H-PLOC: ${ t.hplocIterations } iters)` );

	}

	console.log( '' );
	console.log( '--- CPU BVH (SAH) ---' );
	console.log( `Nodes: ${ cpuNodeCount.toFixed( 0 ) }` );
	console.log( `Build time: ${ cpuBuildTime.toFixed( 2 ) }ms` );
	console.log( `Throughput: ${ ( primCount / cpuBuildTime * 1000 / 1000 ).toFixed( 1 ) }k tris/sec` );
	console.log( '' );
	console.log( `>>> Speedup: ${ speedup.toFixed( 2 ) }x <<<` );
	console.log( '' );
	console.log( `Root bounds: min=${ rootMin.toArray().map( v => v.toFixed( 3 ) ) }, max=${ rootMax.toArray().map( v => v.toFixed( 3 ) ) }` );
	console.log( `Geometry bounds: min=${ bounds.min.toArray().map( v => v.toFixed( 3 ) ) }, max=${ bounds.max.toArray().map( v => v.toFixed( 3 ) ) }` );
	console.log( `Bounds check: ${ boundsOk ? 'PASS' : 'FAIL' }` );
	console.log( '=============================' );

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
		];

		camera.updateMatrixWorld();
		mesh.updateMatrixWorld();

		// Select kernel based on BVH mode (flattened may be null if not built)
		const computeKernel = ( params.useBVH2 || ! computeKernelFlattened ) ? computeKernelBVH2 : computeKernelFlattened;

		computeKernel.computeNode.parameters.outputTex.value = outputTex;
		computeKernel.computeNode.parameters.smoothNormals.value = Number( params.smoothNormals );
		computeKernel.computeNode.parameters.inverseProjectionMatrix.value = camera.projectionMatrixInverse;
		computeKernel.computeNode.parameters.cameraToModelMatrix.value.copy( mesh.matrixWorld ).invert().multiply( camera.matrixWorld );
		computeKernel.computeNode.parameters.workgroupSize.value.fromArray( WORKGROUP_SIZE );
		renderer.compute( computeKernel, dispatchSize );

		fsMaterial.colorNode.colorNode.value = outputTex;
		fsQuad.render( renderer );

	} else {

		renderer.render( scene, camera );

	}

}
