import * as THREE from 'three';
import { WebGPURenderer, StorageTexture, Storage3DTexture, StorageBufferAttribute, MeshBasicNodeMaterial } from 'three/webgpu';
import { uniform, wgslFn, globalId, storage, storageTexture, texture, colorSpaceToWorking } from 'three/tsl';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';

import { MeshBVH, SAH } from 'three-mesh-bvh';
import { BVHComputeData, ndcToCameraRay, wgslTagFn, rayStruct, rayIntersectionResultStruct, intersectRayTriangle } from 'three-mesh-bvh/webgpu';

import { RenderSDFLayerNodeMaterial } from './utils/RenderSDFLayerNodeMaterial';

// number of frames averaged per structure
const SAMPLE_COUNT = 30;
const RAYCAST_WORKGROUP_SIZE = [ 8, 8, 1 ];
const CLOSEST_POINT_WORKGROUP_SIZE = [ 4, 4, 4 ];

// tinybvh compiled to wasm by mutracer, built with its binned SAH builder in the BVH_GPU layout
const TINYBVH_WASM_URL = 'https://cdn.jsdelivr.net/npm/@meimu/mutracer@0.1.5/lib/tinybvh/tinybvh.wasm';
const TINYBVH_GPU_LAYOUT = 2;
const TINYBVH_STACK_DEPTH = 32;

// three-mesh-bvh packed node: 6 floats of bounds, then the right child offset or triangle
// offset, then the split axis, with the leaf count and flag in the last two u16
const NODE_U32 = 8;
const NODE_U16 = 16;
const LEAF_FLAG = 0xffff;

const params = {

	test: 'raycast',
	rays: 'camera',
	resolution: 64,
	margin: 0.2,
	display: 'tinybvh',

};

let renderer, camera, controls, gui;
let outputContainer, mesh, triangleCount;
let frame = 0;
const bounds = new THREE.Box3();
const structures = [];

init().then( render );

async function init() {

	outputContainer = document.getElementById( 'output' );

	// renderer setup
	renderer = new WebGPURenderer( { trackTimestamp: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	document.body.appendChild( renderer.domElement );
	await renderer.init();

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 1, 1, 2 );
	controls = new OrbitControls( camera, renderer.domElement );

	// load model - "model" in the url overrides the default
	const url = new URLSearchParams( window.location.search ).get( 'model' )
		|| 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/stanford-bunny/bunny.glb';
	const gltf = await new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.setDRACOLoader( new DRACOLoader() )
		.loadAsync( url );

	mesh = bakeTransforms( gltf.scene );
	bounds.setFromObject( mesh );

	const meshes = [];
	mesh.traverse( c => {

		if ( c.isMesh ) {

			meshes.push( c );

		}

	} );

	triangleCount = meshes.reduce( ( total, c ) => total + c.geometry.index.count / 3, 0 );

	// the structures are queried on alternating frames. Each is a tree built by one library and
	// traversed by one kernel, to separate the cost of the build from the cost of the traversal.
	// "leaf" in the url sets the SAH leaf size and "attributes" the number of vec4 vertex attributes
	// packed alongside the position.
	const urlParams = new URLSearchParams( window.location.search );
	const targetLeafSize = parseInt( urlParams.get( 'leaf' ) ) || 2;
	const attributeCount = parseInt( urlParams.get( 'attributes' ) ) || 1;
	const clusterSize = parseFloat( urlParams.get( 'cluster' ) ) || 64;

	// the scene as one mesh, for the structures that need a single geometry
	const soup = collectTriangles( meshes );
	const vertices = createVertexBuffer( soup.positions );
	const flatGeometry = new THREE.BufferGeometry();
	flatGeometry.setAttribute( 'position', new THREE.BufferAttribute( soup.positions, 3 ) );
	flatGeometry.setIndex( new THREE.BufferAttribute( soup.indices, 1 ) );
	const flat = new THREE.Mesh( flatGeometry );
	flat.updateMatrixWorld( true );

	// the scene as loaded, which the compute data clusters into a two level tree
	structures.push( await createStructure( 'BVH2', mesh, attributeCount ) );
	if ( meshes.length > 1 ) {

		meshes.forEach( c => c.geometry.boundsTree = new MeshBVH( c.geometry, { strategy: SAH, targetLeafSize } ) );
		structures.push( await createStructure( `BVH2 SAH leaf ${ targetLeafSize }, clusters of ${ clusterSize }`, mesh, attributeCount, clusterSize ) );

	}

	// the tree built like tinybvh's, SAH down to small leaves, under both kernels
	let startTime = window.performance.now();
	flatGeometry.boundsTree = new MeshBVH( flatGeometry, { strategy: SAH, targetLeafSize } );
	const buildTime = window.performance.now() - startTime;
	structures.push( await createStructure( `BVH2 SAH leaf ${ targetLeafSize }`, flat, attributeCount ) );
	structures.push( createTinyBvhTraversalStructure( `BVH2 SAH leaf ${ targetLeafSize }, tinybvh traversal`, packMeshBVHAsBvhGpu( flatGeometry ), vertices, buildTime ) );

	startTime = window.performance.now();
	const tiny = await buildTinyBvh( soup.positions, soup.indices );
	structures.push( createTinyBvhTraversalStructure( 'tinybvh', tiny.buffer, vertices, window.performance.now() - startTime ) );

	flatGeometry.boundsTree = unpackBvhGpuAsMeshBVH( tiny.buffer, flatGeometry );
	structures.push( await createStructure( 'tinybvh tree, BVH2 traversal', flat, attributeCount ) );

	// gui
	gui = new GUI();
	gui.add( params, 'test', [ 'raycast', 'closest point' ] ).onChange( resetTimes );
	gui.add( params, 'rays', [ 'camera', 'random' ] ).onChange( resetTimes );
	gui.add( params, 'resolution', 16, 128, 1 ).onChange( () => {

		structures.forEach( structure => {

			if ( structure.bvhData ) {

				createClosestPointTest( structure );

			}

		} );
		resetTimes();

	} );
	gui.add( params, 'margin', 0, 1 ).onChange( resetTimes );
	gui.add( params, 'display', structures.map( s => s.name ) );

	window.addEventListener( 'resize', resize, false );
	resize();

}

// moves every mesh into world space with an identity transform and centers the scene, so the
// trees built from the geometry and from the triangle soup see the same coordinates
function bakeTransforms( scene ) {

	scene.updateMatrixWorld( true );

	const group = new THREE.Group();
	const meshes = [];
	scene.traverse( c => {

		if ( c.isMesh ) {

			c.geometry.applyMatrix4( c.matrixWorld );
			meshes.push( c );

		}

	} );

	const center = new THREE.Box3();
	meshes.forEach( c => center.expandByObject( c ) );
	center.getCenter( center.min ).multiplyScalar( - 1 );

	meshes.forEach( c => {

		c.geometry.translate( center.min.x, center.min.y, center.min.z );
		c.position.set( 0, 0, 0 );
		c.quaternion.identity();
		c.scale.set( 1, 1, 1 );
		group.add( c );

	} );

	group.updateMatrixWorld( true );
	return group;

}

// extra vec4 attributes widen the vertex stride the traversal reads positions from, as a path
// tracer's interleaved normals, tangents, colors and uvs do
async function createStructure( name, object, attributeCount, clusterSize = 64 ) {

	const attributes = { position: 'vec4f' };
	for ( let i = 1; i < attributeCount; i ++ ) {

		attributes[ `extra${ i }` ] = 'vec4f';

	}

	const startTime = window.performance.now();
	const bvhData = new BVHComputeData( object, { attributes, clusterSize } );
	await bvhData.update();

	const structure = {
		name,
		bvhData,
		bytes: bvhData.storage.nodes.proxyNode.value.array.byteLength,
		buildTime: window.performance.now() - startTime,
		times: [],
	};

	createRaycastTest( structure, bvhData.fns.raycastFirstHit );
	createClosestPointTest( structure );

	return structure;

}

// the scene as one triangle soup, the input tinybvh builds from
function collectTriangles( meshes ) {

	const positions = [];
	const indices = [];
	meshes.forEach( c => {

		const { geometry } = c;
		const vertexOffset = positions.length / 3;
		const position = geometry.attributes.position;
		for ( let i = 0; i < position.count; i ++ ) {

			positions.push( position.getX( i ), position.getY( i ), position.getZ( i ) );

		}

		const index = geometry.index;
		for ( let i = 0; i < index.count; i ++ ) {

			indices.push( index.getX( i ) + vertexOffset );

		}

	} );

	return { positions: new Float32Array( positions ), indices: new Uint32Array( indices ) };

}

function createVertexBuffer( positions ) {

	const vertices = new Float32Array( positions.length / 3 * 4 );
	for ( let i = 0, l = positions.length / 3; i < l; i ++ ) {

		vertices[ i * 4 ] = positions[ i * 3 ];
		vertices[ i * 4 + 1 ] = positions[ i * 3 + 1 ];
		vertices[ i * 4 + 2 ] = positions[ i * 3 + 2 ];

	}

	return storage( new StorageBufferAttribute( vertices, 4 ), 'vec4' ).toReadOnly();

}

async function buildTinyBvh( positions, indices ) {

	const imports = {
		env: { emscripten_notify_memory_growth: () => {} },
		wasi_snapshot_preview1: { proc_exit: () => {}, fd_close: () => 0, fd_write: () => 0, fd_seek: () => 0 },
	};
	const bytes = await ( await fetch( TINYBVH_WASM_URL ) ).arrayBuffer();
	const { instance } = await WebAssembly.instantiate( bytes, imports );
	const wasm = instance.exports;
	wasm._initialize();

	const positionsPointer = wasm.malloc( positions.byteLength );
	const indicesPointer = wasm.malloc( indices.byteLength );
	new Uint8Array( wasm.memory.buffer, positionsPointer, positions.byteLength ).set( new Uint8Array( positions.buffer ) );
	new Uint8Array( wasm.memory.buffer, indicesPointer, indices.byteLength ).set( new Uint8Array( indices.buffer ) );

	const result = wasm.tinybvh_build( positionsPointer, positions.length / 3, 3, 0, 0, indicesPointer, indices.length, 0, 0, TINYBVH_GPU_LAYOUT, 0 );
	const byteLength = wasm.tinybvh_result_size( result );
	const dataPointer = wasm.tinybvh_result_data( result );
	const buffer = wasm.memory.buffer.slice( dataPointer, dataPointer + byteLength );
	const maxDepth = wasm.tinybvh_result_max_depth( result );

	wasm.tinybvh_result_destroy( result );
	wasm.free( positionsPointer );
	wasm.free( indicesPointer );

	if ( maxDepth > TINYBVH_STACK_DEPTH ) {

		throw new Error( 'tinybvh: tree deeper than the traversal stack' );

	}

	return { buffer, maxDepth };

}

// BVH_GPU layout: 64 byte nodes holding both children's bounds, the child node indices in
// lmin.w and lmax.w, and for leaves the triangle count in rmin.w and the first triangle record
// in rmax.w. Triangle records of vertex indices follow the nodes, addressed in vec4 units.

// writes the geometry's three-mesh-bvh tree in the BVH_GPU layout, node for node
function packMeshBVHAsBvhGpu( geometry ) {

	const root = geometry.boundsTree._roots[ 0 ];
	const f32 = new Float32Array( root );
	const u32 = new Uint32Array( root );
	const u16 = new Uint16Array( root );
	const index = geometry.index.array;

	const nodeCount = root.byteLength / ( NODE_U32 * 4 );
	const records = [];
	const out = new Float32Array( nodeCount * 16 );
	const outU32 = new Uint32Array( out.buffer );

	for ( let n = 0; n < nodeCount; n ++ ) {

		const o = n * 16;
		if ( u16[ n * NODE_U16 + 15 ] === LEAF_FLAG ) {

			const offset = u32[ n * NODE_U32 + 6 ];
			const count = u16[ n * NODE_U16 + 14 ];
			outU32[ o + 11 ] = count;
			outU32[ o + 15 ] = nodeCount * 4 + records.length / 4;
			for ( let t = offset; t < offset + count; t ++ ) {

				records.push( index[ t * 3 ], index[ t * 3 + 1 ], index[ t * 3 + 2 ], 0 );

			}

		} else {

			const left = n + 1;
			const right = n + u32[ n * NODE_U32 + 6 ];
			out.set( f32.subarray( left * NODE_U32, left * NODE_U32 + 3 ), o );
			out.set( f32.subarray( left * NODE_U32 + 3, left * NODE_U32 + 6 ), o + 4 );
			out.set( f32.subarray( right * NODE_U32, right * NODE_U32 + 3 ), o + 8 );
			out.set( f32.subarray( right * NODE_U32 + 3, right * NODE_U32 + 6 ), o + 12 );
			outU32[ o + 3 ] = left;
			outU32[ o + 7 ] = right;

		}

	}

	const buffer = new Uint32Array( out.length + records.length );
	buffer.set( outU32 );
	buffer.set( records, out.length );
	return buffer.buffer;

}

// writes a BVH_GPU tree as a three-mesh-bvh tree over the geometry, reordering its index so
// each leaf references a contiguous triangle range
function unpackBvhGpuAsMeshBVH( buffer, geometry ) {

	const f32 = new Float32Array( buffer );
	const u32 = new Uint32Array( buffer );

	// count the nodes to size the output - every node is reachable from the root
	let nodeCount = 0;
	const stack = [ 0 ];
	while ( stack.length ) {

		const n = stack.pop();
		nodeCount = Math.max( nodeCount, n + 1 );
		if ( u32[ n * 16 + 11 ] === 0 ) {

			stack.push( u32[ n * 16 + 3 ], u32[ n * 16 + 7 ] );

		}

	}

	const root = new ArrayBuffer( nodeCount * NODE_U32 * 4 );
	const outF32 = new Float32Array( root );
	const outU32 = new Uint32Array( root );
	const outU16 = new Uint16Array( root );
	const newIndex = new Uint32Array( geometry.index.count );
	let nextNode = 0;
	let nextTriangle = 0;

	// depth first so each left child directly follows its parent, as the packed layout requires
	function write( n, boundsMin, boundsMax ) {

		const index = nextNode ++;
		outF32.set( boundsMin, index * NODE_U32 );
		outF32.set( boundsMax, index * NODE_U32 + 3 );

		const count = u32[ n * 16 + 11 ];
		if ( count > 0 ) {

			const first = u32[ n * 16 + 15 ];
			outU32[ index * NODE_U32 + 6 ] = nextTriangle;
			outU16[ index * NODE_U16 + 14 ] = count;
			outU16[ index * NODE_U16 + 15 ] = LEAF_FLAG;
			for ( let t = 0; t < count; t ++ ) {

				newIndex.set( u32.subarray( ( first + t ) * 4, ( first + t ) * 4 + 3 ), nextTriangle * 3 );
				nextTriangle ++;

			}

			return;

		}

		let left = u32[ n * 16 + 3 ];
		let right = u32[ n * 16 + 7 ];
		let leftMin = f32.subarray( n * 16, n * 16 + 3 );
		let leftMax = f32.subarray( n * 16 + 4, n * 16 + 7 );
		let rightMin = f32.subarray( n * 16 + 8, n * 16 + 11 );
		let rightMax = f32.subarray( n * 16 + 12, n * 16 + 15 );

		// the split axis is the one the child centers differ most along, with the lower child on
		// the left, which is what the traversal's child ordering assumes
		let splitAxis = 0;
		let maxDelta = - 1;
		for ( let axis = 0; axis < 3; axis ++ ) {

			const delta = Math.abs( ( rightMin[ axis ] + rightMax[ axis ] ) - ( leftMin[ axis ] + leftMax[ axis ] ) );
			if ( delta > maxDelta ) {

				maxDelta = delta;
				splitAxis = axis;

			}

		}

		if ( rightMin[ splitAxis ] + rightMax[ splitAxis ] < leftMin[ splitAxis ] + leftMax[ splitAxis ] ) {

			[ left, right ] = [ right, left ];
			[ leftMin, rightMin ] = [ rightMin, leftMin ];
			[ leftMax, rightMax ] = [ rightMax, leftMax ];

		}

		outU32[ index * NODE_U32 + 7 ] = splitAxis;
		write( left, leftMin, leftMax );
		outU32[ index * NODE_U32 + 6 ] = nextNode - index;
		write( right, rightMin, rightMax );

	}

	const rootMin = [ 0, 1, 2 ].map( axis => Math.min( f32[ axis ], f32[ 8 + axis ] ) );
	const rootMax = [ 0, 1, 2 ].map( axis => Math.max( f32[ 4 + axis ], f32[ 12 + axis ] ) );
	write( 0, rootMin, rootMax );

	geometry.index.array.set( newIndex );
	geometry.index.needsUpdate = true;
	return MeshBVH.deserialize( { roots: [ root ], index: newIndex, version: 1 }, geometry, { setIndex: false } );

}

// port of the BVH_GPU kernel from tinybvh's traverse_bvh2.cl: slab test both children, descend
// the nearer one and push the other
function createTinyBvhTraversalStructure( name, buffer, vertices, buildTime ) {

	const nodes = storage( new StorageBufferAttribute( new Float32Array( buffer ), 4 ), 'vec4' ).toReadOnly();

	const raycast = wgslTagFn/* wgsl */`
		fn bvh_RaycastFirstHit( ray: ${ rayStruct }, result: ptr<function, ${ rayIntersectionResultStruct }> ) -> bool {

			var stack: array<u32, ${ TINYBVH_STACK_DEPTH }>;
			var pointer: i32 = 0;
			stack[ 0 ] = 0u;

			let invDir = 1.0 / ray.direction;
			var tFar = select( 1e30, ray.maxDist, ray.maxDist > 0.0 );
			if ( result.didHit ) {

				tFar = min( tFar, result.dist );

			}

			var didHit = false;
			loop {

				if ( pointer < 0 ) {

					break;

				}

				let nodeIndex = stack[ pointer ] * 4u;
				pointer = pointer - 1;

				let n0 = ${ nodes }[ nodeIndex ];
				let n1 = ${ nodes }[ nodeIndex + 1u ];
				let n2 = ${ nodes }[ nodeIndex + 2u ];
				let n3 = ${ nodes }[ nodeIndex + 3u ];

				let triCount = bitcast<u32>( n2.w );
				if ( triCount > 0u ) {

					let first = bitcast<u32>( n3.w );
					for ( var i = 0u; i < triCount; i = i + 1u ) {

						let record = bitcast<vec4u>( ${ nodes }[ first + i ] );
						let a = ${ vertices }[ record.x ].xyz;
						let b = ${ vertices }[ record.y ].xyz;
						let c = ${ vertices }[ record.z ].xyz;

						let triResult = ${ intersectRayTriangle }( ray, a, b, c, 0.0 );
						if ( triResult.didHit && triResult.dist < tFar ) {

							tFar = triResult.dist;
							result.didHit = true;
							result.dist = triResult.dist;
							result.normal = triResult.normal;
							result.side = triResult.side;
							result.barycoord = triResult.barycoord;
							result.indices = vec4u( record.xyz, first + i );
							didHit = true;

						}

					}

					continue;

				}

				let t1a = ( n0.xyz - ray.origin ) * invDir;
				let t2a = ( n1.xyz - ray.origin ) * invDir;
				let t1b = ( n2.xyz - ray.origin ) * invDir;
				let t2b = ( n3.xyz - ray.origin ) * invDir;
				let minA = min( t1a, t2a );
				let maxA = max( t1a, t2a );
				let minB = min( t1b, t2b );
				let maxB = max( t1b, t2b );
				let tminA = max( max( minA.x, minA.y ), max( minA.z, 0.0 ) );
				let tmaxA = min( min( maxA.x, maxA.y ), min( maxA.z, tFar ) );
				let tminB = max( max( minB.x, minB.y ), max( minB.z, 0.0 ) );
				let tmaxB = min( min( maxB.x, maxB.y ), min( maxB.z, tFar ) );
				let hitA = tminA <= tmaxA;
				let hitB = tminB <= tmaxB;

				let left = bitcast<u32>( n0.w );
				let right = bitcast<u32>( n1.w );
				if ( hitA && hitB ) {

					let nearFirst = tminA <= tminB;
					pointer = pointer + 1;
					stack[ pointer ] = select( left, right, nearFirst );
					pointer = pointer + 1;
					stack[ pointer ] = select( right, left, nearFirst );

				} else if ( hitA ) {

					pointer = pointer + 1;
					stack[ pointer ] = left;

				} else if ( hitB ) {

					pointer = pointer + 1;
					stack[ pointer ] = right;

				}

			}

			return didHit;

		}
	`;

	const structure = {
		name,
		bytes: buffer.byteLength,
		buildTime,
		times: [],
	};

	createRaycastTest( structure, raycast );
	return structure;

}

// per pixel random value in [ 0, 1 )
const hash = wgslFn( /* wgsl */`

	fn hash( value: u32 ) -> f32 {

		var x = value * 747796405u + 2891336453u;
		x = ( ( x >> ( ( x >> 28u ) + 4u ) ) ^ x ) * 277803737u;
		x = ( x >> 22u ) ^ x;
		return f32( x ) / 4294967295.0;

	}

` );

// one ray per pixel, writing the hit normal to the output texture
function createRaycastTest( structure, raycastFn ) {

	const outputTex = new StorageTexture( 1, 1 );

	const raycast = wgslFn( /* wgsl */`

		fn raycast(
			outputTex: texture_storage_2d<rgba8unorm, write>,
			inverseProjectionMatrix: mat4x4f,
			cameraToWorldMatrix: mat4x4f,
			boundsMin: vec3f,
			boundsMax: vec3f,
			randomRays: u32,
			globalId: vec3u,
		) -> void {

			let dimensions = textureDimensions( outputTex );
			if ( globalId.x >= dimensions.x || globalId.y >= dimensions.y ) {

				return;

			}

			var ray: Ray;
			if ( randomRays != 0u ) {

				// incoherent rays: a fixed random origin inside the bounds and direction per pixel
				let seed = ( globalId.x + globalId.y * dimensions.x ) * 6u;
				let origin = vec3f( hash( seed ), hash( seed + 1u ), hash( seed + 2u ) );
				ray.origin = mix( boundsMin, boundsMax, origin );
				ray.direction = normalize( vec3f( hash( seed + 3u ), hash( seed + 4u ), hash( seed + 5u ) ) * 2.0 - 1.0 );

			} else {

				let uv = vec2f( globalId.xy ) / vec2f( dimensions );
				let ndc = uv * 2.0 - 1.0;
				ray = ndcToCameraRay( ndc, cameraToWorldMatrix * inverseProjectionMatrix );

			}

			var hit: IntersectionResult;
			bvh_RaycastFirstHit( ray, &hit );

			var color = vec4f( 0.0366, 0.0813, 0.1057, 1.0 );
			if ( hit.didHit ) {

				color = vec4f( hit.normal * 0.5 + 0.5, 1.0 );

			}

			textureStore( outputTex, globalId.xy, color );

		}

	`, [ hash, ndcToCameraRay, raycastFn ] );

	structure.outputTex = outputTex;
	structure.raycastKernel = raycast( {
		outputTex: storageTexture( outputTex ),
		inverseProjectionMatrix: uniform( new THREE.Matrix4() ),
		cameraToWorldMatrix: uniform( new THREE.Matrix4() ),
		boundsMin: uniform( bounds.min ),
		boundsMax: uniform( bounds.max ),
		randomRays: uniform( 0 ),
		globalId,
	} ).computeKernel( RAYCAST_WORKGROUP_SIZE );

	const material = new MeshBasicNodeMaterial();
	material.colorNode = colorSpaceToWorking( texture( outputTex ), THREE.SRGBColorSpace );
	structure.raycastQuad = new FullScreenQuad( material );

}

// one closest point query per voxel of a grid over the bounds, writing the distance to a 3d texture
function createClosestPointTest( structure ) {

	const { bvhData } = structure;
	const dim = params.resolution;

	if ( structure.sdfTex ) {

		structure.sdfTex.dispose();

	}

	const sdfTex = new Storage3DTexture( dim, dim, dim );
	sdfTex.format = THREE.RedFormat;
	sdfTex.type = THREE.FloatType;
	sdfTex.generateMipmaps = false;
	sdfTex.needsUpdate = true;

	const closestPoint = wgslFn( /* wgsl */`

		fn closestPoint(
			output: texture_storage_3d<r32float, write>,
			matrix: mat4x4f,
			globalId: vec3u,
		) -> void {

			let dim = textureDimensions( output );
			if ( any( globalId >= dim ) ) {

				return;

			}

			// voxel center in the unit cube, mapped onto the bounds by the matrix
			let local = ( vec3f( globalId ) + 0.5 ) / vec3f( dim ) - 0.5;
			let point = ( matrix * vec4f( local, 1.0 ) ).xyz;

			var result: PointQueryResult;
			bvh_ClosestPointToPoint( point, &result );

			textureStore( output, globalId, vec4f( sqrt( result.distanceSq ), 0.0, 0.0, 0.0 ) );

		}

	`, [ bvhData.fns.closestPointToPoint ] );

	structure.sdfTex = sdfTex;
	structure.closestPointKernel = closestPoint( {
		output: storageTexture( sdfTex ),
		matrix: uniform( new THREE.Matrix4() ),
		globalId,
	} ).computeKernel( CLOSEST_POINT_WORKGROUP_SIZE );

	structure.layerQuad = new FullScreenQuad( new RenderSDFLayerNodeMaterial( sdfTex ) );

}

function runRaycast( structure ) {

	const { outputTex, raycastKernel } = structure;
	const { parameters } = raycastKernel.computeNode;
	parameters.inverseProjectionMatrix.value.copy( camera.projectionMatrixInverse );
	parameters.cameraToWorldMatrix.value.copy( camera.matrixWorld );
	parameters.randomRays.value = params.rays === 'random' ? 1 : 0;

	const dispatchSize = [
		Math.ceil( outputTex.width / RAYCAST_WORKGROUP_SIZE[ 0 ] ),
		Math.ceil( outputTex.height / RAYCAST_WORKGROUP_SIZE[ 1 ] ),
	];
	renderer.compute( raycastKernel, dispatchSize );

}

function runClosestPoint( structure ) {

	const { closestPointKernel } = structure;
	const { parameters } = closestPointKernel.computeNode;

	// scale the unit cube to the bounds plus the margin
	const size = bounds.getSize( new THREE.Vector3() ).addScalar( 2 * params.margin );
	const center = bounds.getCenter( new THREE.Vector3() );
	parameters.matrix.value.compose( center, new THREE.Quaternion(), size );

	const dim = params.resolution;
	const dispatchSize = [
		Math.ceil( dim / CLOSEST_POINT_WORKGROUP_SIZE[ 0 ] ),
		Math.ceil( dim / CLOSEST_POINT_WORKGROUP_SIZE[ 1 ] ),
		Math.ceil( dim / CLOSEST_POINT_WORKGROUP_SIZE[ 2 ] ),
	];
	renderer.compute( closestPointKernel, dispatchSize );

}

// the structures that support the selected test
function getActiveStructures() {

	return structures.filter( structure => params.test === 'raycast' || structure.closestPointKernel );

}

function resetTimes() {

	structures.forEach( structure => structure.times.length = 0 );

}

function resize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	const dpr = window.devicePixelRatio;

	camera.aspect = w / h;
	camera.updateProjectionMatrix();

	renderer.setSize( w, h );
	renderer.setPixelRatio( dpr );

	structures.forEach( structure => structure.outputTex.setSize( Math.ceil( w * dpr ), Math.ceil( h * dpr ) ) );
	resetTimes();

}

function average( times ) {

	return times.reduce( ( sum, time ) => sum + time, 0 ) / times.length;

}

function updateOutput() {

	const active = getActiveStructures();
	const { outputTex } = structures[ 0 ];
	const dim = params.resolution;
	const queries = params.test === 'raycast'
		? `${ outputTex.width }x${ outputTex.height } ${ params.rays } rays`
		: `${ dim }x${ dim }x${ dim } closest point queries`;

	let text = `${ triangleCount } triangles, ${ queries }\n\n`;
	active.forEach( structure => {

		const time = structure.times.length === 0 ? '...' : `${ average( structure.times ).toFixed( 3 ) } ms`;
		text += `${ structure.name.padEnd( 32 ) } ${ time.padStart( 10 ) }`;
		text += `   build ${ structure.buildTime.toFixed( 0 ) } ms, nodes ${ ( structure.bytes / 1024 ).toFixed( 0 ) } KB\n`;

	} );

	const reference = active[ 0 ];
	if ( reference.times.length === SAMPLE_COUNT ) {

		text += '\n';
		active.slice( 1 ).forEach( structure => {

			if ( structure.times.length === SAMPLE_COUNT ) {

				text += `${ structure.name } is ${ ( average( reference.times ) / average( structure.times ) ).toFixed( 2 ) }x faster than ${ reference.name }\n`;

			}

		} );

	}

	if ( ! renderer.backend.trackTimestamp ) {

		text += '\ntimestamp queries are not supported on this device';

	}

	outputContainer.innerText = text;

}

async function render() {

	controls.update();
	camera.updateMatrixWorld();

	// time one structure per frame so the compute timestamps hold a single dispatch. The test is
	// read once since the gui can change it while the timestamps resolve.
	const test = params.test;
	const active = getActiveStructures();
	const structure = active[ frame % active.length ];
	frame ++;

	if ( test === 'raycast' ) {

		runRaycast( structure );

	} else {

		runClosestPoint( structure );

	}

	const time = await renderer.resolveTimestampsAsync( 'compute' );
	structure.times.push( time );
	if ( structure.times.length > SAMPLE_COUNT ) {

		structure.times.shift();

	}

	// show the latest result of the selected structure
	const displayed = active.find( s => s.name === params.display ) || active[ 0 ];
	if ( test === 'raycast' ) {

		displayed.raycastQuad.render( renderer );

	} else {

		displayed.layerQuad.material.fragmentNode.parameters.layer.value = Math.floor( params.resolution / 2 );
		displayed.layerQuad.render( renderer );

	}

	await renderer.resolveTimestampsAsync( 'render' );

	updateOutput();
	requestAnimationFrame( render );

}
