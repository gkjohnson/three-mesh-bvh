import { setupShaders } from './shaders/setup.wgsl.js';
import { radixSortShaders } from './shaders/radix_sort.wgsl.js';
import {
	hplocShader,
	hplocShaderWave32,
	hplocShaderWave64,
	hplocShaderWave32Indirect,
	hplocShaderWave64Indirect,
	hplocShaderIndirect,
	hplocUpdateDispatchShaderWave32,
	hplocUpdateDispatchShaderWave64,
	hplocInitActiveListShader,
	hplocInitIndirectCountersShader,
} from './shaders/hploc.wgsl.js';
import { flattenShader } from './shaders/flatten.wgsl.js';
import { refitBuildParentsShader, refitBVHLeavesShader, getRefitBVHInternalShader } from './shaders/refit.wgsl.js';
import { OneSweepSorter } from './sorting/OneSweepSorter.js';

// Subgroup detection shader
const subgroupDetectShader = /* wgsl */ `
enable subgroups;

@group(0) @binding(0)
var<storage, read_write> outSize : array<u32, 1>;

@compute @workgroup_size(1)
fn main(@builtin(subgroup_size) subgroupSize : u32) {
    outSize[0] = subgroupSize;
}
`;

/**
 * Available sorter types
 */
export const SorterType = {
	BUILTIN: 'builtin', // Original inline implementation
	ONESWEEP: 'onesweep', // High-performance OneSweep
};

// H-PLOC indirect iteration cap: ceil(log2(N) * factor)
// Reduced from 3 to 2 to cut tail no-op indirect iterations.
const HPLOC_MAX_ITERATION_FACTOR = 2;
// Refit propagation may require deeper wave count than H-PLOC merge iterations.
const REFIT_MAX_ITERATION_FACTOR = 4;

/**
 * GPU-based BVH builder using H-PLOC algorithm.
 * Builds BVH entirely on the GPU using WebGPU compute shaders.
 */
export class GPUMeshBVH {

	constructor( device, options = {} ) {

		this.device = device;

		// Sorter configuration: prefer OneSweep when subgroups available (much faster)
		const hasSubgroups = device.features && device.features.has( 'subgroups' );
		if ( options.sorterType === SorterType.BUILTIN || options.sorterType === SorterType.ONESWEEP ) {

			this._sorterType = options.sorterType;

		} else if ( options.sorterType !== undefined ) {

			// Unknown sorter types (including removed SIMPLE) fall back to builtin.
			this._sorterType = SorterType.BUILTIN;
			if ( options.verbose === true ) {

				console.warn( `GPUMeshBVH: Unsupported sorterType "${options.sorterType}", falling back to "${SorterType.BUILTIN}"` );

			}

		} else if ( hasSubgroups ) {

			this._sorterType = SorterType.ONESWEEP;

		} else {

			this._sorterType = SorterType.BUILTIN;

		}

		this._sorter = null;

		// Pipeline cache
		this._pipelines = null;

		// Build state buffers (reusable)
		this._buildBuffers = null;

		// Output buffers
		this._bvhBuffer = null;
		this._positionBuffer = null;
		this._indexBuffer = null;

		// Stats
		this._nodeCount = 0;
		this._primCount = 0;
		this._buildTimeMs = 0;
		this._passTimings = null;
		this._rootIndex = 0;

		// Timestamp query support (for accurate timing without multi-submit overhead)
		this._hasTimestampQuery = device.features.has( 'timestamp-query' );
		this._timestampBuffers = null;

		// Subgroups support - enables 1-subgroup-per-workgroup design for H-PLOC
		// This eliminates wasted workgroupBarrier() synchronization overhead
		this._hasSubgroups = device.features && device.features.has( 'subgroups' );
		this._subgroupSize = 0; // Detected at runtime (32 for Apple/NVIDIA, 64 for AMD)
		this._hplocShaderVariant = 'fallback'; // 'wave32', 'wave64', or 'fallback'
		// Default to 64 (fallback workgroup size), updated after subgroup detection
		this._hplocWorkgroupSize = 64;

		// Verbose logging (disabled by default for performance)
		this._verbose = options.verbose === true;

		// Position stride (floats per vertex: 3 for vec3, 4 for vec4)
		this._positionStride = 3;

		// External buffer tracking (don't destroy buffers we don't own)
		this._externalPositionBuffer = false;
		this._externalIndexBuffer = false;

		// Refit parent map validity (topology-dependent).
		this._refitParentsDirty = true;
		this._refitBindGroups = null;
		this._refitBindGroupsCacheKey = null;

	}

	get sorterType() {

		return this._sorterType;

	}

	get bvhBuffer() {

		return this._bvhBuffer;

	}

	get positionBuffer() {

		return this._positionBuffer;

	}

	get indexBuffer() {

		return this._indexBuffer;

	}

	get nodeCount() {

		return this._nodeCount;

	}

	get buildTimeMs() {

		return this._buildTimeMs;

	}

	get passTimings() {

		return this._passTimings;

	}

	get cpuPrepTimings() {

		return this._cpuPrepTimings;

	}

	get rootIndex() {

		return this._rootIndex;

	}

	// Returns the raw BVH2 buffer (H-PLOC format with absolute child indices)
	get bvh2Buffer() {

		return this._buildBuffers ? this._buildBuffers.bvh2Nodes : null;

	}

	/**
	 * Returns the clusterIdx buffer - after build, clusterIdx[0] contains the root index.
	 * Use this for GPU-side root index access to avoid CPU readback stalls.
	 */
	get clusterIdxBuffer() {

		return this._buildBuffers ? this._buildBuffers.clusterIdx : null;

	}

	/**
	 * Returns the maximum possible node count for the last build (2 * primCount).
	 * Use this to size destination buffers when avoiding CPU readback.
	 */
	get maxNodeCount() {

		return this._primCount ? 2 * this._primCount : 0;

	}

	// Returns the sorter instance for debugging (may be null if using builtin sort)
	get sorter() {

		return this._sorter;

	}

	/**
	 * Build BVH from Three.js BufferGeometry
	 * @param {BufferGeometry} geometry
	 * @param {Object} options
	 * @param {boolean} options.useFlatten - If true, run flatten pass for traditional traversal format (default: false)
	 * @param {boolean} options.debugTiming - If true, add per-phase timing (uses GPU timestamps if available)
	 * @returns {Promise<void>}
	 */
	async build( geometry, options = {} ) {

		const { useFlatten = false, debugTiming = false } = options;

		const startTime = performance.now();

		// Extract geometry data
		const t0 = performance.now();
		const { positions, indices, primCount } = this._extractGeometryData( geometry );
		const extractTime = performance.now() - t0;

		this._primCount = primCount;

		// Allocate buffers (includes readback buffer)
		const t1 = performance.now();
		this._allocateBuffers( primCount );
		const allocTime = performance.now() - t1;

		// Upload geometry to GPU
		// Note: No await needed here - WebGPU guarantees ordering between writeBuffer and command submission
		const t2 = performance.now();
		this._uploadGeometry( positions, indices );
		const uploadTime = performance.now() - t2;

		// Create pipelines if needed (requires subgroup detection first)
		const t3 = performance.now();
		if ( ! this._pipelines ) {

			// Detect subgroup size for optimal H-PLOC variant selection
			if ( this._hasSubgroups && this._subgroupSize === 0 ) {

				await this._detectSubgroupSize();

			}

			this._pipelines = this._createPipelines();

		}

		const pipelineTime = performance.now() - t3;

		// Initialize external sorter if configured, or grow if needed
		const t4 = performance.now();
		if ( this._sorterType === SorterType.BUILTIN ) {

			// Dispose any stale external sorter when using builtin
			// This prevents _recordRadixSortPass from accidentally using an old sorter
			if ( this._sorter ) {

				this._sorter.dispose();
				this._sorter = null;

			}

		} else {

			if ( ! this._sorter ) {

				await this._initSorter( primCount );

			} else if ( this._sorter.maxKeys !== undefined && primCount > this._sorter.maxKeys ) {

				// Sorter exists but buffers are too small - reinit to grow
				await this._sorter.init( primCount );

			}

		}

		const sorterInitTime = performance.now() - t4;

		// Store CPU prep timings for debug mode
		this._cpuPrepTimings = {
			extract: extractTime,
			alloc: allocTime,
			upload: uploadTime,
			pipeline: pipelineTime,
			sorterInit: sorterInitTime,
			total: extractTime + allocTime + uploadTime + pipelineTime + sorterInitTime,
		};

		// Build path selection:
		// - debugTiming + timestamps: single-submit with GPU timestamp queries (most accurate)
		// - debugTiming + no timestamps: multi-submit with CPU timing (adds sync overhead)
		// - no debugTiming: single-submit (fastest, no timing breakdown)
		if ( debugTiming ) {

			if ( this._hasTimestampQuery ) {

				if ( this._verbose ) console.info( 'GPUMeshBVH: Using DEBUG build path (single-submit with timestamps)' );
				await this._buildSingleSubmitWithTimestamps( primCount, useFlatten );

			} else {

				if ( this._verbose ) console.info( 'GPUMeshBVH: Using DEBUG build path (multi-submit, no timestamps)' );
				await this._buildWithTiming( primCount, useFlatten );

			}

		} else {

			if ( this._verbose ) console.info( 'GPUMeshBVH: Using FAST build path (single-submit, no timing)' );
			await this._buildSingleSubmit( primCount, useFlatten );

		}

		this._buildTimeMs = performance.now() - startTime;
		this._refitParentsDirty = true;

	}

	/**
	 * Refit existing BVH topology after primitive positions change.
	 * Keeps child links fixed and updates only node bounds.
	 *
	 * @param {Object} options
	 * @param {?BufferGeometry} options.geometry - Optional geometry to upload before refit
	 * @param {boolean} options.useFlatten - If true, rerun flatten pass after refit (default: false)
	 * @param {boolean} options.debugTiming - If true and timestamp-query is available, record GPU split timings for refit passes
	 * @returns {Promise<void>}
	 */
	async refit( options = {} ) {

		return this._refitInternal( options, true );

	}

	/**
	 * Asynchronous refit variant.
	 * Submits GPU work without waiting for completion.
	 *
	 * @param {Object} options
	 * @param {?BufferGeometry} options.geometry - Optional geometry to upload before refit
	 * @param {boolean} options.useFlatten - If true, rerun flatten pass after refit (default: false)
	 * @param {boolean} options.debugTiming - Ignored in async mode unless completion is awaited externally
	 * @returns {Promise<void>} Resolves after submission
	 */
	async refitAsync( options = {} ) {

		return this._refitInternal( options, false );

	}

	async _refitInternal( options = {}, waitForCompletion = true ) {

		const { geometry = null, useFlatten = false, debugTiming = false } = options;
		if ( ! this._buildBuffers || ! this._pipelines || ! this._primCount ) {

			throw new Error( 'GPUMeshBVH.refit: No existing BVH. Build first.' );

		}

		const startTime = performance.now();
		let extractTime = 0;
		let uploadTime = 0;

		if ( geometry ) {

			const tExtract = performance.now();
			const { positions, indices, primCount } = this._extractGeometryData( geometry );
			extractTime = performance.now() - tExtract;
			if ( primCount !== this._primCount ) {

				throw new Error( `GPUMeshBVH.refit: primCount changed (${this._primCount} -> ${primCount}). Rebuild required.` );

			}

			const tUpload = performance.now();
			this._uploadGeometry( positions, indices, false );
			uploadTime = performance.now() - tUpload;

		}

		if ( ! this._positionBuffer || ! this._indexBuffer ) {

			throw new Error( 'GPUMeshBVH.refit: Missing geometry buffers.' );

		}

		let parentBuildTime = 0;
		if ( this._refitParentsDirty ) {

			const tParents = performance.now();
			await this._buildRefitParentMap( waitForCompletion );
			parentBuildTime = performance.now() - tParents;

		}

		const tRefit = performance.now();
		const refitInfo = await this._runRefitPass( useFlatten, waitForCompletion, debugTiming );
		const refitTime = performance.now() - tRefit;

		this._cpuPrepTimings = {
			extract: extractTime,
			alloc: 0,
			upload: uploadTime,
			pipeline: 0,
			sorterInit: 0,
			total: extractTime + uploadTime,
		};

		const passTimings = {
			refit: refitTime,
			refitBuildParents: parentBuildTime,
			refitIterations: refitInfo.maxIterations,
		};
		if ( refitInfo.gpuTimestamps ) {

			passTimings.gpuTimestamps = true;
			passTimings.refitLeaves = refitInfo.refitLeaves;
			passTimings.refitInternal = refitInfo.refitInternal;
			passTimings.refitGpuTotal = refitInfo.refitGpuTotal;

		}

		this._passTimings = passTimings;

		this._buildTimeMs = performance.now() - startTime;

	}

	/**
	 * Build BVH without CPU readback - fully asynchronous GPU operation.
	 * Use this for per-frame rebuilds where you want to avoid CPU stalls.
	 *
	 * After calling this:
	 * - bvh2Buffer contains the BVH (use maxNodeCount for buffer sizing)
	 * - clusterIdxBuffer[0] contains the root index (read in shader)
	 * - nodeCount and rootIndex getters will NOT be updated (use GPU-side values)
	 *
	 * @param {BufferGeometry} geometry
	 * @param {Object} options
	 * @param {boolean} options.useFlatten - If true, run flatten pass (default: false)
	 * @returns {Promise<void>} - Resolves when GPU work is submitted (not completed)
	 */
	async buildAsync( geometry, options = {} ) {

		const { useFlatten = false } = options;

		// Extract geometry data
		const { positions, indices, primCount } = this._extractGeometryData( geometry );
		this._primCount = primCount;

		// Allocate buffers if needed (reuses existing if capacity sufficient)
		this._allocateBuffers( primCount );

		// Upload geometry to GPU
		this._uploadGeometry( positions, indices );

		// Create pipelines if needed
		if ( ! this._pipelines ) {

			if ( this._hasSubgroups && this._subgroupSize === 0 ) {

				await this._detectSubgroupSize();

			}

			this._pipelines = this._createPipelines();

		}

		// Initialize sorter if needed
		if ( this._sorterType !== SorterType.BUILTIN ) {

			if ( ! this._sorter ) {

				await this._initSorter( primCount );

			} else if ( this._sorter.maxKeys !== undefined && primCount > this._sorter.maxKeys ) {

				await this._sorter.init( primCount );

			}

		}

		// Build without readback
		this._buildSingleSubmitNoReadback( primCount, useFlatten );

	}

	/**
	 * Build BVH from pre-existing GPU buffers.
	 * Default path avoids CPU readback; debug timing mode adds synchronization for measurements.
	 * Accepts raw GPU buffers with configurable position stride, eliminating
	 * GPU→CPU→GPU round-trips for use cases like GPU skinning.
	 *
	 * @param {Object} options
	 * @param {GPUBuffer} options.positionBuffer - GPU buffer with position data as array<f32>
	 * @param {GPUBuffer} options.indexBuffer - GPU buffer with index data as array<u32>
	 * @param {number} options.primCount - Number of triangles
	 * @param {number} options.positionStride - Floats per vertex (3 for vec3, 4 for vec4). Default: 3
	 * @param {boolean} options.useFlatten - If true, run flatten pass. Default: false
	 * @param {boolean} options.debugTiming - If true, collect per-phase timings (uses timestamp-query when available)
	 * @returns {Promise<void>}
	 */
	async buildAsyncFromGPUBuffers( options ) {

		const startTime = performance.now();

		const {
			positionBuffer,
			indexBuffer,
			primCount,
			positionStride = 3,
			useFlatten = false,
			debugTiming = false,
		} = options;

		this._primCount = primCount;
		this._positionStride = positionStride;

		// Invalidate setup bind groups if position/index buffer identity changes
		if ( this._positionBuffer !== positionBuffer || this._indexBuffer !== indexBuffer ) {

			this._setupBindGroups = null;
			this._refitBindGroups = null;
			this._refitBindGroupsCacheKey = null;

		}

		// Swap in external buffers (destroy old owned buffers if any)
		if ( this._positionBuffer && ! this._externalPositionBuffer ) {

			this._positionBuffer.destroy();

		}

		this._positionBuffer = positionBuffer;
		this._externalPositionBuffer = true;

		if ( this._indexBuffer && ! this._externalIndexBuffer ) {

			this._indexBuffer.destroy();

		}

		this._indexBuffer = indexBuffer;
		this._externalIndexBuffer = true;

		// Allocate build buffers if needed
		this._allocateBuffers( primCount );

		// Initialize build state (scene bounds, node counter)
		this._initBuildState();

		// Create pipelines if needed
		if ( ! this._pipelines ) {

			if ( this._hasSubgroups && this._subgroupSize === 0 ) {

				await this._detectSubgroupSize();

			}

			this._pipelines = this._createPipelines();

		}

		// Initialize sorter if needed
		if ( this._sorterType !== SorterType.BUILTIN ) {

			if ( ! this._sorter ) {

				await this._initSorter( primCount );

			} else if ( this._sorter.maxKeys !== undefined && primCount > this._sorter.maxKeys ) {

				await this._sorter.init( primCount );

			}

		}

		if ( debugTiming ) {

			if ( this._hasTimestampQuery ) {

				if ( this._verbose ) console.info( 'GPUMeshBVH: Using DEBUG GPU-buffer build path (single-submit with timestamps)' );
				await this._buildSingleSubmitWithTimestamps( primCount, useFlatten );

			} else {

				if ( this._verbose ) console.info( 'GPUMeshBVH: Using DEBUG GPU-buffer build path (multi-submit, no timestamps)' );
				await this._buildWithTiming( primCount, useFlatten );

			}

		} else {

			// Fast path: build without waiting and without readback.
			this._buildSingleSubmitNoReadback( primCount, useFlatten );

		}

		this._buildTimeMs = performance.now() - startTime;
		this._refitParentsDirty = true;

	}

	/**
	 * Single-submission build without CPU readback.
	 * After this returns, bvh2Buffer has the BVH and clusterIdx[0] has the root index.
	 * No await needed - WebGPU queue ordering guarantees completion before subsequent commands.
	 */
	_buildSingleSubmitNoReadback( primCount, useFlatten ) {

		const device = this.device;
		const workgroupSize = 256;
		const workgroupCount = Math.ceil( primCount / workgroupSize );

		// Pre-allocate uniform data
		const ALIGN = 256;
		const uniformCount = 1 + 1 + 4 + 1 + 1;
		const uniformData = new ArrayBuffer( uniformCount * ALIGN );

		let offset = 0;
		const offsets = {};

		offsets.setup = offset;
		new Uint32Array( uniformData, offset, 4 ).set( [ primCount, workgroupCount, this._positionStride, 0 ] );
		offset += ALIGN;

		offsets.morton = offset;
		new Uint32Array( uniformData, offset, 4 ).set( [ primCount, workgroupCount, 0, 0 ] );
		offset += ALIGN;

		offsets.sort = [];
		const sortWorkgroupCount = Math.ceil( primCount / 256 );
		for ( let i = 0; i < 4; i ++ ) {

			offsets.sort.push( offset );
			new Uint32Array( uniformData, offset, 4 ).set( [ primCount, i * 8, sortWorkgroupCount, 0 ] );
			offset += ALIGN;

		}

		offsets.hploc = offset;
		new Uint32Array( uniformData, offset, 4 ).set( [ primCount, 0, 0, 0 ] );
		offset += ALIGN;

		const useIndirectDispatch = this._hplocShaderVariant === 'wave32' || this._hplocShaderVariant === 'wave64';
		const initialWorkgroupCount = useIndirectDispatch ? Math.ceil( primCount / this._hplocWorkgroupSize ) : 0;
		offsets.initCounters = offset;
		new Uint32Array( uniformData, offset, 4 ).set( [ primCount, initialWorkgroupCount, 0, 0 ] );
		offset += ALIGN;

		device.queue.writeBuffer( this._buildBuffers.uniforms, 0, uniformData );

		// Record all passes
		const commandEncoder = device.createCommandEncoder();

		this._recordSetupPass( commandEncoder, primCount, offsets );
		this._recordRadixSortPass( commandEncoder, primCount, offsets );
		this._runHPLOCPassSync( commandEncoder, primCount, offsets );

		if ( useFlatten ) {

			this._runFlattenPass( commandEncoder, primCount );

		}

		// Submit without waiting - no readback needed
		device.queue.submit( [ commandEncoder.finish() ] );
		// Queue ordering guarantees this completes before any subsequent commands
		this._refitParentsDirty = true;

	}

	/**
	 * DEBUG: Run the H-PLOC indirect dispatch debug version.
	 * Call this after build() to diagnose indirect dispatch issues.
	 * Logs detailed state information to console.
	 */
	async debugIndirectDispatch() {

		if ( this._hplocShaderVariant !== 'wave32' && this._hplocShaderVariant !== 'wave64' ) {

			console.warn( 'debugIndirectDispatch: only available for wave32/wave64 variants' );
			return;

		}

		const primCount = this._primCount;
		const workgroupSize = 256;
		const workgroupCount = Math.ceil( primCount / workgroupSize );

		// Setup uniforms
		const ALIGN = 256;
		const uniformData = new ArrayBuffer( 2 * ALIGN );
		new Uint32Array( uniformData, 0, 4 ).set( [ primCount, workgroupCount, this._positionStride, 0 ] );
		new Uint32Array( uniformData, ALIGN, 4 ).set( [ primCount, 0, 0, 0 ] );
		this.device.queue.writeBuffer( this._buildBuffers.uniforms, 0, uniformData );

		// Re-initialize buffers for H-PLOC
		// Reset parentIdx to INVALID
		const initParent = new Uint32Array( primCount );
		initParent.fill( 0xFFFFFFFF );
		this.device.queue.writeBuffer( this._buildBuffers.parentIdx, 0, initParent );

		// Re-initialize clusterIdx to [0, 1, 2, ..., primCount-1]
		// This is crucial - after the previous build, clusterIdx contains INVALID_IDX for merged clusters
		const initCluster = new Uint32Array( primCount );
		for ( let i = 0; i < primCount; i ++ ) {

			initCluster[ i ] = i;

		}

		this.device.queue.writeBuffer( this._buildBuffers.clusterIdx, 0, initCluster );

		// Re-initialize state (left=i, right=i, split=i, active=1)
		const initState = new Uint32Array( primCount * 4 );
		for ( let i = 0; i < primCount; i ++ ) {

			initState[ i * 4 + 0 ] = i;
			initState[ i * 4 + 1 ] = i;
			initState[ i * 4 + 2 ] = i;
			initState[ i * 4 + 3 ] = 1;

		}

		this.device.queue.writeBuffer( this._buildBuffers.hplocState, 0, initState );

		// Reset node counter
		this.device.queue.writeBuffer( this._buildBuffers.nodeCounter, 0, new Uint32Array( [ primCount ] ) );

		console.log( '=== DEBUG: Running H-PLOC Indirect Dispatch ===' );
		await this._debugRunHPLOCPassIndirect( primCount, ALIGN );
		console.log( '=== DEBUG: Done ===' );
		this._refitParentsDirty = true;

	}

	/**
	 * Trace indirect H-PLOC active list decay per iteration.
	 * This replays only the H-PLOC phase using existing morton codes / leaf bounds
	 * from the most recent build and returns active primitive counts per iteration.
	 *
	 * NOTE: This method mutates H-PLOC build-state buffers (cluster/state/parent/counters).
	 * Call this only for profiling/analysis, not between dependent traversal operations.
	 */
	async traceIndirectActiveCounts() {

		if ( ! this._buildBuffers || ! this._pipelines || ! this._primCount ) {

			throw new Error( 'traceIndirectActiveCounts requires a completed build with primCount > 0.' );

		}

		const device = this.device;
		const primCount = this._primCount;
		const workgroupSize = this._hplocWorkgroupSize;
		const initialWorkgroupCount = Math.ceil( primCount / workgroupSize );
		const maxIterations = this._getHPLOCMaxIterations( primCount );

		// H-PLOC shader only needs primCount at binding(0) uniforms.
		device.queue.writeBuffer( this._buildBuffers.uniforms, 0, new Uint32Array( [ primCount, 0, 0, 0 ] ) );

		// Re-initialize per-primitive state for a clean H-PLOC replay.
		const initParent = new Uint32Array( primCount );
		initParent.fill( 0xFFFFFFFF );
		device.queue.writeBuffer( this._buildBuffers.parentIdx, 0, initParent );

		const initCluster = new Uint32Array( primCount );
		const initState = new Uint32Array( primCount * 4 );
		for ( let i = 0; i < primCount; i ++ ) {

			initCluster[ i ] = i;
			initState[ i * 4 + 0 ] = i;
			initState[ i * 4 + 1 ] = i;
			initState[ i * 4 + 2 ] = i;
			initState[ i * 4 + 3 ] = 1;

		}

		device.queue.writeBuffer( this._buildBuffers.clusterIdx, 0, initCluster );
		device.queue.writeBuffer( this._buildBuffers.hplocState, 0, initState );
		device.queue.writeBuffer( this._buildBuffers.nodeCounter, 0, new Uint32Array( [ primCount ] ) );

		// activeList0 is mutated during normal indirect execution; reinitialize to identity.
		{

			const workgroupCount = Math.ceil( primCount / 256 );
			const enc = device.createCommandEncoder();
			const passEncoder = enc.beginComputePass();
			const bindGroup = device.createBindGroup( {
				layout: this._pipelines.initActiveList.getBindGroupLayout( 0 ),
				entries: [
					{ binding: 0, resource: { buffer: this._buildBuffers.uniforms, offset: 0, size: 16 } },
					{ binding: 1, resource: { buffer: this._buildBuffers.activeList0 } },
				],
			} );
			passEncoder.setPipeline( this._pipelines.initActiveList );
			passEncoder.setBindGroup( 0, bindGroup );
			passEncoder.dispatchWorkgroups( workgroupCount );
			passEncoder.end();
			device.queue.submit( [ enc.finish() ] );
			await device.queue.onSubmittedWorkDone();

		}

		// Initialize ping-pong counters and indirect dispatch args.
		device.queue.writeBuffer( this._buildBuffers.activeCount0, 0, new Uint32Array( [ primCount ] ) );
		device.queue.writeBuffer( this._buildBuffers.activeCount1, 0, new Uint32Array( [ 0 ] ) );
		device.queue.writeBuffer( this._buildBuffers.indirectDispatch, 0, new Uint32Array( [ initialWorkgroupCount, 1, 1 ] ) );

		const countReadback = device.createBuffer( {
			size: 8, // activeCount0 + activeCount1
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		} );

		const readCounts = async () => {

			const enc = device.createCommandEncoder();
			enc.copyBufferToBuffer( this._buildBuffers.activeCount0, 0, countReadback, 0, 4 );
			enc.copyBufferToBuffer( this._buildBuffers.activeCount1, 0, countReadback, 4, 4 );
			device.queue.submit( [ enc.finish() ] );
			await device.queue.onSubmittedWorkDone();
			await countReadback.mapAsync( GPUMapMode.READ );
			const data = new Uint32Array( countReadback.getMappedRange() );
			const count0 = data[ 0 ];
			const count1 = data[ 1 ];
			countReadback.unmap();
			return [ count0, count1 ];

		};

		const createIndirectBindGroup = ( listIn, listOut, countIn, countOut ) => {

			return device.createBindGroup( {
				layout: this._pipelines.hplocIndirect.getBindGroupLayout( 0 ),
				entries: [
					{ binding: 0, resource: { buffer: this._buildBuffers.uniforms, offset: 0, size: 16 } },
					{ binding: 1, resource: { buffer: this._buildBuffers.mortonCodes } },
					{ binding: 2, resource: { buffer: this._buildBuffers.clusterIdx } },
					{ binding: 3, resource: { buffer: this._buildBuffers.parentIdx } },
					{ binding: 4, resource: { buffer: this._buildBuffers.bvh2Nodes } },
					{ binding: 5, resource: { buffer: this._buildBuffers.nodeCounter } },
					{ binding: 6, resource: { buffer: this._buildBuffers.hplocState } },
					{ binding: 7, resource: { buffer: listIn } },
					{ binding: 8, resource: { buffer: listOut } },
					{ binding: 9, resource: { buffer: countOut } },
					{ binding: 10, resource: { buffer: countIn } },
				],
			} );

		};

		const createUpdateDispatchBindGroup = ( countIn, countOut ) => {

			return device.createBindGroup( {
				layout: this._pipelines.updateDispatch.getBindGroupLayout( 0 ),
				entries: [
					{ binding: 0, resource: { buffer: countIn } },
					{ binding: 1, resource: { buffer: this._buildBuffers.indirectDispatch } },
					{ binding: 2, resource: { buffer: countOut } },
				],
			} );

		};

		const hplocBG_0to1 = createIndirectBindGroup(
			this._buildBuffers.activeList0, this._buildBuffers.activeList1,
			this._buildBuffers.activeCount0, this._buildBuffers.activeCount1
		);
		const hplocBG_1to0 = createIndirectBindGroup(
			this._buildBuffers.activeList1, this._buildBuffers.activeList0,
			this._buildBuffers.activeCount1, this._buildBuffers.activeCount0
		);
		const updateBG_1to0 = createUpdateDispatchBindGroup(
			this._buildBuffers.activeCount1, this._buildBuffers.activeCount0
		);
		const updateBG_0to1 = createUpdateDispatchBindGroup(
			this._buildBuffers.activeCount0, this._buildBuffers.activeCount1
		);

		const activeCounts = [ primCount ];
		const dispatchWorkgroups = [ initialWorkgroupCount ];

		// Iteration 0 uses direct dispatch from activeList0 -> activeList1.
		{

			const enc = device.createCommandEncoder();
			const passEncoder = enc.beginComputePass();
			passEncoder.setPipeline( this._pipelines.hplocIndirect );
			passEncoder.setBindGroup( 0, hplocBG_0to1 );
			passEncoder.dispatchWorkgroups( initialWorkgroupCount );
			passEncoder.end();
			device.queue.submit( [ enc.finish() ] );
			await device.queue.onSubmittedWorkDone();

		}

		let counts = await readCounts();
		let nextInputCount = counts[ 1 ]; // Iteration 1 reads activeCount1.

		for ( let iter = 1; iter < maxIterations && nextInputCount > 0; iter ++ ) {

			activeCounts.push( nextInputCount );
			dispatchWorkgroups.push( Math.ceil( nextInputCount / workgroupSize ) );

			const useList1AsInput = ( iter % 2 === 1 );

			const enc = device.createCommandEncoder();
			const passEncoder = enc.beginComputePass();
			passEncoder.setPipeline( this._pipelines.updateDispatch );
			passEncoder.setBindGroup( 0, useList1AsInput ? updateBG_1to0 : updateBG_0to1 );
			passEncoder.dispatchWorkgroups( 1 );
			passEncoder.setPipeline( this._pipelines.hplocIndirect );
			passEncoder.setBindGroup( 0, useList1AsInput ? hplocBG_1to0 : hplocBG_0to1 );
			passEncoder.dispatchWorkgroupsIndirect( this._buildBuffers.indirectDispatch, 0 );
			passEncoder.end();
			device.queue.submit( [ enc.finish() ] );
			await device.queue.onSubmittedWorkDone();

			counts = await readCounts();
			nextInputCount = useList1AsInput ? counts[ 0 ] : counts[ 1 ];

		}

		countReadback.destroy();
		this._refitParentsDirty = true;

		const estimatedAppendAtomicsOld = activeCounts.reduce( ( sum, v ) => sum + v, 0 );
		const estimatedAppendAtomicsNew = dispatchWorkgroups.reduce( ( sum, v ) => sum + v, 0 );
		const estimatedReductionFactor = estimatedAppendAtomicsNew > 0
			? estimatedAppendAtomicsOld / estimatedAppendAtomicsNew
			: 0;
		const estimatedReductionPct = estimatedAppendAtomicsOld > 0
			? ( 1 - estimatedAppendAtomicsNew / estimatedAppendAtomicsOld ) * 100
			: 0;

		return {
			workgroupSize,
			maxIterations,
			nonZeroIterations: activeCounts.length,
			activeCounts,
			dispatchWorkgroups,
			estimatedAppendAtomicsOld,
			estimatedAppendAtomicsNew,
			estimatedReductionFactor,
			estimatedReductionPct,
		};

	}

	/**
	 * Trace refit active-list propagation with per-wave readback.
	 * Useful for diagnosing whether refit cost is dominated by leaves or internal waves.
	 *
	 * NOTE: Like traceIndirectActiveCounts(), this is a profiling helper and introduces
	 * substantial synchronization overhead due to per-iteration readbacks.
	 */
	async traceRefitActiveCounts( options = {} ) {

		const { useFlatten = false } = options;
		if ( ! this._buildBuffers || ! this._pipelines || ! this._primCount ) {

			throw new Error( 'traceRefitActiveCounts requires a completed build with primCount > 0.' );

		}

		if ( this._refitParentsDirty ) {

			await this._buildRefitParentMap( true );

		}

		const device = this.device;
		const primCount = this._primCount;
		const workgroupSize = 256;
		const leafWorkgroupCount = Math.ceil( primCount / workgroupSize );
		const maxIterations = this._getRefitMaxIterations( primCount );

		// Refit uniforms: primCount + position stride.
		device.queue.writeBuffer( this._buildBuffers.uniforms, 0, new Uint32Array( [ primCount, this._positionStride, 0, 0 ] ) );

		const maxNodesUsed = Math.max( 1, 2 * primCount );
		{

			const clearEncoder = device.createCommandEncoder();
			clearEncoder.clearBuffer( this._buildBuffers.refitVisitCount, 0, maxNodesUsed * 4 );
			clearEncoder.clearBuffer( this._buildBuffers.activeCount0 );
			clearEncoder.clearBuffer( this._buildBuffers.activeCount1 );
			device.queue.submit( [ clearEncoder.finish() ] );
			await device.queue.onSubmittedWorkDone();

		}

		const bg = this._getOrCreateRefitBindGroups();

		const countReadback = device.createBuffer( {
			size: 8, // activeCount0 + activeCount1
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		} );

		const readCounts = async () => {

			const readEncoder = device.createCommandEncoder();
			readEncoder.copyBufferToBuffer( this._buildBuffers.activeCount0, 0, countReadback, 0, 4 );
			readEncoder.copyBufferToBuffer( this._buildBuffers.activeCount1, 0, countReadback, 4, 4 );
			device.queue.submit( [ readEncoder.finish() ] );
			await device.queue.onSubmittedWorkDone();
			await countReadback.mapAsync( GPUMapMode.READ );
			const data = new Uint32Array( countReadback.getMappedRange() );
			const result = [ data[ 0 ], data[ 1 ] ];
			countReadback.unmap();
			return result;

		};

		// Pass 1: leaves update and initial parent enqueue.
		const tLeaves = performance.now();
		{

			const leafEncoder = device.createCommandEncoder();
			const passEncoder = leafEncoder.beginComputePass();
			passEncoder.setPipeline( this._pipelines.refitLeaves );
			passEncoder.setBindGroup( 0, bg.leaves );
			passEncoder.dispatchWorkgroups( leafWorkgroupCount );
			passEncoder.end();
			device.queue.submit( [ leafEncoder.finish() ] );
			await device.queue.onSubmittedWorkDone();

		}

		const leavesTimeMs = performance.now() - tLeaves;

		let counts = await readCounts();
		let inputCount = counts[ 0 ]; // Leaves always seed activeCount0.

		const activeCounts = [];
		const dispatchWorkgroups = [];
		const waveTimesMs = [];

		for ( let iter = 0; iter < maxIterations && inputCount > 0; iter ++ ) {

			activeCounts.push( inputCount );
			dispatchWorkgroups.push( Math.ceil( inputCount / workgroupSize ) );

			const use0to1 = ( iter % 2 === 0 );
			const tWave = performance.now();

			const waveEncoder = device.createCommandEncoder();
			const passEncoder = waveEncoder.beginComputePass();
			passEncoder.setPipeline( this._pipelines.updateDispatch );
			passEncoder.setBindGroup( 0, use0to1 ? bg.update_0to1 : bg.update_1to0 );
			passEncoder.dispatchWorkgroups( 1 );
			passEncoder.setPipeline( this._pipelines.refitInternal );
			passEncoder.setBindGroup( 0, use0to1 ? bg.internal_0to1 : bg.internal_1to0 );
			passEncoder.dispatchWorkgroupsIndirect( this._buildBuffers.indirectDispatch, 0 );
			passEncoder.end();
			device.queue.submit( [ waveEncoder.finish() ] );
			await device.queue.onSubmittedWorkDone();

			waveTimesMs.push( performance.now() - tWave );

			counts = await readCounts();
			inputCount = use0to1 ? counts[ 1 ] : counts[ 0 ];

		}

		if ( useFlatten ) {

			const flattenEncoder = device.createCommandEncoder();
			this._runFlattenPass( flattenEncoder, primCount );
			device.queue.submit( [ flattenEncoder.finish() ] );
			await device.queue.onSubmittedWorkDone();

		}

		countReadback.destroy();

		const totalWaveTimeMs = waveTimesMs.reduce( ( sum, v ) => sum + v, 0 );
		const estimatedInternalNodeVisits = activeCounts.reduce( ( sum, v ) => sum + v, 0 );
		const totalInternalWorkgroups = dispatchWorkgroups.reduce( ( sum, v ) => sum + v, 0 );

		return {
			workgroupSize,
			leafWorkgroupCount,
			maxIterations,
			nonZeroIterations: activeCounts.length,
			activeCounts,
			dispatchWorkgroups,
			waveTimesMs,
			leavesTimeMs,
			totalWaveTimeMs,
			updateDispatchCalls: waveTimesMs.length,
			estimatedInternalNodeVisits,
			totalInternalWorkgroups,
		};

	}

	/**
	 * Single-submission build - all passes recorded to one command encoder
	 * This is the optimized path with minimal CPU/driver overhead
	 */
	async _buildSingleSubmit( primCount, useFlatten ) {

		const device = this.device;
		const workgroupSize = 256;
		const workgroupCount = Math.ceil( primCount / workgroupSize );

		// Pre-allocate uniform data (256-byte aligned offsets for WebGPU)
		// Layout: [setup, morton, sort0, sort1, sort2, sort3, hploc, initCounters]
		// Atomic scene bounds eliminates reduction passes
		const ALIGN = 256;
		const uniformCount = 1 + 1 + 4 + 1 + 1; // setup + morton + 4 sort + hploc + initCounters
		const uniformData = new ArrayBuffer( uniformCount * ALIGN );

		let offset = 0;
		const offsets = {};

		// Setup uniforms
		offsets.setup = offset;
		new Uint32Array( uniformData, offset, 4 ).set( [ primCount, workgroupCount, this._positionStride, 0 ] );
		offset += ALIGN;

		// Morton uniforms (same as setup)
		offsets.morton = offset;
		new Uint32Array( uniformData, offset, 4 ).set( [ primCount, workgroupCount, 0, 0 ] );
		offset += ALIGN;

		// Radix sort uniforms (4 passes with different bit offsets)
		offsets.sort = [];
		const sortWorkgroupCount = Math.ceil( primCount / 256 );
		for ( let i = 0; i < 4; i ++ ) {

			offsets.sort.push( offset );
			new Uint32Array( uniformData, offset, 4 ).set( [ primCount, i * 8, sortWorkgroupCount, 0 ] );
			offset += ALIGN;

		}

		// H-PLOC uniforms
		offsets.hploc = offset;
		new Uint32Array( uniformData, offset, 4 ).set( [ primCount, 0, 0, 0 ] );
		offset += ALIGN;

		// InitCounters uniforms (for GPU-based counter initialization in indirect dispatch)
		const useIndirectDispatch = this._hplocShaderVariant === 'wave32' || this._hplocShaderVariant === 'wave64';
		const initialWorkgroupCount = useIndirectDispatch ? Math.ceil( primCount / this._hplocWorkgroupSize ) : 0;
		offsets.initCounters = offset;
		new Uint32Array( uniformData, offset, 4 ).set( [ primCount, initialWorkgroupCount, 0, 0 ] );
		offset += ALIGN;

		// Upload all uniforms at once
		device.queue.writeBuffer( this._buildBuffers.uniforms, 0, uniformData );

		// Record all passes to single command encoder
		const commandEncoder = device.createCommandEncoder();

		// === SETUP PHASE ===
		this._recordSetupPass( commandEncoder, primCount, offsets );

		// === RADIX SORT PHASE ===
		this._recordRadixSortPass( commandEncoder, primCount, offsets );

		// === H-PLOC PHASE ===
		const hplocIterations = this._runHPLOCPassSync( commandEncoder, primCount, offsets );

		// === FLATTEN PHASE (optional) ===
		if ( useFlatten ) {

			this._runFlattenPass( commandEncoder, primCount );

		}

		// === READBACK ===
		commandEncoder.copyBufferToBuffer(
			this._buildBuffers.nodeCounter, 0,
			this._buildBuffers.readback, 0, 4
		);
		commandEncoder.copyBufferToBuffer(
			this._buildBuffers.clusterIdx, 0,
			this._buildBuffers.readback, 4, 4
		);

		// Single submit!
		device.queue.submit( [ commandEncoder.finish() ] );
		await device.queue.onSubmittedWorkDone();

		// Read results
		await this._buildBuffers.readback.mapAsync( GPUMapMode.READ );
		const data = new Uint32Array( this._buildBuffers.readback.getMappedRange() );
		this._nodeCount = Math.min( data[ 0 ], 2 * primCount );
		this._rootIndex = data[ 1 ];
		this._buildBuffers.readback.unmap();

		this._passTimings = { hplocIterations };

	}

	/**
	 * Single-submission build with GPU timestamp queries for accurate per-phase timing
	 * No multi-submit overhead - timestamps are resolved after all work completes
	 */
	async _buildSingleSubmitWithTimestamps( primCount, useFlatten ) {

		const device = this.device;
		const workgroupSize = 256;
		const workgroupCount = Math.ceil( primCount / workgroupSize );

		// Pre-allocate uniform data (same as _buildSingleSubmit)
		const ALIGN = 256;
		const uniformCount = 1 + 1 + 4 + 1 + 1; // setup + morton + 4 sort + hploc + initCounters
		const uniformData = new ArrayBuffer( uniformCount * ALIGN );

		let offset = 0;
		const offsets = {};

		offsets.setup = offset;
		new Uint32Array( uniformData, offset, 4 ).set( [ primCount, workgroupCount, this._positionStride, 0 ] );
		offset += ALIGN;

		offsets.morton = offset;
		new Uint32Array( uniformData, offset, 4 ).set( [ primCount, workgroupCount, 0, 0 ] );
		offset += ALIGN;

		offsets.sort = [];
		const sortWorkgroupCount = Math.ceil( primCount / 256 );
		for ( let i = 0; i < 4; i ++ ) {

			offsets.sort.push( offset );
			new Uint32Array( uniformData, offset, 4 ).set( [ primCount, i * 8, sortWorkgroupCount, 0 ] );
			offset += ALIGN;

		}

		offsets.hploc = offset;
		new Uint32Array( uniformData, offset, 4 ).set( [ primCount, 0, 0, 0 ] );
		offset += ALIGN;

		const initialWorkgroupCount = Math.ceil( primCount / this._hplocWorkgroupSize );

		// Add uniforms for initIndirectCounters shader
		offsets.initCounters = offset;
		new Uint32Array( uniformData, offset, 4 ).set( [ primCount, initialWorkgroupCount, 0, 0 ] );
		offset += ALIGN;

		device.queue.writeBuffer( this._buildBuffers.uniforms, 0, uniformData );
		// Note: No await needed - WebGPU guarantees ordering between writeBuffer and command submission

		const ts = this._timestampBuffers;

		// Push error scopes BEFORE creating command encoder to catch encoding errors
		// (validation errors during encoding would otherwise escape)
		device.pushErrorScope( 'validation' );
		device.pushErrorScope( 'out-of-memory' );

		const commandEncoder = device.createCommandEncoder();

		// Timestamp indices - each (querySet, queryIndex) pair can only be used ONCE per command buffer
		// Layout: [0]=setup start, [1]=setup end, [2]=sort start (builtin only), [3]=sort end (builtin only),
		//         [4]=hploc start, [5]=hploc end
		let tsIdx = 0;

		// === SETUP PHASE (with timestamps) ===
		// Pass 1: Bounds + init (start timestamp)
		{

			const passEncoder = commandEncoder.beginComputePass( {
				timestampWrites: {
					querySet: ts.querySet,
					beginningOfPassWriteIndex: tsIdx ++,
				},
			} );
			const bindGroup = device.createBindGroup( {
				layout: this._pipelines.setupBounds.getBindGroupLayout( 0 ),
				entries: [
					{ binding: 0, resource: { buffer: this._buildBuffers.uniforms, offset: offsets.setup, size: 16 } },
					{ binding: 1, resource: { buffer: this._positionBuffer } },
					{ binding: 2, resource: { buffer: this._indexBuffer } },
					{ binding: 3, resource: { buffer: this._buildBuffers.bvh2Nodes } },
					{ binding: 4, resource: { buffer: this._buildBuffers.clusterIdx } },
					{ binding: 5, resource: { buffer: this._buildBuffers.sceneBounds } },
					{ binding: 6, resource: { buffer: this._buildBuffers.parentIdx } },
					{ binding: 7, resource: { buffer: this._buildBuffers.hplocState } },
					{ binding: 8, resource: { buffer: this._buildBuffers.activeList0 } },
				],
			} );
			passEncoder.setPipeline( this._pipelines.setupBounds );
			passEncoder.setBindGroup( 0, bindGroup );
			passEncoder.dispatchWorkgroups( workgroupCount );
			passEncoder.end();

		}

		// Pass 2: Morton codes (end of setup phase - end timestamp)
		{

			const passEncoder = commandEncoder.beginComputePass( {
				timestampWrites: {
					querySet: ts.querySet,
					endOfPassWriteIndex: tsIdx ++,
				},
			} );
			const bindGroup = device.createBindGroup( {
				layout: this._pipelines.setupMorton.getBindGroupLayout( 0 ),
				entries: [
					{ binding: 0, resource: { buffer: this._buildBuffers.uniforms, offset: offsets.morton, size: 16 } },
					{ binding: 1, resource: { buffer: this._buildBuffers.bvh2Nodes } },
					{ binding: 2, resource: { buffer: this._buildBuffers.sceneBounds } },
					{ binding: 3, resource: { buffer: this._buildBuffers.mortonCodes } },
				],
			} );
			passEncoder.setPipeline( this._pipelines.setupMorton );
			passEncoder.setBindGroup( 0, bindGroup );
			passEncoder.dispatchWorkgroups( workgroupCount );
			passEncoder.end();

		}

		// === RADIX SORT PHASE ===
		// Note: For external sorters, we can't easily inject timestamps into their internal passes.
		// Sort time will be computed as the gap between setup end and H-PLOC start.
		const usingExternalSorter = this._sorterType !== SorterType.BUILTIN && this._sorter;

		// Track sort timestamp indices (only used for built-in sort)
		let sortStartIdx = - 1;
		let sortEndIdx = - 1;

		// Use external sorter if configured (OneSweep)
		if ( usingExternalSorter ) {

			// External sorter records its passes to the command encoder
			// Note: OneSweep does 4-pass ping-pong, so output ends up back in keysIn/valsIn
			this._sorter.sort( {
				commandEncoder,
				keysIn: this._buildBuffers.mortonCodes,
				keysOut: this._buildBuffers.mortonCodesAlt,
				valsIn: this._buildBuffers.clusterIdx,
				valsOut: this._buildBuffers.clusterIdxAlt,
				count: primCount,
			} );

		} else {

			// Built-in radix sort: stable sort for LSD radix (with timestamps)
			sortStartIdx = tsIdx ++;
			sortEndIdx = tsIdx ++;

			// Clear intermediate buffers to ensure clean state (prevents undefined initial contents)
			commandEncoder.clearBuffer( this._buildBuffers.groupCounts );
			commandEncoder.clearBuffer( this._buildBuffers.groupPrefix );
			commandEncoder.clearBuffer( this._buildBuffers.digitOffsets );

			let keysIn = this._buildBuffers.mortonCodes;
			let keysOut = this._buildBuffers.mortonCodesAlt;
			let valsIn = this._buildBuffers.clusterIdx;
			let valsOut = this._buildBuffers.clusterIdxAlt;

			for ( let pass = 0; pass < 4; pass ++ ) {

				const uniformOffset = offsets.sort[ pass ];
				const isFirst = ( pass === 0 );
				const isLast = ( pass === 3 );

				// Clear globalDigitCount before each radix pass
				commandEncoder.clearBuffer( this._buildBuffers.globalDigitCount );

				// Histogram: count digits per workgroup
				{

					const passOptions = isFirst ? {
						timestampWrites: { querySet: ts.querySet, beginningOfPassWriteIndex: sortStartIdx },
					} : {};
					const passEncoder = commandEncoder.beginComputePass( passOptions );
					const bindGroup = device.createBindGroup( {
						layout: this._pipelines.radixHistogram.getBindGroupLayout( 0 ),
						entries: [
							{ binding: 0, resource: { buffer: this._buildBuffers.uniforms, offset: uniformOffset, size: 16 } },
							{ binding: 1, resource: { buffer: keysIn } },
							{ binding: 2, resource: { buffer: this._buildBuffers.groupCounts } },
							{ binding: 3, resource: { buffer: this._buildBuffers.globalDigitCount } },
						],
					} );
					passEncoder.setPipeline( this._pipelines.radixHistogram );
					passEncoder.setBindGroup( 0, bindGroup );
					passEncoder.dispatchWorkgroups( sortWorkgroupCount );
					passEncoder.end();

				}

				// Workgroup scan: compute exclusive prefix sum across workgroups
				{

					const passEncoder = commandEncoder.beginComputePass();
					const bindGroup = device.createBindGroup( {
						layout: this._pipelines.radixWorkgroupScan.getBindGroupLayout( 0 ),
						entries: [
							{ binding: 0, resource: { buffer: this._buildBuffers.uniforms, offset: uniformOffset, size: 16 } },
							{ binding: 1, resource: { buffer: this._buildBuffers.groupCounts } },
							{ binding: 2, resource: { buffer: this._buildBuffers.groupPrefix } },
						],
					} );
					passEncoder.setPipeline( this._pipelines.radixWorkgroupScan );
					passEncoder.setBindGroup( 0, bindGroup );
					passEncoder.dispatchWorkgroups( 1 );
					passEncoder.end();

				}

				// Digit scan: compute digit base offsets
				{

					const passEncoder = commandEncoder.beginComputePass();
					const bindGroup = device.createBindGroup( {
						layout: this._pipelines.radixScan.getBindGroupLayout( 0 ),
						entries: [
							{ binding: 1, resource: { buffer: this._buildBuffers.globalDigitCount } },
							{ binding: 2, resource: { buffer: this._buildBuffers.digitOffsets } },
						],
					} );
					passEncoder.setPipeline( this._pipelines.radixScan );
					passEncoder.setBindGroup( 0, bindGroup );
					passEncoder.dispatchWorkgroups( 1 );
					passEncoder.end();

				}

				// Scatter: reorder keys and values
				{

					const passOptions = isLast ? {
						timestampWrites: { querySet: ts.querySet, endOfPassWriteIndex: sortEndIdx },
					} : {};
					const passEncoder = commandEncoder.beginComputePass( passOptions );
					const bindGroup = device.createBindGroup( {
						layout: this._pipelines.radixScatter.getBindGroupLayout( 0 ),
						entries: [
							{ binding: 0, resource: { buffer: this._buildBuffers.uniforms, offset: uniformOffset, size: 16 } },
							{ binding: 1, resource: { buffer: keysIn } },
							{ binding: 2, resource: { buffer: keysOut } },
							{ binding: 3, resource: { buffer: valsIn } },
							{ binding: 4, resource: { buffer: valsOut } },
							{ binding: 5, resource: { buffer: this._buildBuffers.groupPrefix } },
							{ binding: 6, resource: { buffer: this._buildBuffers.digitOffsets } },
						],
					} );
					passEncoder.setPipeline( this._pipelines.radixScatter );
					passEncoder.setBindGroup( 0, bindGroup );
					passEncoder.dispatchWorkgroups( sortWorkgroupCount );
					passEncoder.end();

				}

				[ keysIn, keysOut ] = [ keysOut, keysIn ];
				[ valsIn, valsOut ] = [ valsOut, valsIn ];

			}

		}

		// === H-PLOC PHASE (with timestamps) ===
		const hplocStartIdx = tsIdx ++;
		const hplocEndIdx = tsIdx ++;

		const hplocIterations = this._runHPLOCPassSync(
			commandEncoder,
			primCount,
			offsets,
			{
				querySet: ts.querySet,
				startIndex: hplocStartIdx,
				endIndex: hplocEndIdx,
			}
		);

		// === FLATTEN PHASE (optional, with timestamps) ===
		if ( useFlatten ) {

			this._runFlattenPass( commandEncoder, primCount );

		}

		// === READBACK ===
		commandEncoder.copyBufferToBuffer(
			this._buildBuffers.nodeCounter, 0,
			this._buildBuffers.readback, 0, 4
		);
		commandEncoder.copyBufferToBuffer(
			this._buildBuffers.clusterIdx, 0,
			this._buildBuffers.readback, 4, 4
		);

		// Resolve timestamps
		commandEncoder.resolveQuerySet( ts.querySet, 0, tsIdx, ts.resolveBuffer, 0 );
		commandEncoder.copyBufferToBuffer( ts.resolveBuffer, 0, ts.readbackBuffer, 0, tsIdx * 8 );

		// Single submit!
		const commandBuffer = commandEncoder.finish();
		device.queue.submit( [ commandBuffer ] );

		// Check for encoding/submission errors (error scopes were pushed before command encoder creation)
		const tErrorScopes = performance.now();
		const oomError = await device.popErrorScope();
		const validationError = await device.popErrorScope();
		const errorScopeTime = performance.now() - tErrorScopes;

		if ( oomError ) {

			console.error( 'GPUMeshBVH: Out-of-memory error:', oomError.message );

		}

		if ( validationError ) {

			console.error( 'GPUMeshBVH: Validation error:', validationError.message );

		}

		const tQueueWait = performance.now();
		await device.queue.onSubmittedWorkDone();
		const queueWaitTime = performance.now() - tQueueWait;

		// Read build results
		const tNodeReadback = performance.now();
		await this._buildBuffers.readback.mapAsync( GPUMapMode.READ );
		const data = new Uint32Array( this._buildBuffers.readback.getMappedRange() );
		this._nodeCount = Math.min( data[ 0 ], 2 * primCount );
		this._rootIndex = data[ 1 ];
		this._buildBuffers.readback.unmap();
		const nodeReadbackTime = performance.now() - tNodeReadback;

		// Read timestamps (BigUint64Array for unsigned nanosecond values)
		const tTimestampReadback = performance.now();
		await ts.readbackBuffer.mapAsync( GPUMapMode.READ );
		const timestamps = new BigUint64Array( ts.readbackBuffer.getMappedRange() );

		// Convert BigInt nanoseconds to milliseconds (as Number)
		const toMs = ( start, end ) => {

			// Guard against invalid timestamps (device may reset timestamp counter)
			if ( start === 0n || end === 0n ) {

				console.warn( 'GPU timestamp invalid: zero value detected', { start, end } );
				return 0;

			}

			// Ensure end >= start (sanity check for timestamp validity)
			if ( end < start ) {

				console.warn( 'GPU timestamp anomaly: end < start', { start, end } );
				return 0;

			}

			return Number( end - start ) / 1000000;

		};

		const setupTime = toMs( timestamps[ 0 ], timestamps[ 1 ] );
		const hplocTime = toMs( timestamps[ hplocStartIdx ], timestamps[ hplocEndIdx ] );

		// Sort time: for external sorters, compute as gap between setup end and H-PLOC start
		// For built-in sort, we have explicit timestamps
		let sortTime;
		if ( usingExternalSorter ) {

			// Sort time is the gap from setup end to H-PLOC start
			sortTime = toMs( timestamps[ 1 ], timestamps[ hplocStartIdx ] );

		} else {

			// Built-in sort has explicit start/end timestamps
			sortTime = toMs( timestamps[ sortStartIdx ], timestamps[ sortEndIdx ] );

		}

		ts.readbackBuffer.unmap();
		const timestampReadbackTime = performance.now() - tTimestampReadback;

		this._passTimings = {
			setup: setupTime,
			sort: sortTime,
			hploc: hplocTime,
			hplocIterations,
			gpuTimestamps: true,
			hostErrorScopes: errorScopeTime,
			hostQueueWait: queueWaitTime,
			hostNodeReadback: nodeReadbackTime,
			hostTimestampReadback: timestampReadbackTime,
		};

	}

	/**
	 * Debug build with per-phase timing (adds await overhead)
	 * Fallback when timestamp-query feature is not available
	 */
	async _buildWithTiming( primCount, useFlatten ) {

		const device = this.device;
		const workgroupSize = 256;
		const workgroupCount = Math.ceil( primCount / workgroupSize );

		const timings = {
			setupBounds: 0,
			setupMorton: 0,
			setup: 0,
			sort: 0,
			hploc: 0,
			hplocIterations: 0,
			flatten: 0,
			readback: 0,
			syncOverhead: 0,
		};

		// Setup uniforms once
		const uniforms = new Uint32Array( [ primCount, workgroupCount, this._positionStride, 0 ] );
		device.queue.writeBuffer( this._buildBuffers.uniforms, 0, uniforms );

		// Phase 1a: Bounds computation + state initialization
		{

			const t0 = performance.now();

			const commandEncoder = device.createCommandEncoder();
			const passEncoder = commandEncoder.beginComputePass();
			const bindGroup = device.createBindGroup( {
				layout: this._pipelines.setupBounds.getBindGroupLayout( 0 ),
				entries: [
					{ binding: 0, resource: { buffer: this._buildBuffers.uniforms } },
					{ binding: 1, resource: { buffer: this._positionBuffer } },
					{ binding: 2, resource: { buffer: this._indexBuffer } },
					{ binding: 3, resource: { buffer: this._buildBuffers.bvh2Nodes } },
					{ binding: 4, resource: { buffer: this._buildBuffers.clusterIdx } },
					{ binding: 5, resource: { buffer: this._buildBuffers.sceneBounds } },
					{ binding: 6, resource: { buffer: this._buildBuffers.parentIdx } },
					{ binding: 7, resource: { buffer: this._buildBuffers.hplocState } },
					{ binding: 8, resource: { buffer: this._buildBuffers.activeList0 } },
				],
			} );
			passEncoder.setPipeline( this._pipelines.setupBounds );
			passEncoder.setBindGroup( 0, bindGroup );
			passEncoder.dispatchWorkgroups( workgroupCount );
			passEncoder.end();

			device.queue.submit( [ commandEncoder.finish() ] );
			await device.queue.onSubmittedWorkDone();
			timings.setupBounds = performance.now() - t0;

		}

		// Phase 1b: Morton codes
		{

			const t0 = performance.now();

			const commandEncoder = device.createCommandEncoder();
			const passEncoder = commandEncoder.beginComputePass();
			const bindGroup = device.createBindGroup( {
				layout: this._pipelines.setupMorton.getBindGroupLayout( 0 ),
				entries: [
					{ binding: 0, resource: { buffer: this._buildBuffers.uniforms } },
					{ binding: 1, resource: { buffer: this._buildBuffers.bvh2Nodes } },
					{ binding: 2, resource: { buffer: this._buildBuffers.sceneBounds } },
					{ binding: 3, resource: { buffer: this._buildBuffers.mortonCodes } },
				],
			} );
			passEncoder.setPipeline( this._pipelines.setupMorton );
			passEncoder.setBindGroup( 0, bindGroup );
			passEncoder.dispatchWorkgroups( workgroupCount );
			passEncoder.end();

			device.queue.submit( [ commandEncoder.finish() ] );
			await device.queue.onSubmittedWorkDone();
			timings.setupMorton = performance.now() - t0;

		}

		timings.setup = timings.setupBounds + timings.setupMorton;

		// Phase 2: Radix Sort
		{

			const t0 = performance.now();
			this._runRadixSortPass( null, primCount );
			await this.device.queue.onSubmittedWorkDone();
			timings.sort = performance.now() - t0;

		}

		// Phase 3: H-PLOC
		{

			const t0 = performance.now();
			const commandEncoder = this.device.createCommandEncoder();
			timings.hplocIterations = this._runHPLOCPassSync( commandEncoder, primCount );
			this.device.queue.submit( [ commandEncoder.finish() ] );
			await this.device.queue.onSubmittedWorkDone();
			timings.hploc = performance.now() - t0;

		}

		// Phase 4: Flatten (optional)
		if ( useFlatten ) {

			const t0 = performance.now();
			const commandEncoder = this.device.createCommandEncoder();
			this._runFlattenPass( commandEncoder, primCount );
			this.device.queue.submit( [ commandEncoder.finish() ] );
			await this.device.queue.onSubmittedWorkDone();
			timings.flatten = performance.now() - t0;

		}

		// Readback
		{

			const t0 = performance.now();

			const commandEncoder = this.device.createCommandEncoder();
			commandEncoder.copyBufferToBuffer(
				this._buildBuffers.nodeCounter, 0,
				this._buildBuffers.readback, 0, 4
			);
			commandEncoder.copyBufferToBuffer(
				this._buildBuffers.clusterIdx, 0,
				this._buildBuffers.readback, 4, 4
			);
			this.device.queue.submit( [ commandEncoder.finish() ] );
			await this.device.queue.onSubmittedWorkDone();

			await this._buildBuffers.readback.mapAsync( GPUMapMode.READ );
			const data = new Uint32Array( this._buildBuffers.readback.getMappedRange() );
			this._nodeCount = Math.min( data[ 0 ], 2 * primCount );
			this._rootIndex = data[ 1 ];
			this._buildBuffers.readback.unmap();

			timings.readback = performance.now() - t0;

		}

		this._passTimings = timings;

	}

	dispose() {

		if ( this._bvhBuffer ) {

			this._bvhBuffer.destroy();
			this._bvhBuffer = null;

		}

		if ( this._positionBuffer && ! this._externalPositionBuffer ) {

			this._positionBuffer.destroy();

		}

		this._positionBuffer = null;

		if ( this._indexBuffer && ! this._externalIndexBuffer ) {

			this._indexBuffer.destroy();

		}

		this._indexBuffer = null;

		if ( this._buildBuffers ) {

			for ( const key in this._buildBuffers ) {

				this._buildBuffers[ key ].destroy();

			}

			this._buildBuffers = null;

		}

		// Release cached bind groups (lightweight refs, no .destroy() needed)
		this._hplocBindGroups = null;
		this._setupBindGroups = null;
		this._sortBindGroups = null;
		this._refitBindGroups = null;
		this._hplocBindGroupsCacheKey = null;
		this._setupBindGroupsCacheKey = null;
		this._sortBindGroupsCacheKey = null;
		this._refitBindGroupsCacheKey = null;

		if ( this._timestampBuffers ) {

			this._timestampBuffers.querySet.destroy();
			this._timestampBuffers.resolveBuffer.destroy();
			this._timestampBuffers.readbackBuffer.destroy();
			this._timestampBuffers = null;

		}

		if ( this._sorter ) {

			this._sorter.dispose();
			this._sorter = null;

		}

	}

	// ---- Private methods ----

	_extractGeometryData( geometry ) {

		const positionAttr = geometry.getAttribute( 'position' );
		const indexAttr = geometry.getIndex();

		if ( ! positionAttr ) {

			throw new Error( 'GPUMeshBVH: geometry must have position attribute' );

		}

		let positions;
		let indices;
		let primCount;

		const vertexCount = positionAttr.count;

		// Zero-copy: use raw Float32Array directly if possible (no vec4 padding)
		if ( positionAttr.isInterleavedBufferAttribute ) {

			// Interleaved - must copy to packed array
			positions = new Float32Array( vertexCount * 3 );
			for ( let i = 0; i < vertexCount; i ++ ) {

				const dstBase = i * 3;
				positions[ dstBase ] = positionAttr.getX( i );
				positions[ dstBase + 1 ] = positionAttr.getY( i );
				positions[ dstBase + 2 ] = positionAttr.getZ( i );

			}

		} else {

			// Non-interleaved: use underlying array directly (zero-copy)
			positions = positionAttr.array;

		}

		if ( indexAttr ) {

			// Indexed geometry - use raw index array (convert Uint16 to Uint32 if needed)
			const srcIndices = indexAttr.array;
			primCount = Math.floor( srcIndices.length / 3 );

			if ( srcIndices instanceof Uint32Array ) {

				// Zero-copy: use directly
				indices = srcIndices;

			} else {

				// Convert Uint16Array to Uint32Array for WebGPU alignment
				indices = new Uint32Array( srcIndices );

			}

		} else {

			// Non-indexed geometry - generate sequential indices
			primCount = Math.floor( vertexCount / 3 );
			indices = new Uint32Array( primCount * 3 );

			for ( let i = 0; i < primCount * 3; i ++ ) {

				indices[ i ] = i;

			}

		}

		return { positions, indices, primCount };

	}

	_allocateBuffers( primCount ) {

		const device = this.device;
		const workgroupSize = 256;

		// Buffer reuse optimization: only reallocate if primCount exceeds current capacity
		// Use power-of-2 growth to minimize reallocations
		if ( this._buildBuffers && primCount <= this._bufferCapacity ) {

			// Reuse existing buffers - no allocation needed
			return;

		}

		// Calculate new capacity with growth factor (next power of 2, min 1024)
		const newCapacity = Math.max( 1024, this._nextPowerOf2( primCount ) );
		if ( this._verbose ) console.info( `GPUMeshBVH: Allocating buffers (primCount=${primCount}, newCapacity=${newCapacity}, oldCapacity=${this._bufferCapacity || 0})` );

		// Ensure at least 1 workgroup for buffer allocations (prevents zero-size buffers)
		const workgroupCount = Math.max( 1, Math.ceil( newCapacity / workgroupSize ) );

		// Max nodes = 2 * capacity - 1 for binary tree
		const maxNodes = 2 * newCapacity;

		// Destroy old build buffers
		if ( this._buildBuffers ) {

			for ( const key in this._buildBuffers ) {

				this._buildBuffers[ key ].destroy();

			}

		}

		// Invalidate cached bind groups (they reference old buffers)
		this._hplocBindGroups = null;
		this._hplocBindGroupsCacheKey = null;
		this._setupBindGroups = null;
		this._setupBindGroupsCacheKey = null;
		this._sortBindGroups = null;
		this._sortBindGroupsCacheKey = null;
		this._refitBindGroups = null;
		this._refitBindGroupsCacheKey = null;
		this._refitParentsDirty = true;

		// Destroy old BVH buffer
		if ( this._bvhBuffer ) {

			this._bvhBuffer.destroy();

		}

		// Store new capacity
		this._bufferCapacity = newCapacity;

		// Build state buffers (sized to capacity for reuse)
		this._buildBuffers = {
			// Atomic scene bounds in sortable-u32 format:
			// [minX, minY, minZ, maxX, maxY, maxZ]
			// Uses native atomicMin/atomicMax for parallel reduction.
			sceneBounds: device.createBuffer( {
				size: 24, // 6 × u32
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			} ),

			// Morton codes (32-bit)
			mortonCodes: device.createBuffer( {
				size: newCapacity * 4,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
			} ),

			// Morton codes (double buffer for sort)
			mortonCodesAlt: device.createBuffer( {
				size: newCapacity * 4,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
			} ),

			// Cluster indices
			clusterIdx: device.createBuffer( {
				size: newCapacity * 4,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
			} ),

			// Cluster indices (double buffer for sort)
			clusterIdxAlt: device.createBuffer( {
				size: newCapacity * 4,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
			} ),

			// Partial bounds buffers removed - atomic scene bounds eliminates reduction passes

			// Parent IDs:
			// - during build: LBVH traversal scratch (indices < primCount)
			// - during refit: node parent map (indices < nodeCount)
			parentIdx: device.createBuffer( {
				size: maxNodes * 4,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			} ),

			// Per-node child completion counters for refit propagation
			refitVisitCount: device.createBuffer( {
				size: maxNodes * 4,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			} ),

			// BVH2 nodes (during build)
			// Node: bounds (24 bytes) + leftChild (4) + rightChild (4) = 32 bytes
			bvh2Nodes: device.createBuffer( {
				size: maxNodes * 32,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
			} ),

			// Flattening scratch
			subtreeSizes: device.createBuffer( {
				size: maxNodes * 4,
				usage: GPUBufferUsage.STORAGE,
			} ),

			flattenStackNodes: device.createBuffer( {
				size: maxNodes * 4,
				usage: GPUBufferUsage.STORAGE,
			} ),

			flattenStackOut: device.createBuffer( {
				size: maxNodes * 4,
				usage: GPUBufferUsage.STORAGE,
			} ),

			// Atomic counter for node allocation
			nodeCounter: device.createBuffer( {
				size: 4,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
			} ),

			// H-PLOC persistent state buffer (for multi-dispatch)
			// Interleaved: [left0, right0, split0, active0, left1, ...]
			// COPY_SRC added for debugging readback
			hplocState: device.createBuffer( {
				size: newCapacity * 4 * 4, // 4 u32s per primitive
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
			} ),

			// Indirect dispatch buffers for H-PLOC optimization
			// Double-buffered active lists for ping-pong during indirect dispatch.
			// Main build path seeds activeList0 in computeBounds; initActiveList is kept for debug replays.
			activeList0: device.createBuffer( {
				size: Math.max( 16, newCapacity * 4 ),
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
			} ),
			activeList1: device.createBuffer( {
				size: Math.max( 16, newCapacity * 4 ),
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
			} ),
			// Atomic counters for active list sizes (initialized via GPU compute pass)
			activeCount0: device.createBuffer( {
				size: 4,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
			} ),
			activeCount1: device.createBuffer( {
				size: 4,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
			} ),
			// Indirect dispatch arguments (initialized via GPU compute pass)
			// [workgroupCountX, workgroupCountY, workgroupCountZ]
			// COPY_SRC added for debugging readback
			indirectDispatch: device.createBuffer( {
				size: 12, // 3 × u32
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
			} ),

			// Radix sort: stable sort using deterministic workgroup-order prefix scan
			// All radix buffers include COPY_DST for explicit clearing (prevents undefined initial contents)
			// groupCounts stores per-workgroup digit counts (histogram output)
			groupCounts: device.createBuffer( {
				size: workgroupCount * 256 * 4,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			} ),

			// groupPrefix stores per-workgroup digit offsets (workgroup scan output)
			groupPrefix: device.createBuffer( {
				size: workgroupCount * 256 * 4,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			} ),

			// globalDigitCount: 256 counters for total digit counts
			// Reset to 0 before each radix pass
			globalDigitCount: device.createBuffer( {
				size: 256 * 4,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			} ),

			digitOffsets: device.createBuffer( {
				size: 256 * 4,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			} ),

			// Uniforms - larger buffer for single-submission batching (Phase 2 optimization)
			// Layout: multiple 256-byte aligned uniform blocks for all passes
			uniforms: device.createBuffer( {
				size: 4096, // Room for ~16 uniform blocks at 256-byte alignment
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			} ),

			// Combined readback buffer for nodeCount + rootIndex
			readback: device.createBuffer( {
				size: 8,
				usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
			} ),
		};

		// Output buffers (final BVH)
		// Node: bounds (24 bytes) + rightChildOrOffset (4) + splitAxisOrCount (4) = 32 bytes
		this._bvhBuffer = device.createBuffer( {
			size: maxNodes * 32,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
		} );

		// Timestamp query buffers (for accurate per-phase timing)
		// Phases: setup(2), sort(2), hploc(2), flatten(2) = 8 timestamps max
		// Only create once - reuse on subsequent builds to avoid exhausting Metal's query set pool
		if ( this._hasTimestampQuery && ! this._timestampBuffers ) {

			this._timestampBuffers = {
				querySet: device.createQuerySet( {
					type: 'timestamp',
					count: 8,
				} ),
				resolveBuffer: device.createBuffer( {
					size: 8 * 8, // 8 timestamps × 8 bytes each (u64)
					usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
				} ),
				readbackBuffer: device.createBuffer( {
					size: 8 * 8,
					usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
				} ),
			};

		}

	}

	_uploadGeometry( positions, indices, resetBuildState = true ) {

		const device = this.device;

		// Standard geometry upload always uses stride 3 and owns its buffers
		this._positionStride = 3;

		// If switching from external buffers, release references (don't destroy - we don't own them)
		if ( this._externalPositionBuffer ) {

			this._positionBuffer = null;
			this._positionBufferCapacity = 0;

		}

		if ( this._externalIndexBuffer ) {

			this._indexBuffer = null;
			this._indexBufferCapacity = 0;

		}

		this._externalPositionBuffer = false;
		this._externalIndexBuffer = false;

		// Geometry buffer reuse: only reallocate if new data exceeds capacity
		const positionBytes = positions.byteLength;
		const indexBytes = indices.byteLength;

		// Position buffer - reuse if capacity sufficient
		if ( ! this._positionBuffer || positionBytes > this._positionBufferCapacity ) {

			if ( this._positionBuffer ) {

				this._positionBuffer.destroy();

			}

			// Grow with 1.5x factor for positions
			const newCapacity = Math.max( positionBytes, Math.ceil( ( this._positionBufferCapacity || 0 ) * 1.5 ) );
			this._positionBufferCapacity = newCapacity;

			this._positionBuffer = device.createBuffer( {
				size: newCapacity,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			} );

			// New buffer identity - invalidate setup/refit bind groups
			this._setupBindGroups = null;
			this._refitBindGroups = null;
			this._refitBindGroupsCacheKey = null;

		}

		// Write position data (works for both new and reused buffers)
		device.queue.writeBuffer( this._positionBuffer, 0, positions );

		// Index buffer - reuse if capacity sufficient
		if ( ! this._indexBuffer || indexBytes > this._indexBufferCapacity ) {

			if ( this._indexBuffer ) {

				this._indexBuffer.destroy();

			}

			// Grow with 1.5x factor for indices
			const newCapacity = Math.max( indexBytes, Math.ceil( ( this._indexBufferCapacity || 0 ) * 1.5 ) );
			this._indexBufferCapacity = newCapacity;

			this._indexBuffer = device.createBuffer( {
				size: newCapacity,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			} );

			// New buffer identity - invalidate setup/refit bind groups
			this._setupBindGroups = null;
			this._refitBindGroups = null;
			this._refitBindGroupsCacheKey = null;

		}

		// Write index data (works for both new and reused buffers)
		device.queue.writeBuffer( this._indexBuffer, 0, indices );

		// Initialize build state (scene bounds, node counter) for full rebuilds.
		// Refit uploads only update geometry data and preserve existing topology.
		if ( resetBuildState ) {

			this._initBuildState();

		}

	}

	/**
	 * Initialize build state buffers (scene bounds, node counter).
	 * Called by both _uploadGeometry and buildAsyncFromGPUBuffers.
	 */
	_initBuildState() {

		const device = this.device;

		// Initialize atomic scene bounds in sortable-u32 space:
		// min starts at +Infinity key, max starts at -Infinity key.
		const boundsInitU32 = new Uint32Array( [
			0xFF800000, 0xFF800000, 0xFF800000, // +Infinity encoded
			0x007FFFFF, 0x007FFFFF, 0x007FFFFF, // -Infinity encoded
		] );
		device.queue.writeBuffer( this._buildBuffers.sceneBounds, 0, boundsInitU32 );

		// Initialize node counter to primCount (leaves are pre-allocated)
		const counterInit = new Uint32Array( [ this._primCount ] );
		device.queue.writeBuffer( this._buildBuffers.nodeCounter, 0, counterInit );

		// NOTE: parentIdx and hplocState are now initialized on GPU in computeBounds shader
		// This removes ~3ms of CPU overhead for 30k triangles

		// Write uniforms
		const uniforms = new Uint32Array( [ this._primCount, 0, 0, 0 ] );
		device.queue.writeBuffer( this._buildBuffers.uniforms, 0, uniforms );

	}

	_createPipelines() {

		const device = this.device;

		// Check for subgroups support (for optimized bounds reduction)
		const hasSubgroups = device.features && device.features.has( 'subgroups' );

		// Setup pass pipelines (use subgroup-optimized version when available)
		const boundsShaderCode = hasSubgroups ? setupShaders.computeBoundsSubgroup : setupShaders.computeBounds;
		const setupBoundsModule = device.createShaderModule( { code: boundsShaderCode } );
		const setupBoundsPipeline = device.createComputePipeline( {
			layout: 'auto',
			compute: {
				module: setupBoundsModule,
				entryPoint: 'computeBounds',
			},
		} );

		const setupReduceModule = device.createShaderModule( { code: setupShaders.reduceBounds } );
		const setupReducePipeline = device.createComputePipeline( {
			layout: 'auto',
			compute: {
				module: setupReduceModule,
				entryPoint: 'reduceBounds',
			},
		} );

		const setupReducePartialModule = device.createShaderModule( { code: setupShaders.reduceBoundsToPartial } );
		const setupReducePartialPipeline = device.createComputePipeline( {
			layout: 'auto',
			compute: {
				module: setupReducePartialModule,
				entryPoint: 'reduceBoundsToPartial',
			},
		} );

		const setupMortonModule = device.createShaderModule( { code: setupShaders.computeMorton } );
		const setupMortonPipeline = device.createComputePipeline( {
			layout: 'auto',
			compute: {
				module: setupMortonModule,
				entryPoint: 'computeMorton',
			},
		} );

		// Radix sort pipelines (stable sort for LSD radix correctness)
		const radixHistogramModule = device.createShaderModule( { code: radixSortShaders.histogram } );
		const radixWorkgroupScanModule = device.createShaderModule( { code: radixSortShaders.workgroupScan } );
		const radixScanModule = device.createShaderModule( { code: radixSortShaders.scan } );
		const radixScatterModule = device.createShaderModule( { code: radixSortShaders.scatter } );

		const radixHistogramPipeline = device.createComputePipeline( {
			layout: 'auto',
			compute: {
				module: radixHistogramModule,
				entryPoint: 'computeHistogram',
			},
		} );

		const radixWorkgroupScanPipeline = device.createComputePipeline( {
			layout: 'auto',
			compute: {
				module: radixWorkgroupScanModule,
				entryPoint: 'workgroupScan',
			},
		} );

		const radixScanPipeline = device.createComputePipeline( {
			layout: 'auto',
			compute: {
				module: radixScanModule,
				entryPoint: 'prefixScan',
			},
		} );

		const radixScatterPipeline = device.createComputePipeline( {
			layout: 'auto',
			compute: {
				module: radixScatterModule,
				entryPoint: 'scatter',
			},
		} );

		// H-PLOC pipeline - select optimal variant based on detected subgroup size
		// 1-subgroup-per-workgroup variants (wave32, wave64) eliminate wasted barrier overhead
		const { shaderSource: hplocCode, label: hplocVariant, workgroupSize: hplocWG } = this._selectHPLOCShaderVariant();
		this._hplocShaderVariant = hplocVariant;
		this._hplocWorkgroupSize = hplocWG;

		const hplocModule = device.createShaderModule( {
			label: `H-PLOC Shader (${hplocVariant})`,
			code: hplocCode,
		} );
		const hplocPipeline = device.createComputePipeline( {
			layout: 'auto',
			compute: {
				module: hplocModule,
				entryPoint: 'hplocBuild',
			},
		} );

		if ( hplocVariant !== 'fallback' && this._verbose ) {

			console.info( `GPUMeshBVH: Using ${hplocVariant} H-PLOC shader (WG=${hplocWG}, subgroup size ${this._subgroupSize})` );

		}

		// H-PLOC indirect dispatch pipelines - select variant matching direct shader
		// Wave32/Wave64 indirect variants enable single-pass indirect dispatch
		let hplocIndirectCode = hplocShaderIndirect; // Fallback
		let updateDispatchCode = hplocUpdateDispatchShaderWave64; // Default

		if ( hplocVariant === 'wave32' ) {

			hplocIndirectCode = hplocShaderWave32Indirect;
			updateDispatchCode = hplocUpdateDispatchShaderWave32;

		} else if ( hplocVariant === 'wave64' ) {

			hplocIndirectCode = hplocShaderWave64Indirect;
			updateDispatchCode = hplocUpdateDispatchShaderWave64;

		}

		const hplocIndirectModule = device.createShaderModule( {
			label: `H-PLOC Indirect Shader (${hplocVariant})`,
			code: hplocIndirectCode,
		} );
		const hplocIndirectPipeline = device.createComputePipeline( {
			layout: 'auto',
			compute: {
				module: hplocIndirectModule,
				entryPoint: 'hplocBuildIndirect',
			},
		} );

		const updateDispatchModule = device.createShaderModule( {
			label: `Update Dispatch Shader (${hplocVariant})`,
			code: updateDispatchCode,
		} );
		const updateDispatchPipeline = device.createComputePipeline( {
			layout: 'auto',
			compute: {
				module: updateDispatchModule,
				entryPoint: 'updateIndirectDispatch',
			},
		} );

		const initActiveListModule = device.createShaderModule( { code: hplocInitActiveListShader } );
		const initActiveListPipeline = device.createComputePipeline( {
			layout: 'auto',
			compute: {
				module: initActiveListModule,
				entryPoint: 'initActiveList',
			},
		} );

		// Init indirect counters pipeline - initializes all counters in GPU for reliable ordering
		const initIndirectCountersModule = device.createShaderModule( {
			label: 'initIndirectCounters',
			code: hplocInitIndirectCountersShader,
		} );

		// Check for shader compilation errors
		initIndirectCountersModule.getCompilationInfo().then( info => {

			for ( const msg of info.messages ) {

				if ( msg.type === 'error' ) {

					console.error( `initIndirectCounters shader error: ${msg.message} at line ${msg.lineNum}` );

				} else if ( msg.type === 'warning' ) {

					console.warn( `initIndirectCounters shader warning: ${msg.message}` );

				}

			}

		} );

		const initIndirectCountersPipeline = device.createComputePipeline( {
			layout: 'auto',
			compute: {
				module: initIndirectCountersModule,
				entryPoint: 'initIndirectCounters',
			},
		} );

		// Flatten pipeline
		const flattenModule = device.createShaderModule( { code: flattenShader } );
		const flattenSizePipeline = device.createComputePipeline( {
			layout: 'auto',
			compute: {
				module: flattenModule,
				entryPoint: 'computeSubtreeSizes',
			},
		} );

		const flattenPipeline = device.createComputePipeline( {
			layout: 'auto',
			compute: {
				module: flattenModule,
				entryPoint: 'flattenTree',
			},
		} );

		// Refit pipelines
		const refitBuildParentsModule = device.createShaderModule( {
			label: 'refitBuildParents',
			code: refitBuildParentsShader,
		} );
		const refitBuildParentsPipeline = device.createComputePipeline( {
			layout: 'auto',
			compute: {
				module: refitBuildParentsModule,
				entryPoint: 'buildParentMap',
			},
		} );

		const refitLeavesModule = device.createShaderModule( {
			label: 'refitBVHLeaves',
			code: refitBVHLeavesShader,
		} );
		const refitLeavesPipeline = device.createComputePipeline( {
			layout: 'auto',
			compute: {
				module: refitLeavesModule,
				entryPoint: 'refitLeaves',
			},
		} );

		const refitInternalModule = device.createShaderModule( {
			label: 'refitBVHInternal',
			code: getRefitBVHInternalShader( 256 ),
		} );
		const refitInternalPipeline = device.createComputePipeline( {
			layout: 'auto',
			compute: {
				module: refitInternalModule,
				entryPoint: 'refitInternalWave',
			},
		} );

		return {
			setupBounds: setupBoundsPipeline,
			setupReduce: setupReducePipeline,
			setupReducePartial: setupReducePartialPipeline,
			setupMorton: setupMortonPipeline,
			radixHistogram: radixHistogramPipeline,
			radixWorkgroupScan: radixWorkgroupScanPipeline,
			radixScan: radixScanPipeline,
			radixScatter: radixScatterPipeline,
			hploc: hplocPipeline,
			hplocIndirect: hplocIndirectPipeline,
			updateDispatch: updateDispatchPipeline,
			initActiveList: initActiveListPipeline,
			initIndirectCounters: initIndirectCountersPipeline,
			flattenSize: flattenSizePipeline,
			flatten: flattenPipeline,
			refitBuildParents: refitBuildParentsPipeline,
			refitLeaves: refitLeavesPipeline,
			refitInternal: refitInternalPipeline,
		};

	}

	_runSetupPass( unusedEncoder, primCount ) {

		if ( primCount === 0 ) return;

		const device = this.device;
		const workgroupSize = 256;
		const workgroupCount = Math.ceil( primCount / workgroupSize );

		const uniforms = new Uint32Array( [ primCount, workgroupCount, 0, 0 ] );
		device.queue.writeBuffer( this._buildBuffers.uniforms, 0, uniforms );

		const commandEncoder = device.createCommandEncoder();

		// Pass 1: compute bounds + atomic update scene bounds + initialize state
		// Reduction passes eliminated - native integer atomics handle scene bounds directly
		{

			const passEncoder = commandEncoder.beginComputePass();
			const bindGroup = device.createBindGroup( {
				layout: this._pipelines.setupBounds.getBindGroupLayout( 0 ),
				entries: [
					{ binding: 0, resource: { buffer: this._buildBuffers.uniforms } },
					{ binding: 1, resource: { buffer: this._positionBuffer } },
					{ binding: 2, resource: { buffer: this._indexBuffer } },
					{ binding: 3, resource: { buffer: this._buildBuffers.bvh2Nodes } },
					{ binding: 4, resource: { buffer: this._buildBuffers.clusterIdx } },
					{ binding: 5, resource: { buffer: this._buildBuffers.sceneBounds } },
					{ binding: 6, resource: { buffer: this._buildBuffers.parentIdx } },
					{ binding: 7, resource: { buffer: this._buildBuffers.hplocState } },
					{ binding: 8, resource: { buffer: this._buildBuffers.activeList0 } },
				],
			} );

			passEncoder.setPipeline( this._pipelines.setupBounds );
			passEncoder.setBindGroup( 0, bindGroup );
			passEncoder.dispatchWorkgroups( workgroupCount );
			passEncoder.end();

		}

		// Pass 2: Morton codes (scene bounds already computed via atomics)
		{

			const passEncoder = commandEncoder.beginComputePass();
			const bindGroup = device.createBindGroup( {
				layout: this._pipelines.setupMorton.getBindGroupLayout( 0 ),
				entries: [
					{ binding: 0, resource: { buffer: this._buildBuffers.uniforms } },
					{ binding: 1, resource: { buffer: this._buildBuffers.bvh2Nodes } },
					{ binding: 2, resource: { buffer: this._buildBuffers.sceneBounds } },
					{ binding: 3, resource: { buffer: this._buildBuffers.mortonCodes } },
				],
			} );

			passEncoder.setPipeline( this._pipelines.setupMorton );
			passEncoder.setBindGroup( 0, bindGroup );
			passEncoder.dispatchWorkgroups( workgroupCount );
			passEncoder.end();

		}

		device.queue.submit( [ commandEncoder.finish() ] );

	}

	_runRadixSortPass( unusedEncoder, primCount ) {

		// Use external sorter if configured (check both _sorterType and _sorter for safety)
		if ( this._sorterType !== SorterType.BUILTIN && this._sorter ) {

			// Note: OneSweep does 4-pass ping-pong, so output ends up back in keysIn/valsIn
			const commandEncoder = this.device.createCommandEncoder();
			this._sorter.sort( {
				commandEncoder,
				keysIn: this._buildBuffers.mortonCodes,
				keysOut: this._buildBuffers.mortonCodesAlt,
				valsIn: this._buildBuffers.clusterIdx,
				valsOut: this._buildBuffers.clusterIdxAlt,
				count: primCount,
			} );
			this.device.queue.submit( [ commandEncoder.finish() ] );
			return;

		}

		// Built-in radix sort: 32-bit Morton codes, 4 passes of 8-bit digits (stable sort for LSD radix)
		// Each pass needs different uniforms, so we submit each separately
		const numPasses = 4;
		const workgroupCount = Math.ceil( primCount / 256 );

		// Clear intermediate buffers once at start (prevents undefined initial contents)
		{

			const clearEncoder = this.device.createCommandEncoder();
			clearEncoder.clearBuffer( this._buildBuffers.groupCounts );
			clearEncoder.clearBuffer( this._buildBuffers.groupPrefix );
			clearEncoder.clearBuffer( this._buildBuffers.digitOffsets );
			this.device.queue.submit( [ clearEncoder.finish() ] );

		}

		let keysIn = this._buildBuffers.mortonCodes;
		let keysOut = this._buildBuffers.mortonCodesAlt;
		let valsIn = this._buildBuffers.clusterIdx;
		let valsOut = this._buildBuffers.clusterIdxAlt;

		for ( let pass = 0; pass < numPasses; pass ++ ) {

			const bitOffset = pass * 8;

			// Update uniforms with bit offset + workgroup count
			const uniforms = new Uint32Array( [ primCount, bitOffset, workgroupCount, 0 ] );
			this.device.queue.writeBuffer( this._buildBuffers.uniforms, 0, uniforms );

			// Reset globalDigitCount to 0 before each radix pass
			this.device.queue.writeBuffer( this._buildBuffers.globalDigitCount, 0, new Uint32Array( 256 ) );

			// Each radix pass gets its own command encoder + submit
			const commandEncoder = this.device.createCommandEncoder();

			// Histogram pass: count digits per workgroup
			{

				const passEncoder = commandEncoder.beginComputePass();
				const bindGroup = this.device.createBindGroup( {
					layout: this._pipelines.radixHistogram.getBindGroupLayout( 0 ),
					entries: [
						{ binding: 0, resource: { buffer: this._buildBuffers.uniforms } },
						{ binding: 1, resource: { buffer: keysIn } },
						{ binding: 2, resource: { buffer: this._buildBuffers.groupCounts } },
						{ binding: 3, resource: { buffer: this._buildBuffers.globalDigitCount } },
					],
				} );
				passEncoder.setPipeline( this._pipelines.radixHistogram );
				passEncoder.setBindGroup( 0, bindGroup );
				passEncoder.dispatchWorkgroups( workgroupCount );
				passEncoder.end();

			}

			// Workgroup scan pass: compute exclusive prefix sum across workgroups
			// This ensures stability - workgroup 0's elements come before workgroup 1's
			{

				const passEncoder = commandEncoder.beginComputePass();
				const bindGroup = this.device.createBindGroup( {
					layout: this._pipelines.radixWorkgroupScan.getBindGroupLayout( 0 ),
					entries: [
						{ binding: 0, resource: { buffer: this._buildBuffers.uniforms } },
						{ binding: 1, resource: { buffer: this._buildBuffers.groupCounts } },
						{ binding: 2, resource: { buffer: this._buildBuffers.groupPrefix } },
					],
				} );
				passEncoder.setPipeline( this._pipelines.radixWorkgroupScan );
				passEncoder.setBindGroup( 0, bindGroup );
				passEncoder.dispatchWorkgroups( 1 );
				passEncoder.end();

			}

			// Digit scan pass: compute digit base offsets
			{

				const passEncoder = commandEncoder.beginComputePass();
				const bindGroup = this.device.createBindGroup( {
					layout: this._pipelines.radixScan.getBindGroupLayout( 0 ),
					entries: [
						{ binding: 1, resource: { buffer: this._buildBuffers.globalDigitCount } },
						{ binding: 2, resource: { buffer: this._buildBuffers.digitOffsets } },
					],
				} );
				passEncoder.setPipeline( this._pipelines.radixScan );
				passEncoder.setBindGroup( 0, bindGroup );
				passEncoder.dispatchWorkgroups( 1 );
				passEncoder.end();

			}

			// Scatter pass: reorder keys and values
			{

				const passEncoder = commandEncoder.beginComputePass();
				const bindGroup = this.device.createBindGroup( {
					layout: this._pipelines.radixScatter.getBindGroupLayout( 0 ),
					entries: [
						{ binding: 0, resource: { buffer: this._buildBuffers.uniforms } },
						{ binding: 1, resource: { buffer: keysIn } },
						{ binding: 2, resource: { buffer: keysOut } },
						{ binding: 3, resource: { buffer: valsIn } },
						{ binding: 4, resource: { buffer: valsOut } },
						{ binding: 5, resource: { buffer: this._buildBuffers.groupPrefix } },
						{ binding: 6, resource: { buffer: this._buildBuffers.digitOffsets } },
					],
				} );
				passEncoder.setPipeline( this._pipelines.radixScatter );
				passEncoder.setBindGroup( 0, bindGroup );
				passEncoder.dispatchWorkgroups( workgroupCount );
				passEncoder.end();

			}

			// Submit this radix pass
			this.device.queue.submit( [ commandEncoder.finish() ] );

			// Swap buffers for next pass
			[ keysIn, keysOut ] = [ keysOut, keysIn ];
			[ valsIn, valsOut ] = [ valsOut, valsIn ];

		}

		// After even number of passes, result is back in original buffers
		// (mortonCodes, clusterIdx)

	}

	/**
	 * Record setup pass to command encoder (Phase 2: single-submission batching)
	 * Uses pre-uploaded uniforms at specified offsets
	 * Atomic scene bounds - no reduction passes needed
	 */
	_recordSetupPass( commandEncoder, primCount, offsets ) {

		if ( primCount === 0 ) return;

		const device = this.device;
		const workgroupSize = 256;
		const workgroupCount = Math.ceil( primCount / workgroupSize );

		// Cache setup bind groups (invalidated by _allocateBuffers and buffer identity changes)
		const cacheKey = `${offsets.setup}_${offsets.morton}`;
		if ( ! this._setupBindGroups || this._setupBindGroupsCacheKey !== cacheKey ) {

			this._setupBindGroupsCacheKey = cacheKey;
			this._setupBindGroups = {
				bounds: device.createBindGroup( {
					layout: this._pipelines.setupBounds.getBindGroupLayout( 0 ),
					entries: [
						{ binding: 0, resource: { buffer: this._buildBuffers.uniforms, offset: offsets.setup, size: 16 } },
						{ binding: 1, resource: { buffer: this._positionBuffer } },
						{ binding: 2, resource: { buffer: this._indexBuffer } },
						{ binding: 3, resource: { buffer: this._buildBuffers.bvh2Nodes } },
						{ binding: 4, resource: { buffer: this._buildBuffers.clusterIdx } },
						{ binding: 5, resource: { buffer: this._buildBuffers.sceneBounds } },
						{ binding: 6, resource: { buffer: this._buildBuffers.parentIdx } },
						{ binding: 7, resource: { buffer: this._buildBuffers.hplocState } },
						{ binding: 8, resource: { buffer: this._buildBuffers.activeList0 } },
					],
				} ),
				morton: device.createBindGroup( {
					layout: this._pipelines.setupMorton.getBindGroupLayout( 0 ),
					entries: [
						{ binding: 0, resource: { buffer: this._buildBuffers.uniforms, offset: offsets.morton, size: 16 } },
						{ binding: 1, resource: { buffer: this._buildBuffers.bvh2Nodes } },
						{ binding: 2, resource: { buffer: this._buildBuffers.sceneBounds } },
						{ binding: 3, resource: { buffer: this._buildBuffers.mortonCodes } },
					],
				} ),
			};

		}

		// Pass 1: Bounds computation + atomic scene bounds + state initialization
		{

			const passEncoder = commandEncoder.beginComputePass();
			passEncoder.setPipeline( this._pipelines.setupBounds );
			passEncoder.setBindGroup( 0, this._setupBindGroups.bounds );
			passEncoder.dispatchWorkgroups( workgroupCount );
			passEncoder.end();

		}

		// Pass 2: Morton codes (scene bounds already computed via atomics)
		{

			const passEncoder = commandEncoder.beginComputePass();
			passEncoder.setPipeline( this._pipelines.setupMorton );
			passEncoder.setBindGroup( 0, this._setupBindGroups.morton );
			passEncoder.dispatchWorkgroups( workgroupCount );
			passEncoder.end();

		}

	}

	/**
	 * Initialize external sorter if configured
	 */
	async _initSorter( primCount ) {

		if ( this._sorterType === SorterType.ONESWEEP ) {

			this._sorter = new OneSweepSorter( this.device );
			await this._sorter.init( primCount );
			if ( this._verbose ) console.info( `GPUMeshBVH: Using OneSweep sorter` );

		}

	}

	/**
	 * Detect GPU subgroup size for optimal H-PLOC shader variant selection.
	 * Returns: 16, 32, 64, or 0 if subgroups not supported.
	 */
	async _detectSubgroupSize() {

		if ( this._subgroupSize > 0 ) {

			return this._subgroupSize;

		}

		if ( ! this._hasSubgroups ) {

			this._subgroupSize = 0;
			return 0;

		}

		const device = this.device;

		try {

			const module = device.createShaderModule( {
				label: 'H-PLOC Subgroup Probe',
				code: subgroupDetectShader,
			} );

			const pipeline = device.createComputePipeline( {
				layout: 'auto',
				compute: { module, entryPoint: 'main' },
			} );

			const outputBuffer = device.createBuffer( {
				size: 4,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
			} );

			const stagingBuffer = device.createBuffer( {
				size: 4,
				usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
			} );

			const bindGroup = device.createBindGroup( {
				layout: pipeline.getBindGroupLayout( 0 ),
				entries: [ { binding: 0, resource: { buffer: outputBuffer } } ],
			} );

			const encoder = device.createCommandEncoder();
			const pass = encoder.beginComputePass();
			pass.setPipeline( pipeline );
			pass.setBindGroup( 0, bindGroup );
			pass.dispatchWorkgroups( 1 );
			pass.end();
			encoder.copyBufferToBuffer( outputBuffer, 0, stagingBuffer, 0, 4 );
			device.queue.submit( [ encoder.finish() ] );

			await device.queue.onSubmittedWorkDone();

			await stagingBuffer.mapAsync( GPUMapMode.READ );
			const detected = new Uint32Array( stagingBuffer.getMappedRange() )[ 0 ];
			stagingBuffer.unmap();
			stagingBuffer.destroy();
			outputBuffer.destroy();

			this._subgroupSize = detected !== 0 ? detected : 0;
			if ( this._verbose ) console.info( `GPUMeshBVH: Detected subgroup size = ${this._subgroupSize}` );

		} catch ( e ) {

			// Keep warning - subgroup detection failure is worth noting
			console.warn( 'GPUMeshBVH: Subgroup detection failed:', e );
			this._subgroupSize = 0;

		}

		return this._subgroupSize;

	}

	/**
	 * Select optimal H-PLOC shader variant based on detected subgroup size.
	 * Returns: { shaderSource, label, workgroupSize }
	 */
	_selectHPLOCShaderVariant() {

		const size = this._subgroupSize;

		// Wave32: Apple M-series, NVIDIA
		if ( size === 32 ) {

			if ( this._verbose ) console.info( `GPUMeshBVH: Selected H-PLOC variant = wave32` );
			return {
				shaderSource: hplocShaderWave32,
				label: 'wave32',
				workgroupSize: 32,
			};

		}

		// Wave64: AMD
		if ( size === 64 ) {

			if ( this._verbose ) console.info( `GPUMeshBVH: Selected H-PLOC variant = wave64` );
			return {
				shaderSource: hplocShaderWave64,
				label: 'wave64',
				workgroupSize: 64,
			};

		}

		// Fallback: subgroups not supported or unusual size
		// Use the basic non-subgroup shader with WG=64
		if ( this._verbose ) console.info( `GPUMeshBVH: Selected H-PLOC variant = fallback (subgroupSize=${size})` );
		return {
			shaderSource: hplocShader,
			label: 'fallback',
			workgroupSize: 64,
		};

	}

	/**
	 * Record radix sort pass to command encoder (Phase 2: single-submission batching)
	 * Uses pre-uploaded uniforms at specified offsets
	 */
	_recordRadixSortPass( commandEncoder, primCount, offsets ) {

		// Use external sorter if configured (check both _sorterType and _sorter for safety)
		if ( this._sorterType !== SorterType.BUILTIN && this._sorter ) {

			// Note: OneSweep does 4-pass ping-pong, so output ends up back in keysIn/valsIn
			this._sorter.sort( {
				commandEncoder,
				keysIn: this._buildBuffers.mortonCodes,
				keysOut: this._buildBuffers.mortonCodesAlt,
				valsIn: this._buildBuffers.clusterIdx,
				valsOut: this._buildBuffers.clusterIdxAlt,
				count: primCount,
			} );
			return;

		}

		// Built-in radix sort (stable sort for LSD radix correctness)
		const workgroupCount = Math.ceil( primCount / 256 );

		// Cache sort bind groups (invalidated by _allocateBuffers when buffers change)
		// 13 bind groups: 4 histogram + 4 workgroupScan + 1 radixScan + 4 scatter
		const sortCacheKey = offsets.sort.join( '_' );
		if ( ! this._sortBindGroups || this._sortBindGroupsCacheKey !== sortCacheKey ) {

			this._sortBindGroupsCacheKey = sortCacheKey;

			const device = this.device;
			const bufs = this._buildBuffers;
			const keysBuffers = [ bufs.mortonCodes, bufs.mortonCodesAlt ];
			const valsBuffers = [ bufs.clusterIdx, bufs.clusterIdxAlt ];

			const histogram = [];
			const workgroupScan = [];
			const scatter = [];

			for ( let pass = 0; pass < 4; pass ++ ) {

				const src = pass % 2;
				const dst = 1 - src;

				histogram.push( device.createBindGroup( {
					layout: this._pipelines.radixHistogram.getBindGroupLayout( 0 ),
					entries: [
						{ binding: 0, resource: { buffer: bufs.uniforms, offset: offsets.sort[ pass ], size: 16 } },
						{ binding: 1, resource: { buffer: keysBuffers[ src ] } },
						{ binding: 2, resource: { buffer: bufs.groupCounts } },
						{ binding: 3, resource: { buffer: bufs.globalDigitCount } },
					],
				} ) );

				workgroupScan.push( device.createBindGroup( {
					layout: this._pipelines.radixWorkgroupScan.getBindGroupLayout( 0 ),
					entries: [
						{ binding: 0, resource: { buffer: bufs.uniforms, offset: offsets.sort[ pass ], size: 16 } },
						{ binding: 1, resource: { buffer: bufs.groupCounts } },
						{ binding: 2, resource: { buffer: bufs.groupPrefix } },
					],
				} ) );

				scatter.push( device.createBindGroup( {
					layout: this._pipelines.radixScatter.getBindGroupLayout( 0 ),
					entries: [
						{ binding: 0, resource: { buffer: bufs.uniforms, offset: offsets.sort[ pass ], size: 16 } },
						{ binding: 1, resource: { buffer: keysBuffers[ src ] } },
						{ binding: 2, resource: { buffer: keysBuffers[ dst ] } },
						{ binding: 3, resource: { buffer: valsBuffers[ src ] } },
						{ binding: 4, resource: { buffer: valsBuffers[ dst ] } },
						{ binding: 5, resource: { buffer: bufs.groupPrefix } },
						{ binding: 6, resource: { buffer: bufs.digitOffsets } },
					],
				} ) );

			}

			const radixScan = this.device.createBindGroup( {
				layout: this._pipelines.radixScan.getBindGroupLayout( 0 ),
				entries: [
					{ binding: 1, resource: { buffer: bufs.globalDigitCount } },
					{ binding: 2, resource: { buffer: bufs.digitOffsets } },
				],
			} );

			this._sortBindGroups = { histogram, workgroupScan, radixScan, scatter };

		}

		// Clear intermediate buffers to ensure clean state (prevents undefined initial contents)
		commandEncoder.clearBuffer( this._buildBuffers.groupCounts );
		commandEncoder.clearBuffer( this._buildBuffers.groupPrefix );
		commandEncoder.clearBuffer( this._buildBuffers.digitOffsets );

		for ( let pass = 0; pass < 4; pass ++ ) {

			// Clear globalDigitCount before each radix pass
			commandEncoder.clearBuffer( this._buildBuffers.globalDigitCount );

			// Histogram: count digits per workgroup
			{

				const passEncoder = commandEncoder.beginComputePass();
				passEncoder.setPipeline( this._pipelines.radixHistogram );
				passEncoder.setBindGroup( 0, this._sortBindGroups.histogram[ pass ] );
				passEncoder.dispatchWorkgroups( workgroupCount );
				passEncoder.end();

			}

			// Workgroup scan: compute exclusive prefix sum across workgroups for each digit
			// This ensures stability - workgroup 0's elements come before workgroup 1's
			{

				const passEncoder = commandEncoder.beginComputePass();
				passEncoder.setPipeline( this._pipelines.radixWorkgroupScan );
				passEncoder.setBindGroup( 0, this._sortBindGroups.workgroupScan[ pass ] );
				passEncoder.dispatchWorkgroups( 1 );
				passEncoder.end();

			}

			// Digit scan: compute digit base offsets
			{

				const passEncoder = commandEncoder.beginComputePass();
				passEncoder.setPipeline( this._pipelines.radixScan );
				passEncoder.setBindGroup( 0, this._sortBindGroups.radixScan );
				passEncoder.dispatchWorkgroups( 1 );
				passEncoder.end();

			}

			// Scatter: reorder keys and values
			{

				const passEncoder = commandEncoder.beginComputePass();
				passEncoder.setPipeline( this._pipelines.radixScatter );
				passEncoder.setBindGroup( 0, this._sortBindGroups.scatter[ pass ] );
				passEncoder.dispatchWorkgroups( workgroupCount );
				passEncoder.end();

			}

		}

	}

	_getHPLOCMaxIterations( primCount ) {

		if ( primCount <= 1 ) return 1;
		return Math.max( 1, Math.ceil( Math.log2( primCount ) * HPLOC_MAX_ITERATION_FACTOR ) );

	}

	_getRefitMaxIterations( primCount ) {

		if ( primCount <= 1 ) return 1;
		return Math.max( 1, Math.ceil( Math.log2( primCount ) * REFIT_MAX_ITERATION_FACTOR ) );

	}

	async _buildRefitParentMap( waitForCompletion = true ) {

		const primCount = this._primCount;
		if ( primCount === 0 ) return;

		const maxNodes = 2 * primCount;
		const workgroupCount = Math.ceil( maxNodes / 256 );
		const device = this.device;
		const commandEncoder = device.createCommandEncoder();

		const passEncoder = commandEncoder.beginComputePass();
		const bindGroup = device.createBindGroup( {
			layout: this._pipelines.refitBuildParents.getBindGroupLayout( 0 ),
			entries: [
				{ binding: 0, resource: { buffer: this._buildBuffers.bvh2Nodes } },
				{ binding: 1, resource: { buffer: this._buildBuffers.nodeCounter } },
				{ binding: 2, resource: { buffer: this._buildBuffers.parentIdx } },
				{ binding: 3, resource: { buffer: this._buildBuffers.clusterIdx } },
			],
		} );
		passEncoder.setPipeline( this._pipelines.refitBuildParents );
		passEncoder.setBindGroup( 0, bindGroup );
		passEncoder.dispatchWorkgroups( workgroupCount );
		passEncoder.end();

		device.queue.submit( [ commandEncoder.finish() ] );
		this._refitParentsDirty = false;
		if ( waitForCompletion ) {

			await device.queue.onSubmittedWorkDone();

		}

	}

	_getOrCreateRefitBindGroups() {

		const device = this.device;

		// Refit bind group cache (reused for per-frame refit on stable buffer identities).
		const cacheKey = {
			positionBuffer: this._positionBuffer,
			indexBuffer: this._indexBuffer,
			buildBuffers: this._buildBuffers,
			refitLeavesPipeline: this._pipelines.refitLeaves,
			refitInternalPipeline: this._pipelines.refitInternal,
			updateDispatchPipeline: this._pipelines.updateDispatch,
		};
		const prevCacheKey = this._refitBindGroupsCacheKey;
		const needsNewBindGroups = ! this._refitBindGroups || ! prevCacheKey
			|| prevCacheKey.positionBuffer !== cacheKey.positionBuffer
			|| prevCacheKey.indexBuffer !== cacheKey.indexBuffer
			|| prevCacheKey.buildBuffers !== cacheKey.buildBuffers
			|| prevCacheKey.refitLeavesPipeline !== cacheKey.refitLeavesPipeline
			|| prevCacheKey.refitInternalPipeline !== cacheKey.refitInternalPipeline
			|| prevCacheKey.updateDispatchPipeline !== cacheKey.updateDispatchPipeline;

		if ( needsNewBindGroups ) {

			this._refitBindGroupsCacheKey = cacheKey;
			this._refitBindGroups = {
				leaves: device.createBindGroup( {
					layout: this._pipelines.refitLeaves.getBindGroupLayout( 0 ),
					entries: [
						{ binding: 0, resource: { buffer: this._buildBuffers.uniforms, offset: 0, size: 16 } },
						{ binding: 1, resource: { buffer: this._positionBuffer } },
						{ binding: 2, resource: { buffer: this._indexBuffer } },
						{ binding: 3, resource: { buffer: this._buildBuffers.bvh2Nodes } },
						{ binding: 4, resource: { buffer: this._buildBuffers.parentIdx } },
						{ binding: 5, resource: { buffer: this._buildBuffers.refitVisitCount } },
						{ binding: 6, resource: { buffer: this._buildBuffers.activeList0 } },
						{ binding: 7, resource: { buffer: this._buildBuffers.activeCount0 } },
					],
				} ),
				internal_0to1: device.createBindGroup( {
					layout: this._pipelines.refitInternal.getBindGroupLayout( 0 ),
					entries: [
						{ binding: 0, resource: { buffer: this._buildBuffers.bvh2Nodes } },
						{ binding: 1, resource: { buffer: this._buildBuffers.parentIdx } },
						{ binding: 2, resource: { buffer: this._buildBuffers.refitVisitCount } },
						{ binding: 3, resource: { buffer: this._buildBuffers.activeList0 } },
						{ binding: 4, resource: { buffer: this._buildBuffers.activeList1 } },
						{ binding: 5, resource: { buffer: this._buildBuffers.activeCount0 } },
						{ binding: 6, resource: { buffer: this._buildBuffers.activeCount1 } },
					],
				} ),
				internal_1to0: device.createBindGroup( {
					layout: this._pipelines.refitInternal.getBindGroupLayout( 0 ),
					entries: [
						{ binding: 0, resource: { buffer: this._buildBuffers.bvh2Nodes } },
						{ binding: 1, resource: { buffer: this._buildBuffers.parentIdx } },
						{ binding: 2, resource: { buffer: this._buildBuffers.refitVisitCount } },
						{ binding: 3, resource: { buffer: this._buildBuffers.activeList1 } },
						{ binding: 4, resource: { buffer: this._buildBuffers.activeList0 } },
						{ binding: 5, resource: { buffer: this._buildBuffers.activeCount1 } },
						{ binding: 6, resource: { buffer: this._buildBuffers.activeCount0 } },
					],
				} ),
				update_0to1: device.createBindGroup( {
					layout: this._pipelines.updateDispatch.getBindGroupLayout( 0 ),
					entries: [
						{ binding: 0, resource: { buffer: this._buildBuffers.activeCount0 } },
						{ binding: 1, resource: { buffer: this._buildBuffers.indirectDispatch } },
						{ binding: 2, resource: { buffer: this._buildBuffers.activeCount1 } },
					],
				} ),
				update_1to0: device.createBindGroup( {
					layout: this._pipelines.updateDispatch.getBindGroupLayout( 0 ),
					entries: [
						{ binding: 0, resource: { buffer: this._buildBuffers.activeCount1 } },
						{ binding: 1, resource: { buffer: this._buildBuffers.indirectDispatch } },
						{ binding: 2, resource: { buffer: this._buildBuffers.activeCount0 } },
					],
				} ),
			};

		}

		return this._refitBindGroups;

	}

	async _runRefitPass( useFlatten = false, waitForCompletion = true, debugTiming = false ) {

		const primCount = this._primCount;
		if ( primCount === 0 ) return { maxIterations: 0 };

		const device = this.device;
		const uniforms = new Uint32Array( [ primCount, this._positionStride, 0, 0 ] );
		device.queue.writeBuffer( this._buildBuffers.uniforms, 0, uniforms );

		const leafWorkgroupCount = Math.ceil( primCount / 256 );
		const maxIterations = this._getRefitMaxIterations( primCount );
		const commandEncoder = device.createCommandEncoder();

		// Refit only touches active node indices [0, 2 * primCount), so avoid clearing
		// the full capacity-sized buffer when geometry shrinks.
		const maxNodesUsed = Math.max( 1, 2 * primCount );
		commandEncoder.clearBuffer( this._buildBuffers.refitVisitCount, 0, maxNodesUsed * 4 );
		commandEncoder.clearBuffer( this._buildBuffers.activeCount0 );
		commandEncoder.clearBuffer( this._buildBuffers.activeCount1 );
		const bg = this._getOrCreateRefitBindGroups();

		const useGpuTimestamps = debugTiming && waitForCompletion && this._hasTimestampQuery && !! this._timestampBuffers;
		let queryCount = 0;
		let leavesStartIdx = 0;
		let leavesEndIdx = 0;
		let internalStartIdx = 0;
		let internalEndIdx = 0;

		// Multi-dispatch refit:
		// 1) Leaf dispatch updates leaf AABBs and appends ready parents.
		// 2) Internal dispatch waves process appended parents until convergence.
		if ( useGpuTimestamps ) {

			const ts = this._timestampBuffers;
			leavesStartIdx = queryCount ++;
			leavesEndIdx = queryCount ++;
			const leavesPass = commandEncoder.beginComputePass( {
				timestampWrites: {
					querySet: ts.querySet,
					beginningOfPassWriteIndex: leavesStartIdx,
					endOfPassWriteIndex: leavesEndIdx,
				},
			} );
			leavesPass.setPipeline( this._pipelines.refitLeaves );
			leavesPass.setBindGroup( 0, bg.leaves );
			leavesPass.dispatchWorkgroups( leafWorkgroupCount );
			leavesPass.end();

			internalStartIdx = queryCount ++;
			internalEndIdx = queryCount ++;
			const internalPass = commandEncoder.beginComputePass( {
				timestampWrites: {
					querySet: ts.querySet,
					beginningOfPassWriteIndex: internalStartIdx,
					endOfPassWriteIndex: internalEndIdx,
				},
			} );
			for ( let iter = 0; iter < maxIterations; iter ++ ) {

				const use0to1 = ( iter % 2 === 0 );
				internalPass.setPipeline( this._pipelines.updateDispatch );
				internalPass.setBindGroup( 0, use0to1 ? bg.update_0to1 : bg.update_1to0 );
				internalPass.dispatchWorkgroups( 1 );

				internalPass.setPipeline( this._pipelines.refitInternal );
				internalPass.setBindGroup( 0, use0to1 ? bg.internal_0to1 : bg.internal_1to0 );
				internalPass.dispatchWorkgroupsIndirect( this._buildBuffers.indirectDispatch, 0 );

			}

			internalPass.end();

		} else {

			const passEncoder = commandEncoder.beginComputePass();
			passEncoder.setPipeline( this._pipelines.refitLeaves );
			passEncoder.setBindGroup( 0, bg.leaves );
			passEncoder.dispatchWorkgroups( leafWorkgroupCount );

			for ( let iter = 0; iter < maxIterations; iter ++ ) {

				const use0to1 = ( iter % 2 === 0 );
				passEncoder.setPipeline( this._pipelines.updateDispatch );
				passEncoder.setBindGroup( 0, use0to1 ? bg.update_0to1 : bg.update_1to0 );
				passEncoder.dispatchWorkgroups( 1 );

				passEncoder.setPipeline( this._pipelines.refitInternal );
				passEncoder.setBindGroup( 0, use0to1 ? bg.internal_0to1 : bg.internal_1to0 );
				passEncoder.dispatchWorkgroupsIndirect( this._buildBuffers.indirectDispatch, 0 );

			}

			passEncoder.end();

		}

		if ( useFlatten ) {

			this._runFlattenPass( commandEncoder, primCount );

		}

		if ( useGpuTimestamps ) {

			const ts = this._timestampBuffers;
			commandEncoder.resolveQuerySet( ts.querySet, 0, queryCount, ts.resolveBuffer, 0 );
			commandEncoder.copyBufferToBuffer( ts.resolveBuffer, 0, ts.readbackBuffer, 0, queryCount * 8 );

		}

		device.queue.submit( [ commandEncoder.finish() ] );
		if ( waitForCompletion ) {

			await device.queue.onSubmittedWorkDone();

		}

		if ( useGpuTimestamps ) {

			const ts = this._timestampBuffers;
			await ts.readbackBuffer.mapAsync( GPUMapMode.READ );
			const timestamps = new BigUint64Array( ts.readbackBuffer.getMappedRange() );
			const toMs = ( start, end ) => {

				if ( start === 0n || end === 0n || end < start ) return 0;
				return Number( end - start ) / 1000000;

			};

			const refitLeaves = toMs( timestamps[ leavesStartIdx ], timestamps[ leavesEndIdx ] );
			const refitInternal = toMs( timestamps[ internalStartIdx ], timestamps[ internalEndIdx ] );
			ts.readbackBuffer.unmap();

			return {
				maxIterations,
				gpuTimestamps: true,
				refitLeaves,
				refitInternal,
				refitGpuTotal: refitLeaves + refitInternal,
			};

		}

		return { maxIterations, gpuTimestamps: false };

	}

	// Synchronous version - adds dispatches to existing command encoder
	// uniformOffset: optional byte offset into uniforms buffer (for single-submission batching)
	_runHPLOCPassSync( commandEncoder, primCount, offsets = { hploc: 0, initCounters: 0 }, timestampOptions = null ) {

		// Support both old (uniformOffset number) and new (offsets object) calling conventions
		const uniformOffset = typeof offsets === 'number' ? offsets : offsets.hploc;
		const initCountersOffset = typeof offsets === 'number' ? offsets : offsets.initCounters;

		// Always use indirect dispatch - active list tracking reduces total workgroup
		// launches as primitives merge, benefiting all variants (subgroup and fallback alike)
		return this._runHPLOCPassIndirect( commandEncoder, primCount, { hploc: uniformOffset, initCounters: initCountersOffset }, timestampOptions );

	}

	/**
	 * H-PLOC with indirect dispatch - only launches workgroups for active primitives.
	 * Uses ping-pong active lists to track which primitives still need work.
	 * Significantly reduces total workgroup launches due to geometric decay of active count.
	 *
	 * @param {GPUCommandEncoder} commandEncoder
	 * @param {number} primCount
	 * @param {Object} offsets - { hploc, initCounters } uniform buffer offsets
	 * @param {Object} timestampOptions - Optional: { querySet, startIndex, endIndex }
	 */
	_runHPLOCPassIndirect( commandEncoder, primCount, offsets = { hploc: 0, initCounters: 0 }, timestampOptions = null ) {

		const device = this.device;
		const workgroupSize = this._hplocWorkgroupSize;
		const initialWorkgroupCount = Math.ceil( primCount / workgroupSize );

		// Tree depth is ~log2(primCount). Cap is centrally tuned via factor constant.
		const maxIterations = this._getHPLOCMaxIterations( primCount );

		// Support both old (number) and new (object) calling conventions
		const hplocOffset = typeof offsets === 'number' ? offsets : offsets.hploc;
		const initCountersOffset = typeof offsets === 'number' ? offsets : offsets.initCounters;

		// Bind group caching key - invalidate cache when offsets change
		const cacheKey = `${hplocOffset}_${initCountersOffset}`;
		const needsNewBindGroups = ! this._hplocBindGroups || this._hplocBindGroupsCacheKey !== cacheKey;

		if ( needsNewBindGroups ) {

			// Create and cache bind groups (reused across builds with same buffer capacity)
			this._hplocBindGroupsCacheKey = cacheKey;
			this._hplocBindGroups = {
				initCounters: device.createBindGroup( {
					layout: this._pipelines.initIndirectCounters.getBindGroupLayout( 0 ),
					entries: [
						{ binding: 0, resource: { buffer: this._buildBuffers.uniforms, offset: initCountersOffset, size: 16 } },
						{ binding: 1, resource: { buffer: this._buildBuffers.nodeCounter } },
						{ binding: 2, resource: { buffer: this._buildBuffers.activeCount0 } },
						{ binding: 3, resource: { buffer: this._buildBuffers.activeCount1 } },
						{ binding: 4, resource: { buffer: this._buildBuffers.indirectDispatch } },
					],
				} ),
				initActiveList: device.createBindGroup( {
					layout: this._pipelines.initActiveList.getBindGroupLayout( 0 ),
					entries: [
						{ binding: 0, resource: { buffer: this._buildBuffers.uniforms, offset: hplocOffset, size: 16 } },
						{ binding: 1, resource: { buffer: this._buildBuffers.activeList0 } },
					],
				} ),
				hploc_0to1: device.createBindGroup( {
					layout: this._pipelines.hplocIndirect.getBindGroupLayout( 0 ),
					entries: [
						{ binding: 0, resource: { buffer: this._buildBuffers.uniforms, offset: hplocOffset, size: 16 } },
						{ binding: 1, resource: { buffer: this._buildBuffers.mortonCodes } },
						{ binding: 2, resource: { buffer: this._buildBuffers.clusterIdx } },
						{ binding: 3, resource: { buffer: this._buildBuffers.parentIdx } },
						{ binding: 4, resource: { buffer: this._buildBuffers.bvh2Nodes } },
						{ binding: 5, resource: { buffer: this._buildBuffers.nodeCounter } },
						{ binding: 6, resource: { buffer: this._buildBuffers.hplocState } },
						{ binding: 7, resource: { buffer: this._buildBuffers.activeList0 } },
						{ binding: 8, resource: { buffer: this._buildBuffers.activeList1 } },
						{ binding: 9, resource: { buffer: this._buildBuffers.activeCount1 } },
						{ binding: 10, resource: { buffer: this._buildBuffers.activeCount0 } },
					],
				} ),
				hploc_1to0: device.createBindGroup( {
					layout: this._pipelines.hplocIndirect.getBindGroupLayout( 0 ),
					entries: [
						{ binding: 0, resource: { buffer: this._buildBuffers.uniforms, offset: hplocOffset, size: 16 } },
						{ binding: 1, resource: { buffer: this._buildBuffers.mortonCodes } },
						{ binding: 2, resource: { buffer: this._buildBuffers.clusterIdx } },
						{ binding: 3, resource: { buffer: this._buildBuffers.parentIdx } },
						{ binding: 4, resource: { buffer: this._buildBuffers.bvh2Nodes } },
						{ binding: 5, resource: { buffer: this._buildBuffers.nodeCounter } },
						{ binding: 6, resource: { buffer: this._buildBuffers.hplocState } },
						{ binding: 7, resource: { buffer: this._buildBuffers.activeList1 } },
						{ binding: 8, resource: { buffer: this._buildBuffers.activeList0 } },
						{ binding: 9, resource: { buffer: this._buildBuffers.activeCount0 } },
						{ binding: 10, resource: { buffer: this._buildBuffers.activeCount1 } },
					],
				} ),
				update_1to0: device.createBindGroup( {
					layout: this._pipelines.updateDispatch.getBindGroupLayout( 0 ),
					entries: [
						{ binding: 0, resource: { buffer: this._buildBuffers.activeCount1 } },
						{ binding: 1, resource: { buffer: this._buildBuffers.indirectDispatch } },
						{ binding: 2, resource: { buffer: this._buildBuffers.activeCount0 } },
					],
				} ),
				update_0to1: device.createBindGroup( {
					layout: this._pipelines.updateDispatch.getBindGroupLayout( 0 ),
					entries: [
						{ binding: 0, resource: { buffer: this._buildBuffers.activeCount0 } },
						{ binding: 1, resource: { buffer: this._buildBuffers.indirectDispatch } },
						{ binding: 2, resource: { buffer: this._buildBuffers.activeCount1 } },
					],
				} ),
			};

		}

		// Use cached bind groups
		const bg = this._hplocBindGroups;

		// === GPU-BASED COUNTER INITIALIZATION ===
		{

			const passEncoder = commandEncoder.beginComputePass();
			passEncoder.setPipeline( this._pipelines.initIndirectCounters );
			passEncoder.setBindGroup( 0, bg.initCounters );
			passEncoder.dispatchWorkgroups( 1 );
			passEncoder.end();

		}

		// Active list 0 is initialized in computeBounds shader (binding 8)

		// Use cached bind groups for ping-pong iterations
		const hplocBG_0to1 = bg.hploc_0to1;
		const hplocBG_1to0 = bg.hploc_1to0;
		const updateBG_1to0 = bg.update_1to0;
		const updateBG_0to1 = bg.update_0to1;

		// Execute the full indirect iteration sequence in a single compute pass to reduce
		// pass begin/end overhead while preserving dispatch order dependencies.
		const passOptions = timestampOptions ? {
			timestampWrites: {
				querySet: timestampOptions.querySet,
				beginningOfPassWriteIndex: timestampOptions.startIndex,
				endOfPassWriteIndex: timestampOptions.endIndex,
			},
		} : {};
		const passEncoder = commandEncoder.beginComputePass( passOptions );

		// Iteration 0: direct dispatch (all primitives active), output to list1.
		passEncoder.setPipeline( this._pipelines.hplocIndirect );
		passEncoder.setBindGroup( 0, hplocBG_0to1 );
		passEncoder.dispatchWorkgroups( initialWorkgroupCount );

		// Iterations 1..maxIterations-1
		for ( let iter = 1; iter < maxIterations; iter ++ ) {

			const useList1AsInput = ( iter % 2 === 1 );
			passEncoder.setPipeline( this._pipelines.updateDispatch );
			passEncoder.setBindGroup( 0, useList1AsInput ? updateBG_1to0 : updateBG_0to1 );
			passEncoder.dispatchWorkgroups( 1 );

			passEncoder.setPipeline( this._pipelines.hplocIndirect );
			passEncoder.setBindGroup( 0, useList1AsInput ? hplocBG_1to0 : hplocBG_0to1 );
			passEncoder.dispatchWorkgroupsIndirect( this._buildBuffers.indirectDispatch, 0 );

		}

		passEncoder.end();

		return maxIterations;

	}

	// Legacy async version (kept for compatibility)
	async _runHPLOCPass( primCount ) {

		const commandEncoder = this.device.createCommandEncoder();
		const iterations = this._runHPLOCPassSync( commandEncoder, primCount );
		this.device.queue.submit( [ commandEncoder.finish() ] );
		await this.device.queue.onSubmittedWorkDone();
		return iterations;

	}

	/**
	 * DEBUG: Run H-PLOC with indirect dispatch, with step-by-step readback between iterations.
	 * This helps diagnose what's going wrong with the indirect dispatch.
	 */
	async _debugRunHPLOCPassIndirect( primCount, uniformOffset = 0 ) {

		const device = this.device;
		const workgroupSize = this._hplocWorkgroupSize;
		const initialWorkgroupCount = Math.ceil( primCount / workgroupSize );
		const maxIterations = this._getHPLOCMaxIterations( primCount );

		console.log( `[DEBUG H-PLOC Indirect] primCount=${primCount}, workgroupSize=${workgroupSize}, maxIterations=${maxIterations}` );

		// Create readback buffers
		const countReadback = device.createBuffer( {
			size: 8, // 2 x u32 for activeCount0 and activeCount1
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		} );
		const dispatchReadback = device.createBuffer( {
			size: 12, // 3 x u32 for indirect dispatch args
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		} );
		const stateReadback = device.createBuffer( {
			size: Math.min( 64, primCount ) * 16, // First 64 primitives, vec4u each
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		} );
		const activeListReadback = device.createBuffer( {
			size: Math.min( 64, primCount ) * 4, // First 64 entries
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		} );

		// Helper to read buffer contents
		const readU32Buffer = async ( srcBuffer, srcOffset, count, readbackBuffer ) => {

			const enc = device.createCommandEncoder();
			enc.copyBufferToBuffer( srcBuffer, srcOffset, readbackBuffer, 0, count * 4 );
			device.queue.submit( [ enc.finish() ] );
			await device.queue.onSubmittedWorkDone();
			await readbackBuffer.mapAsync( GPUMapMode.READ );
			const data = new Uint32Array( readbackBuffer.getMappedRange().slice( 0 ) );
			readbackBuffer.unmap();
			return data;

		};

		// Active list 0 is initialized in computeBounds shader (binding 8)

		// Initialize counts
		device.queue.writeBuffer( this._buildBuffers.activeCount0, 0, new Uint32Array( [ primCount ] ) );
		device.queue.writeBuffer( this._buildBuffers.activeCount1, 0, new Uint32Array( [ 0 ] ) );
		device.queue.writeBuffer( this._buildBuffers.indirectDispatch, 0, new Uint32Array( [ initialWorkgroupCount, 1, 1 ] ) );

		// Verify initialization
		const activeList0Init = await readU32Buffer( this._buildBuffers.activeList0, 0, Math.min( 16, primCount ), activeListReadback );
		console.log( `[DEBUG] After init - activeList0[0..15]:`, Array.from( activeList0Init ) );

		// Create bind groups
		const createIndirectBindGroup = ( listIn, listOut, countIn, countOut ) => {

			return device.createBindGroup( {
				layout: this._pipelines.hplocIndirect.getBindGroupLayout( 0 ),
				entries: [
					{ binding: 0, resource: { buffer: this._buildBuffers.uniforms, offset: uniformOffset, size: 16 } },
					{ binding: 1, resource: { buffer: this._buildBuffers.mortonCodes } },
					{ binding: 2, resource: { buffer: this._buildBuffers.clusterIdx } },
					{ binding: 3, resource: { buffer: this._buildBuffers.parentIdx } },
					{ binding: 4, resource: { buffer: this._buildBuffers.bvh2Nodes } },
					{ binding: 5, resource: { buffer: this._buildBuffers.nodeCounter } },
					{ binding: 6, resource: { buffer: this._buildBuffers.hplocState } },
					{ binding: 7, resource: { buffer: listIn } },
					{ binding: 8, resource: { buffer: listOut } },
					{ binding: 9, resource: { buffer: countOut } },
					{ binding: 10, resource: { buffer: countIn } },
				],
			} );

		};

		const createUpdateDispatchBindGroup = ( countIn, countOut ) => {

			return device.createBindGroup( {
				layout: this._pipelines.updateDispatch.getBindGroupLayout( 0 ),
				entries: [
					{ binding: 0, resource: { buffer: countIn } },
					{ binding: 1, resource: { buffer: this._buildBuffers.indirectDispatch } },
					{ binding: 2, resource: { buffer: countOut } },
				],
			} );

		};

		const hplocBG_0to1 = createIndirectBindGroup(
			this._buildBuffers.activeList0, this._buildBuffers.activeList1,
			this._buildBuffers.activeCount0, this._buildBuffers.activeCount1
		);
		const hplocBG_1to0 = createIndirectBindGroup(
			this._buildBuffers.activeList1, this._buildBuffers.activeList0,
			this._buildBuffers.activeCount1, this._buildBuffers.activeCount0
		);
		const updateBG_1to0 = createUpdateDispatchBindGroup(
			this._buildBuffers.activeCount1, this._buildBuffers.activeCount0
		);
		const updateBG_0to1 = createUpdateDispatchBindGroup(
			this._buildBuffers.activeCount0, this._buildBuffers.activeCount1
		);

		// Iteration 0: direct dispatch
		{

			const enc = device.createCommandEncoder();
			const passEncoder = enc.beginComputePass();
			passEncoder.setPipeline( this._pipelines.hplocIndirect );
			passEncoder.setBindGroup( 0, hplocBG_0to1 );
			passEncoder.dispatchWorkgroups( initialWorkgroupCount );
			passEncoder.end();
			device.queue.submit( [ enc.finish() ] );
			await device.queue.onSubmittedWorkDone();

		}

		// Check counts after iteration 0
		{

			const enc = device.createCommandEncoder();
			enc.copyBufferToBuffer( this._buildBuffers.activeCount0, 0, countReadback, 0, 4 );
			enc.copyBufferToBuffer( this._buildBuffers.activeCount1, 0, countReadback, 4, 4 );
			device.queue.submit( [ enc.finish() ] );
			await device.queue.onSubmittedWorkDone();
			await countReadback.mapAsync( GPUMapMode.READ );
			const counts = new Uint32Array( countReadback.getMappedRange().slice( 0 ) );
			countReadback.unmap();
			console.log( `[DEBUG] After iter 0: activeCount0=${counts[ 0 ]}, activeCount1=${counts[ 1 ]}` );

			// Read first few state entries - check both beginning and middle of array
			const stateData = await readU32Buffer( this._buildBuffers.hplocState, 0, Math.min( 64, primCount ) * 4, stateReadback );
			console.log( `[DEBUG] After iter 0 - state (first 4):` );
			for ( let i = 0; i < Math.min( 4, primCount ); i ++ ) {

				console.log( `  prim ${i}: left=${stateData[ i * 4 ]}, right=${stateData[ i * 4 + 1 ]}, split=${stateData[ i * 4 + 2 ]}, active=${stateData[ i * 4 + 3 ]}` );

			}

			// Also check some middle entries to see active threads
			console.log( `[DEBUG] After iter 0 - state (sample from middle):` );
			for ( let i = 30; i < Math.min( 34, primCount ); i ++ ) {

				console.log( `  prim ${i}: left=${stateData[ i * 4 ]}, right=${stateData[ i * 4 + 1 ]}, split=${stateData[ i * 4 + 2 ]}, active=${stateData[ i * 4 + 3 ]}` );

			}

			// Read output active list - these are the primitive indices still active
			const numToRead = Math.min( 16, counts[ 1 ] || 1 );
			const activeList1 = await readU32Buffer( this._buildBuffers.activeList1, 0, numToRead, activeListReadback );
			console.log( `[DEBUG] After iter 0 - activeList1[0..${numToRead - 1}] (primIdx values for next iter):`, Array.from( activeList1.slice( 0, numToRead ) ) );

			// Look up state for first few active prims
			if ( counts[ 1 ] > 0 ) {

				console.log( `[DEBUG] State of first few active prims:` );
				for ( let i = 0; i < Math.min( 4, numToRead ); i ++ ) {

					const activePrimIdx = activeList1[ i ];
					if ( activePrimIdx < 64 ) {

						console.log( `  activeList1[${i}]=${activePrimIdx}: left=${stateData[ activePrimIdx * 4 ]}, right=${stateData[ activePrimIdx * 4 + 1 ]}, split=${stateData[ activePrimIdx * 4 + 2 ]}, active=${stateData[ activePrimIdx * 4 + 3 ]}` );

					} else {

						console.log( `  activeList1[${i}]=${activePrimIdx}: (beyond readback range)` );

					}

				}

			}

		}

		// Subsequent iterations
		for ( let iter = 1; iter < Math.min( maxIterations, 5 ); iter ++ ) {

			const useList1AsInput = ( iter % 2 === 1 );

			// Update dispatch
			{

				const enc = device.createCommandEncoder();
				const passEncoder = enc.beginComputePass();
				passEncoder.setPipeline( this._pipelines.updateDispatch );
				passEncoder.setBindGroup( 0, useList1AsInput ? updateBG_1to0 : updateBG_0to1 );
				passEncoder.dispatchWorkgroups( 1 );
				passEncoder.end();
				device.queue.submit( [ enc.finish() ] );
				await device.queue.onSubmittedWorkDone();

			}

			// Read dispatch args
			{

				const enc = device.createCommandEncoder();
				enc.copyBufferToBuffer( this._buildBuffers.indirectDispatch, 0, dispatchReadback, 0, 12 );
				device.queue.submit( [ enc.finish() ] );
				await device.queue.onSubmittedWorkDone();
				await dispatchReadback.mapAsync( GPUMapMode.READ );
				const dispatchArgs = new Uint32Array( dispatchReadback.getMappedRange().slice( 0 ) );
				dispatchReadback.unmap();
				console.log( `[DEBUG] Iter ${iter} dispatch args: [${dispatchArgs[ 0 ]}, ${dispatchArgs[ 1 ]}, ${dispatchArgs[ 2 ]}]` );

			}

			// Indirect dispatch H-PLOC
			{

				const enc = device.createCommandEncoder();
				const passEncoder = enc.beginComputePass();
				passEncoder.setPipeline( this._pipelines.hplocIndirect );
				passEncoder.setBindGroup( 0, useList1AsInput ? hplocBG_1to0 : hplocBG_0to1 );
				passEncoder.dispatchWorkgroupsIndirect( this._buildBuffers.indirectDispatch, 0 );
				passEncoder.end();
				device.queue.submit( [ enc.finish() ] );
				await device.queue.onSubmittedWorkDone();

			}

			// Check counts
			{

				const enc = device.createCommandEncoder();
				enc.copyBufferToBuffer( this._buildBuffers.activeCount0, 0, countReadback, 0, 4 );
				enc.copyBufferToBuffer( this._buildBuffers.activeCount1, 0, countReadback, 4, 4 );
				device.queue.submit( [ enc.finish() ] );
				await device.queue.onSubmittedWorkDone();
				await countReadback.mapAsync( GPUMapMode.READ );
				const counts = new Uint32Array( countReadback.getMappedRange().slice( 0 ) );
				countReadback.unmap();
				console.log( `[DEBUG] After iter ${iter}: activeCount0=${counts[ 0 ]}, activeCount1=${counts[ 1 ]}` );

			}

		}

		// Clean up debug buffers
		countReadback.destroy();
		dispatchReadback.destroy();
		stateReadback.destroy();
		activeListReadback.destroy();

		return maxIterations;

	}

	// _readActiveCount removed - Phase 1 optimization (activeCount was unused overhead)

	_runFlattenPass( commandEncoder, primCount ) {

		if ( primCount === 0 ) return;

		// Note: uniforms (binding 0) is declared but not used in flatten shader,
		// so WebGPU auto-layout excludes it - only pass bindings 1-7

		const passEncoderSizes = commandEncoder.beginComputePass();
		const bindGroupSizes = this.device.createBindGroup( {
			layout: this._pipelines.flattenSize.getBindGroupLayout( 0 ),
			entries: [
				{ binding: 1, resource: { buffer: this._buildBuffers.bvh2Nodes } },
				{ binding: 2, resource: { buffer: this._buildBuffers.clusterIdx } },
				{ binding: 3, resource: { buffer: this._buildBuffers.nodeCounter } },
				{ binding: 4, resource: { buffer: this._buildBuffers.subtreeSizes } },
				{ binding: 5, resource: { buffer: this._buildBuffers.flattenStackNodes } },
				{ binding: 6, resource: { buffer: this._buildBuffers.flattenStackOut } },
			],
		} );

		passEncoderSizes.setPipeline( this._pipelines.flattenSize );
		passEncoderSizes.setBindGroup( 0, bindGroupSizes );
		passEncoderSizes.dispatchWorkgroups( 1 );
		passEncoderSizes.end();

		const passEncoder = commandEncoder.beginComputePass();
		const bindGroup = this.device.createBindGroup( {
			layout: this._pipelines.flatten.getBindGroupLayout( 0 ),
			entries: [
				{ binding: 1, resource: { buffer: this._buildBuffers.bvh2Nodes } },
				{ binding: 2, resource: { buffer: this._buildBuffers.clusterIdx } },
				{ binding: 3, resource: { buffer: this._buildBuffers.nodeCounter } },
				{ binding: 4, resource: { buffer: this._buildBuffers.subtreeSizes } },
				{ binding: 5, resource: { buffer: this._buildBuffers.flattenStackNodes } },
				{ binding: 6, resource: { buffer: this._buildBuffers.flattenStackOut } },
				{ binding: 7, resource: { buffer: this._bvhBuffer } },
			],
		} );

		passEncoder.setPipeline( this._pipelines.flatten );
		passEncoder.setBindGroup( 0, bindGroup );
		passEncoder.dispatchWorkgroups( 1 );
		passEncoder.end();

	}

	async _readNodeCount() {

		const readBuffer = this.device.createBuffer( {
			size: 4,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		} );

		const commandEncoder = this.device.createCommandEncoder();
		commandEncoder.copyBufferToBuffer(
			this._buildBuffers.nodeCounter, 0,
			readBuffer, 0, 4
		);
		this.device.queue.submit( [ commandEncoder.finish() ] );

		await readBuffer.mapAsync( GPUMapMode.READ );
		let count = new Uint32Array( readBuffer.getMappedRange() )[ 0 ];
		readBuffer.unmap();
		readBuffer.destroy();

		// Clamp to max possible nodes (safety for shader race conditions)
		const maxNodes = 2 * this._primCount;
		count = Math.min( count, maxNodes );

		return count;

	}

	async _readRootIndex() {

		// Root index is stored in clusterIdx[0] after H-PLOC completes
		const readBuffer = this.device.createBuffer( {
			size: 4,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		} );

		const commandEncoder = this.device.createCommandEncoder();
		commandEncoder.copyBufferToBuffer(
			this._buildBuffers.clusterIdx, 0,
			readBuffer, 0, 4
		);
		this.device.queue.submit( [ commandEncoder.finish() ] );

		await readBuffer.mapAsync( GPUMapMode.READ );
		const rootIndex = new Uint32Array( readBuffer.getMappedRange() )[ 0 ];
		readBuffer.unmap();
		readBuffer.destroy();

		return rootIndex;

	}

	/**
	 * Helper to compute next power of 2 >= n
	 */
	_nextPowerOf2( n ) {

		if ( n <= 0 ) return 1;
		n --;
		n |= n >> 1;
		n |= n >> 2;
		n |= n >> 4;
		n |= n >> 8;
		n |= n >> 16;
		return n + 1;

	}

}
