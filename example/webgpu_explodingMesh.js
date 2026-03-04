import * as THREE from 'three';
import { WebGPURenderer, StorageBufferAttribute, StorageTexture, MeshBasicNodeMaterial } from 'three/webgpu';
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
import { ndcToCameraRay, bvh2IntersectFirstHit, getVertexAttribute } from 'three-mesh-bvh/webgpu';

// ─── Parameters ───

const BVH_UPDATE_MODES = {
	REBUILD: 'Full BVH rebuild',
	REFIT: 'BVH refit',
};

const params = {
	pause: false,
	bvhUpdateMode: BVH_UPDATE_MODES.REBUILD,
	resolutionScale: 0.5,
	smoothNormals: true,
	floorY: - 1.5,
	samples: 1,
	explosionForce: 8,
	gravity: 9.8,
	bounce: 0.4,
	chunkCount: 30,
};

// ─── Globals ───

let renderer, camera, scene, gui, stats, clock, controls;
let outputContainer;

// GPU BVH
let gpuBVH = null;
let device = null;

// Path tracing
let fsQuad, fsMaterial, computeKernel, outputTex;
let dispatchSize = [];
const WORKGROUP_SIZE = [ 8, 8, 1 ];

// Geometry
let totalVertexCount = 0;
let triCount = 0;
let indexArray = null;
let transformedPositions = null;
let transformedNormals = null;

// GPU transform buffers
let gpuTransformKernel = null;
let transformBuffers = null;

// TSL storage buffers
let geom_index, geom_position, geom_normals, geom_chunkIds, bvh2Nodes, rootIndexBuffer;
let computeShaderParams = null;

// Timing
let avgBvhUpdateTime = 0;
let avgTransformTime = 0;
let frameCount = 0;
let buildInProgress = false;
let bvhBufferCapacity = 0;
let bvhUpdateGeometry = null;

// Voronoi chunks
let chunkIds = null; // Uint32Array[totalVertexCount]
let chunkCenters = []; // THREE.Vector3[]
let chunkCount = 0;

// Physics state
let chunkOffsets = []; // THREE.Vector3[]
let chunkVelocities = []; // THREE.Vector3[]
let chunkRotations = []; // THREE.Quaternion[]
let chunkAngularVelocities = []; // THREE.Vector3[]
let exploded = false;
let chunkMatricesArray = null; // Float32Array for GPU upload

init();

// ─── Create & Expand Geometry ───

function createTorusKnotGeometry() {

	const srcGeom = new THREE.TorusKnotGeometry( 1, 0.3, 400, 64 );

	// Shift up so bottom sits on floor at y=0 (before expansion so both match)
	srcGeom.computeBoundingBox();
	const bottomY = srcGeom.boundingBox.min.y;
	srcGeom.translate( 0, - bottomY, 0 );

	const posAttr = srcGeom.attributes.position;
	const normalAttr = srcGeom.attributes.normal;
	const indexAttr = srcGeom.index;

	const expandedCount = indexAttr.count;
	const positions = new Float32Array( expandedCount * 3 );
	const normals = new Float32Array( expandedCount * 3 );

	for ( let i = 0; i < expandedCount; i ++ ) {

		const idx = indexAttr.array[ i ];
		positions[ i * 3 + 0 ] = posAttr.getX( idx );
		positions[ i * 3 + 1 ] = posAttr.getY( idx );
		positions[ i * 3 + 2 ] = posAttr.getZ( idx );
		normals[ i * 3 + 0 ] = normalAttr.getX( idx );
		normals[ i * 3 + 1 ] = normalAttr.getY( idx );
		normals[ i * 3 + 2 ] = normalAttr.getZ( idx );

	}

	const geom = new THREE.BufferGeometry();
	geom.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
	geom.setAttribute( 'normal', new THREE.BufferAttribute( normals, 3 ) );

	const indices = new Uint32Array( expandedCount );
	for ( let i = 0; i < expandedCount; i ++ ) {

		indices[ i ] = i;

	}

	geom.setIndex( new THREE.BufferAttribute( indices, 1 ) );

	return { expanded: geom, original: srcGeom };

}

// ─── Voronoi Pre-Fracture ───

function voronoiFracture( geometry, N ) {

	const posAttr = geometry.attributes.position;
	const vertexCount = posAttr.count;
	const triCountLocal = vertexCount / 3;

	// Pick N random triangle centroids as seed points
	const seeds = [];
	const usedTriangles = new Set();
	for ( let i = 0; i < N; i ++ ) {

		let triIdx;
		do {

			triIdx = Math.floor( Math.random() * triCountLocal );

		} while ( usedTriangles.has( triIdx ) && usedTriangles.size < triCountLocal );

		usedTriangles.add( triIdx );

		const v0 = triIdx * 3;
		const cx = ( posAttr.getX( v0 ) + posAttr.getX( v0 + 1 ) + posAttr.getX( v0 + 2 ) ) / 3;
		const cy = ( posAttr.getY( v0 ) + posAttr.getY( v0 + 1 ) + posAttr.getY( v0 + 2 ) ) / 3;
		const cz = ( posAttr.getZ( v0 ) + posAttr.getZ( v0 + 1 ) + posAttr.getZ( v0 + 2 ) ) / 3;
		seeds.push( new THREE.Vector3( cx, cy, cz ) );

	}

	// Assign each triangle to nearest seed
	const ids = new Uint32Array( vertexCount );
	const centersAccum = [];
	const centersCounts = [];
	for ( let i = 0; i < N; i ++ ) {

		centersAccum.push( new THREE.Vector3() );
		centersCounts.push( 0 );

	}

	for ( let t = 0; t < triCountLocal; t ++ ) {

		const v0 = t * 3;
		const cx = ( posAttr.getX( v0 ) + posAttr.getX( v0 + 1 ) + posAttr.getX( v0 + 2 ) ) / 3;
		const cy = ( posAttr.getY( v0 ) + posAttr.getY( v0 + 1 ) + posAttr.getY( v0 + 2 ) ) / 3;
		const cz = ( posAttr.getZ( v0 ) + posAttr.getZ( v0 + 1 ) + posAttr.getZ( v0 + 2 ) ) / 3;

		let bestDist = Infinity;
		let bestId = 0;
		for ( let s = 0; s < N; s ++ ) {

			const dx = cx - seeds[ s ].x;
			const dy = cy - seeds[ s ].y;
			const dz = cz - seeds[ s ].z;
			const d = dx * dx + dy * dy + dz * dz;
			if ( d < bestDist ) {

				bestDist = d;
				bestId = s;

			}

		}

		// All 3 vertices of this triangle get the same chunkId
		ids[ v0 ] = bestId;
		ids[ v0 + 1 ] = bestId;
		ids[ v0 + 2 ] = bestId;

		centersAccum[ bestId ].x += cx;
		centersAccum[ bestId ].y += cy;
		centersAccum[ bestId ].z += cz;
		centersCounts[ bestId ] ++;

	}

	// Compute per-chunk center of mass
	const centers = [];
	for ( let i = 0; i < N; i ++ ) {

		if ( centersCounts[ i ] > 0 ) {

			centers.push( centersAccum[ i ].divideScalar( centersCounts[ i ] ) );

		} else {

			centers.push( seeds[ i ].clone() );

		}

	}

	return { chunkIds: ids, chunkCenters: centers };

}

// ─── Solidify Chunks ───

function solidifyChunks( expandedGeom, originalGeom, chunkIdsArr, chunkCentersArr, thickness ) {

	const origPos = originalGeom.attributes.position;
	const origNorm = originalGeom.attributes.normal;
	const origIndex = originalGeom.index.array;
	const origTriCount = origIndex.length / 3;

	const expPos = expandedGeom.attributes.position;
	const expNorm = expandedGeom.attributes.normal;
	const expVertCount = expPos.count;
	const expTriCount = expVertCount / 3;

	// Build edge adjacency from original indexed geometry
	const edgeMap = new Map();
	for ( let t = 0; t < origTriCount; t ++ ) {

		const i0 = origIndex[ t * 3 ];
		const i1 = origIndex[ t * 3 + 1 ];
		const i2 = origIndex[ t * 3 + 2 ];
		const edges = [[ i0, i1 ], [ i1, i2 ], [ i2, i0 ]];
		for ( const [ a, b ] of edges ) {

			const key = Math.min( a, b ) + ',' + Math.max( a, b );
			if ( ! edgeMap.has( key ) ) edgeMap.set( key, [] );
			edgeMap.get( key ).push( t );

		}

	}

	// Find boundary edges (where adjacent triangles belong to different chunks)
	const boundaryEdges = [];
	for ( const [ key, tris ] of edgeMap ) {

		if ( tris.length !== 2 ) continue;
		const c0 = chunkIdsArr[ tris[ 0 ] * 3 ];
		const c1 = chunkIdsArr[ tris[ 1 ] * 3 ];
		if ( c0 === c1 ) continue;

		const parts = key.split( ',' );
		boundaryEdges.push( {
			v0: Number( parts[ 0 ] ),
			v1: Number( parts[ 1 ] ),
			chunk0: c0,
			chunk1: c1
		} );

	}

	// Count geometry: outer + inner faces + 4 wall tris per boundary edge
	const wallTriTotal = boundaryEdges.length * 4;
	const totalNewVerts = ( expTriCount * 2 + wallTriTotal ) * 3;

	const newPositions = new Float32Array( totalNewVerts * 3 );
	const newNormals = new Float32Array( totalNewVerts * 3 );
	const newChunkIds = new Uint32Array( totalNewVerts );

	let vOff = 0;

	function addVertex( px, py, pz, nx, ny, nz, cid ) {

		newPositions[ vOff * 3 ] = px;
		newPositions[ vOff * 3 + 1 ] = py;
		newPositions[ vOff * 3 + 2 ] = pz;
		newNormals[ vOff * 3 ] = nx;
		newNormals[ vOff * 3 + 1 ] = ny;
		newNormals[ vOff * 3 + 2 ] = nz;
		newChunkIds[ vOff ] = cid;
		vOff ++;

	}

	// 1. Outer face (copy expanded geometry as-is)
	for ( let i = 0; i < expVertCount; i ++ ) {

		addVertex(
			expPos.getX( i ), expPos.getY( i ), expPos.getZ( i ),
			expNorm.getX( i ), expNorm.getY( i ), expNorm.getZ( i ),
			chunkIdsArr[ i ]
		);

	}

	// 2. Inner face (reversed winding, offset inward along normal)
	for ( let t = 0; t < expTriCount; t ++ ) {

		const v0 = t * 3;
		const v1 = t * 3 + 1;
		const v2 = t * 3 + 2;
		const cid = chunkIdsArr[ v0 ];

		// Reversed order: v0, v2, v1
		for ( const vi of [ v0, v2, v1 ] ) {

			addVertex(
				expPos.getX( vi ) - expNorm.getX( vi ) * thickness,
				expPos.getY( vi ) - expNorm.getY( vi ) * thickness,
				expPos.getZ( vi ) - expNorm.getZ( vi ) * thickness,
				- expNorm.getX( vi ),
				- expNorm.getY( vi ),
				- expNorm.getZ( vi ),
				cid
			);

		}

	}

	// 3. Wall quads at boundary edges
	for ( const edge of boundaryEdges ) {

		const { v0, v1, chunk0, chunk1 } = edge;

		// Outer and inner positions for the two edge vertices
		const p0 = [ origPos.getX( v0 ), origPos.getY( v0 ), origPos.getZ( v0 ) ];
		const n0 = [ origNorm.getX( v0 ), origNorm.getY( v0 ), origNorm.getZ( v0 ) ];
		const p1 = [ origPos.getX( v1 ), origPos.getY( v1 ), origPos.getZ( v1 ) ];
		const n1 = [ origNorm.getX( v1 ), origNorm.getY( v1 ), origNorm.getZ( v1 ) ];

		const p0i = [ p0[ 0 ] - n0[ 0 ] * thickness, p0[ 1 ] - n0[ 1 ] * thickness, p0[ 2 ] - n0[ 2 ] * thickness ];
		const p1i = [ p1[ 0 ] - n1[ 0 ] * thickness, p1[ 1 ] - n1[ 1 ] * thickness, p1[ 2 ] - n1[ 2 ] * thickness ];

		// Compute wall normal from edge direction x thickness direction
		const ex = p1[ 0 ] - p0[ 0 ], ey = p1[ 1 ] - p0[ 1 ], ez = p1[ 2 ] - p0[ 2 ];
		const tx = ( n0[ 0 ] + n1[ 0 ] ) * 0.5;
		const ty = ( n0[ 1 ] + n1[ 1 ] ) * 0.5;
		const tz = ( n0[ 2 ] + n1[ 2 ] ) * 0.5;
		let wnx = ey * tz - ez * ty;
		let wny = ez * tx - ex * tz;
		let wnz = ex * ty - ey * tx;
		const wLen = Math.sqrt( wnx * wnx + wny * wny + wnz * wnz );
		if ( wLen > 0.001 ) {

			wnx /= wLen; wny /= wLen; wnz /= wLen;

		}

		// Ensure wall normal for chunk0 points toward chunk1
		const c0 = chunkCentersArr[ chunk0 ];
		const c1 = chunkCentersArr[ chunk1 ];
		const dot = wnx * ( c1.x - c0.x ) + wny * ( c1.y - c0.y ) + wnz * ( c1.z - c0.z );
		if ( dot < 0 ) {

			wnx = - wnx; wny = - wny; wnz = - wnz;

		}

		// Wall for chunk0 (normal points outward from chunk0)
		addVertex( p0[ 0 ], p0[ 1 ], p0[ 2 ], wnx, wny, wnz, chunk0 );
		addVertex( p1[ 0 ], p1[ 1 ], p1[ 2 ], wnx, wny, wnz, chunk0 );
		addVertex( p1i[ 0 ], p1i[ 1 ], p1i[ 2 ], wnx, wny, wnz, chunk0 );

		addVertex( p0[ 0 ], p0[ 1 ], p0[ 2 ], wnx, wny, wnz, chunk0 );
		addVertex( p1i[ 0 ], p1i[ 1 ], p1i[ 2 ], wnx, wny, wnz, chunk0 );
		addVertex( p0i[ 0 ], p0i[ 1 ], p0i[ 2 ], wnx, wny, wnz, chunk0 );

		// Wall for chunk1 (opposite normal, reversed winding)
		addVertex( p1[ 0 ], p1[ 1 ], p1[ 2 ], - wnx, - wny, - wnz, chunk1 );
		addVertex( p0[ 0 ], p0[ 1 ], p0[ 2 ], - wnx, - wny, - wnz, chunk1 );
		addVertex( p0i[ 0 ], p0i[ 1 ], p0i[ 2 ], - wnx, - wny, - wnz, chunk1 );

		addVertex( p1[ 0 ], p1[ 1 ], p1[ 2 ], - wnx, - wny, - wnz, chunk1 );
		addVertex( p0i[ 0 ], p0i[ 1 ], p0i[ 2 ], - wnx, - wny, - wnz, chunk1 );
		addVertex( p1i[ 0 ], p1i[ 1 ], p1i[ 2 ], - wnx, - wny, - wnz, chunk1 );

	}

	// Build final geometry
	const finalPositions = newPositions.slice( 0, vOff * 3 );
	const finalNormals = newNormals.slice( 0, vOff * 3 );
	const finalChunkIds = newChunkIds.slice( 0, vOff );

	const finalGeom = new THREE.BufferGeometry();
	finalGeom.setAttribute( 'position', new THREE.BufferAttribute( finalPositions, 3 ) );
	finalGeom.setAttribute( 'normal', new THREE.BufferAttribute( finalNormals, 3 ) );

	const finalIndices = new Uint32Array( vOff );
	for ( let i = 0; i < vOff; i ++ ) finalIndices[ i ] = i;
	finalGeom.setIndex( new THREE.BufferAttribute( finalIndices, 1 ) );

	return { geometry: finalGeom, chunkIds: finalChunkIds };

}

// ─── Physics ───

function initPhysics( N ) {

	chunkOffsets = [];
	chunkVelocities = [];
	chunkRotations = [];
	chunkAngularVelocities = [];

	for ( let i = 0; i < N; i ++ ) {

		chunkOffsets.push( new THREE.Vector3() );
		chunkVelocities.push( new THREE.Vector3() );
		chunkRotations.push( new THREE.Quaternion() );
		chunkAngularVelocities.push( new THREE.Vector3() );

	}

	exploded = false;

}

function triggerExplosion() {

	const force = params.explosionForce;

	// Compute mesh center (average of chunk centers)
	const meshCenter = new THREE.Vector3();
	for ( let i = 0; i < chunkCount; i ++ ) {

		meshCenter.add( chunkCenters[ i ] );

	}

	meshCenter.divideScalar( chunkCount );

	for ( let i = 0; i < chunkCount; i ++ ) {

		const dir = new THREE.Vector3().subVectors( chunkCenters[ i ], meshCenter );
		const dist = dir.length();
		if ( dist > 0.001 ) dir.normalize();
		else dir.set( Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5 ).normalize();

		// Outward velocity + upward bias + random perturbation
		chunkVelocities[ i ].copy( dir ).multiplyScalar( force * ( 0.5 + Math.random() * 0.5 ) );
		chunkVelocities[ i ].y += force * 0.4 * ( 0.5 + Math.random() * 0.5 );
		chunkVelocities[ i ].x += ( Math.random() - 0.5 ) * force * 0.3;
		chunkVelocities[ i ].z += ( Math.random() - 0.5 ) * force * 0.3;

		// Random angular velocity
		chunkAngularVelocities[ i ].set(
			( Math.random() - 0.5 ) * 10,
			( Math.random() - 0.5 ) * 10,
			( Math.random() - 0.5 ) * 10
		);

	}

	exploded = true;

}

function resetExplosion() {

	for ( let i = 0; i < chunkCount; i ++ ) {

		chunkOffsets[ i ].set( 0, 0, 0 );
		chunkVelocities[ i ].set( 0, 0, 0 );
		chunkRotations[ i ].identity();
		chunkAngularVelocities[ i ].set( 0, 0, 0 );

	}

	exploded = false;

}

function updatePhysics( dt ) {

	if ( ! exploded ) return;

	const gravity = params.gravity;
	const restitution = params.bounce;
	const friction = 0.98;
	const floorY = params.floorY;
	const _q = new THREE.Quaternion();
	const _axis = new THREE.Vector3();

	for ( let i = 0; i < chunkCount; i ++ ) {

		// Semi-implicit Euler
		chunkVelocities[ i ].y -= gravity * dt;
		chunkOffsets[ i ].addScaledVector( chunkVelocities[ i ], dt );

		// Ground collision: check if chunk center + offset is below floor
		const worldY = chunkCenters[ i ].y + chunkOffsets[ i ].y;
		if ( worldY < floorY ) {

			chunkOffsets[ i ].y = floorY - chunkCenters[ i ].y;
			chunkVelocities[ i ].y = - chunkVelocities[ i ].y * restitution;
			chunkVelocities[ i ].x *= friction;
			chunkVelocities[ i ].z *= friction;
			chunkAngularVelocities[ i ].multiplyScalar( 0.9 );

		}

		// Rotation via angular velocity
		const angSpeed = chunkAngularVelocities[ i ].length();
		if ( angSpeed > 0.001 ) {

			_axis.copy( chunkAngularVelocities[ i ] ).normalize();
			_q.setFromAxisAngle( _axis, angSpeed * dt );
			chunkRotations[ i ].premultiply( _q );
			chunkRotations[ i ].normalize();

		}

	}

}

function computeChunkMatrices() {

	// Matrix per chunk: Translate(center + offset) * Rotate(rotation) * Translate(-center)
	const _mat = new THREE.Matrix4();
	const _rotMat = new THREE.Matrix4();
	const _negCenter = new THREE.Matrix4();

	for ( let i = 0; i < chunkCount; i ++ ) {

		const center = chunkCenters[ i ];
		const offset = chunkOffsets[ i ];
		const rotation = chunkRotations[ i ];

		_rotMat.makeRotationFromQuaternion( rotation );
		_negCenter.makeTranslation( - center.x, - center.y, - center.z );

		// T(center + offset) * R * T(-center)
		_mat.makeTranslation(
			center.x + offset.x,
			center.y + offset.y,
			center.z + offset.z
		);
		_mat.multiply( _rotMat );
		_mat.multiply( _negCenter );

		// Write to flat array (column-major, as GPU expects)
		_mat.toArray( chunkMatricesArray, i * 16 );

	}

}

// ─── Init ───

async function init() {

	outputContainer = document.getElementById( 'output' );
	outputContainer.textContent = 'Initializing WebGPU...';

	const adapter = await navigator.gpu.requestAdapter();
	if ( ! adapter ) {

		outputContainer.textContent = 'WebGPU not supported';
		return;

	}

	const requiredFeatures = [];
	if ( adapter.features.has( 'timestamp-query' ) ) {

		requiredFeatures.push( 'timestamp-query' );

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
	const light = new THREE.DirectionalLight( 0xffffff, 3 );
	light.position.set( 5, 5, 2.5 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xb0bec5, 2.4 ) );

	// Camera
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 100 );
	camera.position.set( 0, 2.0, 4 );
	camera.updateProjectionMatrix();

	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.set( 0, 1.0, 0 );
	controls.update();

	clock = new THREE.Clock();

	// Stats
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// GPU BVH builder
	const sorterType = requiredFeatures.includes( 'subgroups' ) ? SorterType.ONESWEEP : SorterType.BUILTIN;
	gpuBVH = new GPUMeshBVH( device, { sorterType } );

	outputContainer.textContent = 'Creating geometry...';

	const { expanded, original } = createTorusKnotGeometry();
	await initializeWithGeometry( expanded, original );

	window.addEventListener( 'resize', resize );

}

async function initializeWithGeometry( geometry, originalGeometry ) {

	// Voronoi fracture on the surface geometry
	chunkCount = params.chunkCount;
	const fracture = voronoiFracture( geometry, chunkCount );

	// Solidify: add inner faces + wall quads at chunk boundaries
	const THICKNESS = 0.06;
	const solidified = solidifyChunks(
		geometry, originalGeometry,
		fracture.chunkIds, fracture.chunkCenters,
		THICKNESS
	);

	// Use solidified geometry from here on
	const solidGeom = solidified.geometry;
	chunkIds = solidified.chunkIds;
	chunkCenters = fracture.chunkCenters;

	const posAttr = solidGeom.attributes.position;
	const normalAttr = solidGeom.attributes.normal;
	totalVertexCount = posAttr.count;
	triCount = totalVertexCount / 3;

	console.log( `Total vertices: ${totalVertexCount}, triangles: ${triCount} (after solidify)` );

	// Initialize physics
	initPhysics( chunkCount );
	chunkMatricesArray = new Float32Array( chunkCount * 16 );
	// Set identity matrices initially
	for ( let i = 0; i < chunkCount; i ++ ) {

		new THREE.Matrix4().toArray( chunkMatricesArray, i * 16 );

	}

	// Prepare GPU buffers (vec4 layout for WGSL alignment)
	const srcPositions4 = new Float32Array( totalVertexCount * 4 );
	const srcNormals4 = new Float32Array( totalVertexCount * 4 );
	for ( let i = 0; i < totalVertexCount; i ++ ) {

		srcPositions4[ i * 4 + 0 ] = posAttr.getX( i );
		srcPositions4[ i * 4 + 1 ] = posAttr.getY( i );
		srcPositions4[ i * 4 + 2 ] = posAttr.getZ( i );
		srcPositions4[ i * 4 + 3 ] = 1.0;

		srcNormals4[ i * 4 + 0 ] = normalAttr.getX( i );
		srcNormals4[ i * 4 + 1 ] = normalAttr.getY( i );
		srcNormals4[ i * 4 + 2 ] = normalAttr.getZ( i );
		srcNormals4[ i * 4 + 3 ] = 0.0;

	}

	const dstPositions4 = new Float32Array( totalVertexCount * 4 );
	const dstNormals4 = new Float32Array( totalVertexCount * 4 );

	transformBuffers = {
		srcPositions: new StorageBufferAttribute( srcPositions4, 4 ),
		srcNormals: new StorageBufferAttribute( srcNormals4, 4 ),
		chunkIds: new StorageBufferAttribute( chunkIds, 1 ),
		chunkMatrices: new StorageBufferAttribute( chunkMatricesArray, 16 ),
		dstPositions: new StorageBufferAttribute( dstPositions4, 4 ),
		dstNormals: new StorageBufferAttribute( dstNormals4, 4 ),
	};

	// Sequential index
	indexArray = new Uint32Array( totalVertexCount );
	for ( let i = 0; i < totalVertexCount; i ++ ) {

		indexArray[ i ] = i;

	}

	// Setup GPU transform compute
	await setupGPUTransform();

	// Run initial transform (identity)
	computeChunkMatrices();
	transformBuffers.chunkMatrices.array.set( chunkMatricesArray );
	transformBuffers.chunkMatrices.needsUpdate = true;
	await runGPUTransform();

	// Allocate CPU readback arrays
	transformedPositions = new Float32Array( totalVertexCount * 3 );
	transformedNormals = new Float32Array( totalVertexCount * 3 );

	// Readback initial positions
	await readbackTransformed();

	// Build initial BVH
	bvhUpdateGeometry = new THREE.BufferGeometry();
	bvhUpdateGeometry.setAttribute( 'position', new THREE.BufferAttribute( transformedPositions, 3 ) );
	bvhUpdateGeometry.setAttribute( 'normal', new THREE.BufferAttribute( transformedNormals, 3 ) );
	bvhUpdateGeometry.setIndex( new THREE.BufferAttribute( indexArray, 1 ) );

	outputContainer.textContent = `Warming up GPU BVH (${triCount} tris)...`;
	await gpuBVH.build( bvhUpdateGeometry );

	// Setup path tracing
	await setupPathTracing();

	// GUI
	setupGUI();

	// Start render loop
	renderer.setAnimationLoop( render );

}

// ─── GPU Transform Compute ───

async function setupGPUTransform() {

	const TRANSFORM_WORKGROUP_SIZE = 256;

	const transformShader = wgslFn( /* wgsl */`
		fn compute(
			srcPositions: ptr<storage, array<vec4f>, read>,
			srcNormals: ptr<storage, array<vec4f>, read>,
			chunkIds: ptr<storage, array<u32>, read>,
			chunkMatrices: ptr<storage, array<mat4x4f>, read>,
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

			let mat = chunkMatrices[chunkIds[globalId]];
			let srcPos = srcPositions[globalId];
			let srcNorm = srcNormals[globalId];

			dstPositions[globalId] = mat * srcPos;
			dstNormals[globalId] = vec4f( normalize( ( mat * vec4f( srcNorm.xyz, 0.0 ) ).xyz ), 0.0 );
		}
	` );

	const transformParams = {
		srcPositions: storage( transformBuffers.srcPositions, 'vec4f', totalVertexCount ).toReadOnly(),
		srcNormals: storage( transformBuffers.srcNormals, 'vec4f', totalVertexCount ).toReadOnly(),
		chunkIds: storage( transformBuffers.chunkIds, 'u32', totalVertexCount ).toReadOnly(),
		chunkMatrices: storage( transformBuffers.chunkMatrices, 'mat4x4f', chunkCount ).toReadOnly(),
		vertexCount: uniform( totalVertexCount ),
		dstPositions: storage( transformBuffers.dstPositions, 'vec4f', totalVertexCount ),
		dstNormals: storage( transformBuffers.dstNormals, 'vec4f', totalVertexCount ),
		workgroupId: workgroupId,
		localId: localId,
	};

	transformBuffers.params = transformParams;

	gpuTransformKernel = transformShader( transformParams ).computeKernel( [ TRANSFORM_WORKGROUP_SIZE, 1, 1 ] );

}

async function runGPUTransform() {

	const workgroupCount = Math.ceil( totalVertexCount / 256 );
	renderer.compute( gpuTransformKernel, [ workgroupCount, 1, 1 ] );

}

async function readbackTransformed() {

	const backend = renderer.backend;
	const dstPosBuf = backend.get( transformBuffers.dstPositions );
	const dstNormBuf = backend.get( transformBuffers.dstNormals );

	if ( ! dstPosBuf || ! dstPosBuf.buffer || ! dstNormBuf || ! dstNormBuf.buffer ) {

		console.warn( 'GPU transform buffers not ready' );
		return;

	}

	const byteSize = totalVertexCount * 16;
	const posReadBuffer = device.createBuffer( {
		size: byteSize,
		usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
	} );
	const normReadBuffer = device.createBuffer( {
		size: byteSize,
		usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
	} );

	const commandEncoder = device.createCommandEncoder();
	commandEncoder.copyBufferToBuffer( dstPosBuf.buffer, 0, posReadBuffer, 0, byteSize );
	commandEncoder.copyBufferToBuffer( dstNormBuf.buffer, 0, normReadBuffer, 0, byteSize );
	device.queue.submit( [ commandEncoder.finish() ] );

	await posReadBuffer.mapAsync( GPUMapMode.READ );
	await normReadBuffer.mapAsync( GPUMapMode.READ );

	const posData = new Float32Array( posReadBuffer.getMappedRange() );
	const normData = new Float32Array( normReadBuffer.getMappedRange() );

	for ( let i = 0; i < totalVertexCount; i ++ ) {

		transformedPositions[ i * 3 + 0 ] = posData[ i * 4 + 0 ];
		transformedPositions[ i * 3 + 1 ] = posData[ i * 4 + 1 ];
		transformedPositions[ i * 3 + 2 ] = posData[ i * 4 + 2 ];
		transformedNormals[ i * 3 + 0 ] = normData[ i * 4 + 0 ];
		transformedNormals[ i * 3 + 1 ] = normData[ i * 4 + 1 ];
		transformedNormals[ i * 3 + 2 ] = normData[ i * 4 + 2 ];

	}

	posReadBuffer.unmap();
	normReadBuffer.unmap();
	posReadBuffer.destroy();
	normReadBuffer.destroy();

}

// ─── Path Tracing Setup ───

async function setupPathTracing() {

	geom_index = new StorageBufferAttribute( indexArray, 3 );
	geom_position = new StorageBufferAttribute( transformedPositions, 3 );
	geom_normals = new StorageBufferAttribute( transformedNormals, 3 );
	geom_chunkIds = new StorageBufferAttribute( chunkIds, 1 );

	bvhBufferCapacity = gpuBVH.maxNodeCount;
	const bvh2Array = new Float32Array( bvhBufferCapacity * 8 );
	bvh2Nodes = new StorageBufferAttribute( bvh2Array, 8 );

	rootIndexBuffer = new StorageBufferAttribute( new Uint32Array( [ 0 ] ), 1 );

	computeShaderParams = {
		outputTex: textureStore( outputTex ),
		smoothNormals: uniform( 1 ),
		inverseProjectionMatrix: uniform( new THREE.Matrix4() ),
		cameraToWorldMatrix: uniform( new THREE.Matrix4() ),
		floorY: uniform( params.floorY ),
		time: uniform( 0.0 ),
		frameCount: uniform( 0 ),
		samples: uniform( 1 ),
		geom_index: storage( geom_index, 'uvec3', geom_index.count ).toReadOnly(),
		geom_position: storage( geom_position, 'vec3', geom_position.count ).toReadOnly(),
		geom_normals: storage( geom_normals, 'vec3', geom_normals.count ).toReadOnly(),
		geom_chunkIds: storage( geom_chunkIds, 'u32', geom_chunkIds.count ).toReadOnly(),
		bvh: storage( bvh2Nodes, 'BVH2Node', bvhBufferCapacity ).toReadOnly(),
		rootIndexBuf: storage( rootIndexBuffer, 'u32', 1 ).toReadOnly(),
		workgroupSize: uniform( new THREE.Vector3() ),
		workgroupId: workgroupId,
		localId: localId
	};

	const utils = wgsl( /* wgsl */ `
		fn hash( seed: u32 ) -> u32 {
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

		fn cosineSampleHemisphere( normal: vec3f, seed: ptr<function, u32> ) -> vec3f {
			let r1 = randomFloat( seed );
			let r2 = randomFloat( seed );
			let phi = 2.0 * 3.14159265 * r1;
			let cosTheta = sqrt( r2 );
			let sinTheta = sqrt( 1.0 - r2 );

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

		// Generate a vivid color from a chunk ID
		fn chunkColor( id: u32 ) -> vec3f {
			let h0 = hash( id * 7u + 13u );
			let h1 = hash( h0 );
			let h2 = hash( h1 );
			// HSV-like: high saturation, high value
			let hue = f32( h0 & 0xffffu ) / 65535.0;
			let sat = 0.6 + f32( h1 & 0xffffu ) / 65535.0 * 0.4;
			let val = 0.7 + f32( h2 & 0xffffu ) / 65535.0 * 0.3;
			// HSV to RGB
			let h = hue * 6.0;
			let c = val * sat;
			let x = c * ( 1.0 - abs( h % 2.0 - 1.0 ) );
			let m = val - c;
			var rgb = vec3f( m );
			let hi = u32( floor( h ) ) % 6u;
			if ( hi == 0u ) { rgb += vec3f( c, x, 0.0 ); }
			else if ( hi == 1u ) { rgb += vec3f( x, c, 0.0 ); }
			else if ( hi == 2u ) { rgb += vec3f( 0.0, c, x ); }
			else if ( hi == 3u ) { rgb += vec3f( 0.0, x, c ); }
			else if ( hi == 4u ) { rgb += vec3f( x, 0.0, c ); }
			else { rgb += vec3f( c, 0.0, x ); }
			return rgb;
		}
	` );

	const computeShader = wgslFn( /* wgsl */`
		fn compute(
			outputTex: texture_storage_2d<rgba8unorm, write>,
			smoothNormals: u32,
			inverseProjectionMatrix: mat4x4f,
			cameraToWorldMatrix: mat4x4f,
			floorY: f32,
			time: f32,
			frameCount: u32,
			samples: u32,
			geom_position: ptr<storage, array<vec3f>, read>,
			geom_index: ptr<storage, array<vec3u>, read>,
			geom_normals: ptr<storage, array<vec3f>, read>,
			geom_chunkIds: ptr<storage, array<u32>, read>,
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

			var rngSeed = indexUV.x + indexUV.y * dimensions.x + frameCount * dimensions.x * dimensions.y;

			// Lighting
			let sunDir = normalize( vec3f( 0.5, 0.8, 0.3 ) );
			let sunColor = vec3f( 1.4, 1.3, 1.1 );
			let skyColor = vec3f( 0.4, 0.5, 0.7 );
			let groundColor = vec3f( 0.2, 0.15, 0.1 );

			var totalRadiance = vec3f( 0.0 );
			let baseWorldRay = ndcToCameraRay( ndc, cameraToWorldMatrix * inverseProjectionMatrix );

			for ( var sampleIdx = 0u; sampleIdx < samples; sampleIdx++ ) {
				var throughput = vec3f( 1.0 );
				var radiance = vec3f( 0.0 );
				var worldRay = baseWorldRay;

				let worldRayDirLen = length( worldRay.direction );
				worldRay.direction = worldRay.direction / worldRayDirLen;

				rngSeed = hash( rngSeed + sampleIdx * 12345u );

				for ( var bounce = 0u; bounce < 4u; bounce++ ) {
				var hitDist = 1e30f;
				var hitNormal = vec3f( 0.0, 1.0, 0.0 );
				var hitColor = vec3f( 0.5 );
				var hitMetalness = 0.0;
				var hitType = 0u; // 0=miss, 1=mesh, 2=floor

				// === Test mesh (geometry already in world space) ===
				let meshHit = bvh2IntersectFirstHit( geom_index, geom_position, bvh, worldRay, rootIndex );
				if ( meshHit.didHit ) {
					let meshDist = meshHit.dist;
					if ( meshDist < hitDist && meshDist > 0.001 ) {
						hitDist = meshDist;
						var n = select(
							meshHit.normal,
							normalize( getVertexAttribute( meshHit.barycoord, meshHit.indices.xyz, geom_normals ) ),
							smoothNormals > 0u
						);
						hitNormal = n;
						// Per-chunk color from chunk ID of first vertex
						let vertIdx = meshHit.indices.x;
						let cid = geom_chunkIds[vertIdx];
						hitColor = chunkColor( cid );
						hitMetalness = 0.15;
						hitType = 1u;
					}
				}

				// === Test floor ===
				if ( worldRay.direction.y < -0.0001 && worldRay.origin.y > floorY ) {
					let floorDist = ( floorY - worldRay.origin.y ) / worldRay.direction.y;
					if ( floorDist > 0.001 && floorDist < hitDist ) {
						hitDist = floorDist;
						hitNormal = vec3f( 0.0, 1.0, 0.0 );
						let floorHitPoint = worldRay.origin + worldRay.direction * floorDist;
						let cx = floor( floorHitPoint.x * 0.5 + 1000.0 );
						let cz = floor( floorHitPoint.z * 0.5 + 1000.0 );
						let checker = ( i32( cx ) + i32( cz ) ) % 2;
						hitColor = select( vec3f( 0.3, 0.3, 0.32 ), vec3f( 0.5, 0.5, 0.52 ), checker == 1 );
						hitType = 2u;
					}
				}

				// === Process hit ===
				if ( hitType == 0u ) {
					let skyT = ( worldRay.direction.y + 1.0 ) * 0.5;
					let envColor = mix( groundColor, skyColor, skyT );
					let sunDot = max( 0.0, dot( worldRay.direction, sunDir ) );
					let sun = sunColor * pow( sunDot, 128.0 ) * 2.0;
					radiance += throughput * ( envColor + sun );
					break;
				}

				let hitPoint = worldRay.origin + worldRay.direction * hitDist;

				// Direct lighting with shadow ray (geometry is world-space)
				var directLight = vec3f( 0.0 );
				var shadowRay: Ray;
				shadowRay.origin = hitPoint + hitNormal * 0.01;
				shadowRay.direction = sunDir;
				let shadowHit = bvh2IntersectFirstHit( geom_index, geom_position, bvh, shadowRay, rootIndex );

				if ( !shadowHit.didHit ) {
					let NdotL = max( 0.0, dot( hitNormal, sunDir ) );
					directLight = sunColor * NdotL;
				}

				radiance += throughput * hitColor * directLight;

				// Russian roulette after 2 bounces
				if ( bounce > 1u ) {
					let p = max( max( throughput.x, throughput.y ), throughput.z );
					if ( randomFloat( &rngSeed ) > p ) {
						break;
					}
					throughput /= p;
				}

				// Bounce
				var bounceDir: vec3f;
				if ( hitMetalness > 0.01 ) {
					let reflectDir = reflect( worldRay.direction, hitNormal );
					if ( randomFloat( &rngSeed ) < hitMetalness ) {
						let roughness = 0.1;
						let roughDir = cosineSampleHemisphere( reflectDir, &rngSeed );
						bounceDir = normalize( mix( reflectDir, roughDir, roughness ) );
						throughput *= hitColor;
					} else {
						bounceDir = cosineSampleHemisphere( hitNormal, &rngSeed );
						throughput *= hitColor;
					}
				} else {
					bounceDir = cosineSampleHemisphere( hitNormal, &rngSeed );
					throughput *= hitColor;
				}
					worldRay.origin = hitPoint + hitNormal * 0.001;
					worldRay.direction = bounceDir;
				} // end bounce loop

				totalRadiance += radiance;
			} // end sample loop

			var finalRadiance = totalRadiance / f32( samples );

			// Tone mapping and gamma
			finalRadiance = finalRadiance / ( finalRadiance + vec3f( 1.0 ) );
			finalRadiance = pow( finalRadiance, vec3f( 1.0 / 2.2 ) );

			textureStore( outputTex, indexUV, vec4f( finalRadiance, 1.0 ) );
		}
	`, [ ndcToCameraRay, bvh2IntersectFirstHit, getVertexAttribute, utils ] );

	computeKernel = computeShader( computeShaderParams ).computeKernel( WORKGROUP_SIZE );

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

	resize();

}

// ─── GUI ───

function setupGUI() {

	gui = new GUI();

	gui.add( { explode: triggerExplosion }, 'explode' ).name( 'Explode' );
	gui.add( { reset: resetExplosion }, 'reset' ).name( 'Reset' );
	gui.add( params, 'pause' );
	gui.add( params, 'bvhUpdateMode', Object.values( BVH_UPDATE_MODES ) ).name( 'BVH update' );
	gui.add( params, 'smoothNormals' );
	gui.add( params, 'explosionForce', 2, 20, 0.5 ).name( 'explosion force' );
	gui.add( params, 'gravity', 0, 20, 0.5 ).name( 'gravity' );
	gui.add( params, 'bounce', 0, 1, 0.05 ).name( 'bounce' );
	gui.add( params, 'samples', 1, 8, 1 ).name( 'samples per pixel' );
	gui.add( params, 'resolutionScale', 0.1, 1, 0.1 ).onChange( resize );
	gui.add( params, 'floorY', - 3, 0, 0.05 ).name( 'floor height' );

}

// ─── BVH Update ───

async function updateBVH() {

	if ( buildInProgress ) return;
	buildInProgress = true;

	try {

		const useRefit = params.bvhUpdateMode === BVH_UPDATE_MODES.REFIT;

		// GPU transform
		const transformStart = performance.now();
		computeChunkMatrices();
		transformBuffers.chunkMatrices.array.set( chunkMatricesArray );
		transformBuffers.chunkMatrices.needsUpdate = true;
		await runGPUTransform();
		const transformTime = performance.now() - transformStart;

		// Readback transformed positions and normals
		await readbackTransformed();

		// Update ray tracer buffers
		geom_position.array.set( transformedPositions );
		geom_position.needsUpdate = true;
		geom_normals.array.set( transformedNormals );
		geom_normals.needsUpdate = true;

		// Refit or rebuild BVH
		const bvhStart = performance.now();
		if ( useRefit ) {

			await gpuBVH.refitAsync( { geometry: bvhUpdateGeometry, useFlatten: false } );

		} else {

			await gpuBVH.buildAsync( bvhUpdateGeometry, { useFlatten: false } );

		}

		const bvhUpdateTime = performance.now() - bvhStart;

		// Update running averages
		frameCount ++;
		const alpha = Math.min( frameCount, 60 );
		avgTransformTime += ( transformTime - avgTransformTime ) / alpha;
		avgBvhUpdateTime += ( bvhUpdateTime - avgBvhUpdateTime ) / alpha;

		// GPU->GPU copy BVH data
		const maxNodeCount = gpuBVH.maxNodeCount;
		const backend = renderer.backend;
		const bvhDst = backend.get( bvh2Nodes );
		const rootIndexDst = backend.get( rootIndexBuffer );

		if ( bvhDst && bvhDst.buffer && rootIndexDst && rootIndexDst.buffer ) {

			const byteLength = maxNodeCount * 32;
			const commandEncoder = device.createCommandEncoder();
			commandEncoder.copyBufferToBuffer( gpuBVH.bvh2Buffer, 0, bvhDst.buffer, 0, byteLength );
			commandEncoder.copyBufferToBuffer( gpuBVH.clusterIdxBuffer, 0, rootIndexDst.buffer, 0, 4 );
			device.queue.submit( [ commandEncoder.finish() ] );

		} else {

			console.info( 'BVH: Using CPU fallback' );
			const bvh2Array = await readbackBVH( gpuBVH.bvh2Buffer, maxNodeCount );
			bvh2Nodes.array.set( bvh2Array );
			bvh2Nodes.needsUpdate = true;
			const rootIdx = await readbackRootIndex( gpuBVH.clusterIdxBuffer );
			rootIndexBuffer.array[ 0 ] = rootIdx;
			rootIndexBuffer.needsUpdate = true;

		}

		// Update display
		const bvhLabel = useRefit ? 'BVH refit' : 'BVH rebuild';
		let output = `triangles: ${triCount}\n`;
		output += `GPU transform: ${transformTime.toFixed( 2 )} ms (avg: ${avgTransformTime.toFixed( 2 )})\n`;
		output += `${bvhLabel}: ${bvhUpdateTime.toFixed( 2 )} ms (avg: ${avgBvhUpdateTime.toFixed( 2 )})\n`;
		output += `mode: ${params.bvhUpdateMode}`;
		outputContainer.textContent = output;

	} finally {

		buildInProgress = false;

	}

}

async function readbackBVH( bvhBuffer, nodeCount ) {

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
	const copy = new Float32Array( mapped.slice( 0 ) );
	readBuffer.unmap();
	readBuffer.destroy();

	return copy;

}

async function readbackRootIndex( clusterIdxBuffer ) {

	const readBuffer = device.createBuffer( {
		size: 4,
		usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
	} );

	const commandEncoder = device.createCommandEncoder();
	commandEncoder.copyBufferToBuffer( clusterIdxBuffer, 0, readBuffer, 0, 4 );
	device.queue.submit( [ commandEncoder.finish() ] );

	await readBuffer.mapAsync( GPUMapMode.READ );
	const mapped = readBuffer.getMappedRange();
	const rootIndex = new Uint32Array( mapped )[ 0 ];
	readBuffer.unmap();
	readBuffer.destroy();

	return rootIndex;

}

// ─── Resize ───

function resize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	const dpr = window.devicePixelRatio;
	const scale = params.resolutionScale;

	camera.aspect = w / h;
	camera.updateProjectionMatrix();

	renderer.setSize( w, h );
	renderer.setPixelRatio( dpr );

	if ( outputTex ) {

		outputTex.dispose();

	}

	outputTex = new StorageTexture( w * dpr * scale, h * dpr * scale );
	outputTex.format = THREE.RGBAFormat;
	outputTex.type = THREE.UnsignedByteType;
	outputTex.magFilter = THREE.LinearFilter;

	if ( computeShaderParams ) {

		computeShaderParams.outputTex = textureStore( outputTex );

	}

}

// ─── Render ───

async function render() {

	stats.update();

	const delta = Math.min( clock.getDelta(), 0.033 );

	// Update physics
	if ( ! params.pause && exploded ) {

		updatePhysics( delta );

	}

	// Update BVH every frame
	if ( ! params.pause && ! buildInProgress ) {

		await updateBVH();

	}

	// Path trace
	if ( computeKernel && outputTex ) {

		dispatchSize = [
			Math.ceil( outputTex.width / WORKGROUP_SIZE[ 0 ] ),
			Math.ceil( outputTex.height / WORKGROUP_SIZE[ 1 ] ),
		];

		camera.updateMatrixWorld();

		computeKernel.computeNode.parameters.outputTex.value = outputTex;
		computeKernel.computeNode.parameters.smoothNormals.value = Number( params.smoothNormals );
		computeKernel.computeNode.parameters.inverseProjectionMatrix.value = camera.projectionMatrixInverse;
		computeKernel.computeNode.parameters.cameraToWorldMatrix.value.copy( camera.matrixWorld );
		computeKernel.computeNode.parameters.floorY.value = params.floorY;
		computeKernel.computeNode.parameters.time.value = clock.getElapsedTime();
		computeKernel.computeNode.parameters.frameCount.value = frameCount;
		computeKernel.computeNode.parameters.samples.value = params.samples;
		computeKernel.computeNode.parameters.workgroupSize.value.fromArray( WORKGROUP_SIZE );

		renderer.compute( computeKernel, dispatchSize );

		fsMaterial.colorNode.colorNode.value = outputTex;
		fsQuad.render( renderer );

	}

}
