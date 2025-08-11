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

const MAX_RESOLUTION = 200;
const MIN_RESOLUTION = 10;
const params = {

	generationMode: 'WebGL',
	resolution: 75,
	margin: 0.2,
	regenerate: () => updateSDF(),

	mode: 'raymarching',
	layer: 0,
	surface: 0.1,

};

let device, renderer, camera, scene, gui, stats, boxHelper;
let outputContainer, bvh, geometry, sdfTex, mesh;
let generateSdfPass, layerPass, raymarchPass;
let bvhGenerationWorker;
let shaderModule, pipeline, dstBuffer, resultBuffer, uniformBuffer, bindGroup;
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

	const adapter = await navigator.gpu?.requestAdapter();
	device = await adapter?.requestDevice();
	if ( device !== undefined ) {

		shaderModule = device.createShaderModule( {
			label: "Sdf generation module",
			code: /* wgsl */ `

			struct BVHBoundingBox {
				min: array<f32, 3>,
				max: array<f32, 3>,
			}

			struct BVHNode {
				bounds: BVHBoundingBox,
				rightChildOrTriangleOffset: u32,
				splitAxisOrTriangleCount: u32,
			};

			struct Params {
				matrix: mat4x4f,
				dim: f32,
			};

			@group(0) @binding(0) var<storage, read_write> data: array<f32>;
			@group(0) @binding(1) var<uniform> params: Params;
			@group(0) @binding(2) var<storage, read> bvh: array<BVHNode>;
			@group(0) @binding(3) var<storage, read> bvh_index: array<vec3u>;
			@group(0) @binding(4) var<storage, read> bvh_position: array<vec3f>;

			@compute @workgroup_size(16, 16) fn computeSdf( @builtin(global_invocation_id) id: vec3u) {
				let dim = u32(params.dim);
				if (id.x >= dim) {
					return;
				}
				if (id.y >= dim) {
					return;
				}
				if (id.z >= dim) {
					return;
				}

				let pxWidth = 1.0 / params.dim;
				let halfWidth = 0.5 * pxWidth;
				let pointHomo = vec4f(
					halfWidth + f32(id.x) * pxWidth - 0.5,
					halfWidth + f32(id.y) * pxWidth - 0.5,
					halfWidth + f32(id.z) * pxWidth - 0.5,
					1.0
				) * params.matrix;
				let point = pointHomo.xyz / pointHomo.w;

				let res = _bvhClosestPointToPoint(&bvh_index, &bvh_position, &bvh, point, 10000.0);

				let index = id.x + id.y * dim + id.z * dim * dim;
				data[index] = res.side * sqrt( res.distanceSq );
			}

			struct ClosestPointToTriangleResult {
				barycoord: vec3f,
				point: vec3f,
			};

			// https://www.shadertoy.com/view/ttfGWl
			fn closestPointToTriangle( p: vec3f, v0: vec3f, v1: vec3f, v2: vec3f ) -> ClosestPointToTriangleResult {

				let v10 = v1 - v0;
				let v21 = v2 - v1;
				let v02 = v0 - v2;

				let p0 = p - v0;
				let p1 = p - v1;
				let p2 = p - v2;

				let nor = cross( v10, v02 );

				// method 2, in barycentric space
				let  q = cross( nor, p0 );
				let d = 1.0 / dot( nor, nor );
				var u = d * dot( q, v02 );
				var v = d * dot( q, v10 );
				var w = 1.0 - u - v;

				if( u < 0.0 ) {

					w = clamp( dot( p2, v02 ) / dot( v02, v02 ), 0.0, 1.0 );
					u = 0.0;
					v = 1.0 - w;

				} else if( v < 0.0 ) {

					u = clamp( dot( p0, v10 ) / dot( v10, v10 ), 0.0, 1.0 );
					v = 0.0;
					w = 1.0 - u;

				} else if( w < 0.0 ) {

					v = clamp( dot( p1, v21 ) / dot( v21, v21 ), 0.0, 1.0 );
					w = 0.0;
					u = 1.0 - v;

				}

				var result: ClosestPointToTriangleResult;
				result.barycoord = vec3f( u, v, w );
				result.point = u * v1 + v * v2 + w * v0;

				return result;

			}

			struct ClosestPointToPointResult {
				faceIndices: vec4u,
				faceNormal: vec3f,
				barycoord: vec3f,
				point: vec3f,
				side: f32,
				distanceSq: f32,
				found: bool,
			};

			fn distanceToTriangles(
				// geometry info and triangle range
				bvh_index: ptr<storage, array<vec3u>, read>,
				bvh_position: ptr<storage, array<vec3f>, read>,

				offset: u32, count: u32,

				// point and current result. Cut off range is taken from the struct
				point: vec3f,
				ioRes: ptr<function, ClosestPointToPointResult>,
			) {

				for ( var i = offset; i < offset + count; i = i + 1u ) {

					let indices = bvh_index[ i ];
					let a = bvh_position[ indices.x ];
					let b = bvh_position[ indices.y ];
					let c = bvh_position[ indices.z ];

					// get the closest point and barycoord
					let pointRes = closestPointToTriangle( point, a, b, c );
					let delta = point - pointRes.point;
					let distSq = dot( delta, delta );
					if ( distSq < ioRes.distanceSq ) {

						// set the output results
						ioRes.distanceSq = distSq;
						ioRes.faceIndices = vec4u( indices.xyz, i );
						ioRes.faceNormal = normalize( cross( a - b, b - c ) );
						ioRes.barycoord = pointRes.barycoord;
						ioRes.point = pointRes.point;
						ioRes.side = sign( dot( ioRes.faceNormal, delta ) );

					}

				}

			}

			fn distanceSqToBounds( point: vec3f, boundsMin: vec3f, boundsMax: vec3f ) -> f32 {

				let clampedPoint = clamp( point, boundsMin, boundsMax );
				let delta = point - clampedPoint;
				return dot( delta, delta );

			}

			fn distanceSqToBVHNodeBoundsPoint( 
				point: vec3f,
				bvh: ptr<storage, array<BVHNode>, read>,
				currNodeIndex: u32,
			) -> f32 {

				let node = bvh[ currNodeIndex ];
				let minBounds = vec3f(node.bounds.min[0], node.bounds.min[1], node.bounds.min[2]);
				let maxBounds = vec3f(node.bounds.max[0], node.bounds.max[1], node.bounds.max[2]);
				return distanceSqToBounds( point, minBounds, maxBounds );

			}

			fn _bvhClosestPointToPoint(
				bvh_index: ptr<storage, array<vec3u>, read>,
				bvh_position: ptr<storage, array<vec3f>, read>,
				bvh: ptr<storage, array<BVHNode>, read>,

				point: vec3f,
				maxDistance: f32
			) -> ClosestPointToPointResult {

				const BVH_STACK_DEPTH = 64;

				// stack needs to be twice as long as the deepest tree we expect because
				// we push both the left and right child onto the stack every traversal
				var ptr = 0;
				var stack: array<u32, BVH_STACK_DEPTH>;
				stack[ 0 ] = 0u;

				var res: ClosestPointToPointResult;
				res.distanceSq = maxDistance * maxDistance;

				while ptr > - 1 && ptr < BVH_STACK_DEPTH {

					let currNodeIndex = stack[ ptr ];
					let node = bvh[ currNodeIndex ];
					ptr = ptr - 1;

					// check if we intersect the current bounds
					let boundsDistance = distanceSqToBVHNodeBoundsPoint( point, bvh, currNodeIndex );
					if ( boundsDistance > res.distanceSq ) {

						continue;

					}

					let boundsInfox = node.splitAxisOrTriangleCount;
					let boundsInfoy = node.rightChildOrTriangleOffset;

					let isLeaf = ( boundsInfox & 0xffff0000u ) != 0u;

					if ( isLeaf ) {

						let count = boundsInfox & 0x0000ffffu;
						let offset = boundsInfoy;
						distanceToTriangles(
							bvh_index, bvh_position,
							offset, count,
							point, &res
						);

					} else {

						let leftIndex = currNodeIndex + 1u;
						let splitAxis = boundsInfox & 0x0000ffffu;
						let rightIndex = 4u * boundsInfoy / 32u;

						let leftToRight = distanceSqToBVHNodeBoundsPoint( point, bvh, leftIndex ) < distanceSqToBVHNodeBoundsPoint( point, bvh, rightIndex );//rayDirection[ splitAxis ] >= 0.0;
						let c1 = select( rightIndex, leftIndex, leftToRight );
						let c2 = select( leftIndex, rightIndex, leftToRight );

						ptr = ptr + 1;
						stack[ ptr ] = c2;

						ptr = ptr + 1;
						stack[ ptr ] = c1;

					}

				}

				return res;

			}
		`,
		} );

		const bindGroupLayout = device.createBindGroupLayout( {
			label: "Sdf generation bind group layout",

			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "storage" },
				},
				{
					binding: 1,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "uniform" },
				},
				{
					binding: 2,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "read-only-storage" },
				},
				{
					binding: 3,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "read-only-storage" },
				},
				{
					binding: 4,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "read-only-storage" },
				},
			]
		} );

		const pipelineLayout = device.createPipelineLayout( {
			label: "Sdf generation pipeline layout",
			bindGroupLayouts: [ bindGroupLayout ],
		} );

		pipeline = device.createComputePipeline( {
			label: "Sdf generation pipeline",
			layout: pipelineLayout,
			compute: {
				module: shaderModule,
			}
		} );

		dstBuffer = device.createBuffer( {
			label: "Sdf generation result usable",
			size: MAX_RESOLUTION ** 3 * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
		} );

		resultBuffer = device.createBuffer( {
			label: "Sdf generation result readable",
			size: MAX_RESOLUTION ** 3 * 4,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		} );

		uniformBuffer = device.createBuffer( {
			label: "Sdf generation uniform buffer",
			size: 16 * 4 + 4 + /* alignment */ 12,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		} );

		const bvhBufferData = bvh._roots[ 0 ];
		const bvhBuffer = device.createBuffer( {
			label: "Bvh buffer",
			size: bvhBufferData.byteLength,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		} );
		device.queue.writeBuffer( bvhBuffer, 0, bvhBufferData );

		const indexBufferData = new Uint32Array( mesh.geometry.index.count * 4 );
		for ( let i = 0; i < mesh.geometry.index.count / 3; i = i + 1 ) {

			indexBufferData[ 4 * i + 0 ] = mesh.geometry.index.getX( 3 * i + 0 );
			indexBufferData[ 4 * i + 1 ] = mesh.geometry.index.getX( 3 * i + 1 );
			indexBufferData[ 4 * i + 2 ] = mesh.geometry.index.getX( 3 * i + 2 );
			indexBufferData[ 4 * i + 3 ] = 0;

		}

		const indexBuffer = device.createBuffer( {
			label: "index buffer",
			size: indexBufferData.byteLength,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		} );
		device.queue.writeBuffer( indexBuffer, 0, indexBufferData );

		const positionBufferData = new Float32Array( mesh.geometry.attributes.position.count * 4 );
		for ( let i = 0; i < mesh.geometry.attributes.position.count; i = i + 1 ) {

			positionBufferData[ 4 * i + 0 ] = mesh.geometry.attributes.position.getX( i );
			positionBufferData[ 4 * i + 1 ] = mesh.geometry.attributes.position.getY( i );
			positionBufferData[ 4 * i + 2 ] = mesh.geometry.attributes.position.getZ( i );
			positionBufferData[ 4 * i + 3 ] = 0;

		}

		const positionBuffer = device.createBuffer( {
			label: "index buffer",
			size: positionBufferData.byteLength,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		} );
		device.queue.writeBuffer( positionBuffer, 0, positionBufferData );

		bindGroup = device.createBindGroup( {
			label: "Sdf generation bind group",
			layout: pipeline.getBindGroupLayout( 0 ),
			entries: [
				{ binding: 0, resource: { buffer: dstBuffer } },
				{ binding: 1, resource: { buffer: uniformBuffer } },
				{ binding: 2, resource: { buffer: bvhBuffer } },
				{ binding: 3, resource: { buffer: indexBuffer } },
				{ binding: 4, resource: { buffer: positionBuffer } },
			],
		} );

	}

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
	if ( device !== undefined ) {

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

			const uniforms = new Float32Array( uniformBuffer.size / 4 );
			uniforms.set( matrix.elements, 0 );
			uniforms.set( [ dim ], matrix.elements.length );
			device.queue.writeBuffer( uniformBuffer, 0, uniforms );

			const encoder = device.createCommandEncoder( { label: "sdf generation encoder" } );
			const pass = encoder.beginComputePass( { label: "sdf generation pass" } );
			pass.setPipeline( pipeline );
			pass.setBindGroup( 0, bindGroup );
			pass.dispatchWorkgroups( Math.ceil( dim / 16 ), Math.ceil( dim / 16 ), dim );
			pass.end();

			encoder.copyBufferToBuffer( dstBuffer, resultBuffer, resultBuffer.length );

			const commandBuffer = encoder.finish();
			device.queue.submit( [ commandBuffer ] );

			resultBuffer.mapAsync( GPUMapMode.READ ).then( () => {

				const result = new Float32Array( resultBuffer.getMappedRange().slice() );

				// create a new 3d data texture
				sdfTex = new THREE.Data3DTexture( result, dim, dim, dim );
				sdfTex.format = THREE.RedFormat;
				sdfTex.type = THREE.FloatType;
				sdfTex.minFilter = THREE.LinearFilter;
				sdfTex.magFilter = THREE.LinearFilter;
				sdfTex.needsUpdate = true;

				resultBuffer.unmap();

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
