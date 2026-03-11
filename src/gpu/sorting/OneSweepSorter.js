/**
 * OneSweep Radix Sort - High-performance GPU sorting
 * Based on Thomas Smith's GPUSorting library
 * https://github.com/b0nes164/GPUSorting
 *
 * Adapted for three-mesh-bvh by following the webgpu-sorting port.
 * Uses subgroup operations for maximum performance.
 */
import { BaseSorter } from './BaseSorter.js';
import {
	oneSweep16Shader,
	oneSweep32Shader,
	oneSweep64Shader,
	subgroupDetectShader,
} from './shaders/onesweep.wgsl.js';

const SORT_PASSES = 4;
const BLOCK_DIM = 256;
const RADIX = 256;
const RADIX_LOG = 8;
const KEYS_PER_THREAD = 15;
const REDUCE_BLOCK_DIM = 128;
const REDUCE_KEYS_PER_THREAD = 30;
const STATUS_LENGTH = 4; // 0=global_hist, 1=scan, 2=pass, 3=lane_count

export class OneSweepSorter extends BaseSorter {

	constructor( device ) {

		super( device );
		this.name = 'OneSweep';
		this._pipelines = null;
		this._buffers = null;
		this._bindGroupLayout = null;
		this._maxKeys = 0;
		this._subgroupSize = 0;
		this._shaderVariantLabel = '';

		this.blockDim = BLOCK_DIM;
		this.reduceBlockDim = REDUCE_BLOCK_DIM;
		this.partSize = this.blockDim * KEYS_PER_THREAD;
		this.reducePartSize = this.reduceBlockDim * REDUCE_KEYS_PER_THREAD;

		// Pre-allocate small buffer for FLAG_INCLUSIVE initialization (256 u32s)
		// Avoids large allocation every sort() call
		const FLAG_INCLUSIVE = 2;
		this._flagInclusiveBlock = new Uint32Array( RADIX );
		this._flagInclusiveBlock.fill( FLAG_INCLUSIVE );

		// Pre-allocate buffer for pass info uploads (4 passes × 4 u32s)
		this._infoUploadData = new Uint32Array( SORT_PASSES * 4 );

	}

	async init( maxKeys ) {

		this._maxKeys = maxKeys;
		const device = this.device;

		// Detect subgroup size
		const subgroupSize = await this._detectSubgroupSize();
		const { shaderSource, label } = this._selectShaderVariant( subgroupSize );
		this._shaderVariantLabel = label;

		// Create shader module
		const shaderModule = device.createShaderModule( {
			label: `OneSweep Shader (${label})`,
			code: shaderSource,
		} );

		// Check for compilation errors
		const compilationInfo = await shaderModule.getCompilationInfo();
		for ( const msg of compilationInfo.messages ) {

			if ( msg.type === 'error' ) {

				throw new Error( `OneSweep shader compilation error: ${msg.message} at line ${msg.lineNum}` );

			}

		}

		// Create bind group layout
		this._bindGroupLayout = device.createBindGroupLayout( {
			entries: [
				{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
				{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
				{ binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
				{ binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
				{ binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
				{ binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
				{ binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
				{ binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
			],
		} );

		const pipelineLayout = device.createPipelineLayout( {
			bindGroupLayouts: [ this._bindGroupLayout ],
		} );

		// Create pipelines
		this._pipelines = {
			globalHist: device.createComputePipeline( {
				layout: pipelineLayout,
				compute: { module: shaderModule, entryPoint: 'global_hist' },
			} ),
			scan: device.createComputePipeline( {
				layout: pipelineLayout,
				compute: { module: shaderModule, entryPoint: 'onesweep_scan' },
			} ),
			pass: device.createComputePipeline( {
				layout: pipelineLayout,
				compute: { module: shaderModule, entryPoint: 'onesweep_pass' },
			} ),
		};

		// Create internal buffers
		this._createBuffers( maxKeys );

		this._initialized = true;

	}

	_createBuffers( maxKeys ) {

		const device = this.device;
		const threadBlocks = Math.ceil( maxKeys / this.partSize );

		// Destroy old buffers if present
		if ( this._buffers ) {

			for ( const key in this._buffers ) {

				this._buffers[ key ]?.destroy();

			}

		}

		this._buffers = {
			// Internal alt buffers for ping-pong
			altKeys: device.createBuffer( {
				size: Math.max( 16, maxKeys * 4 ),
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
			} ),
			altVals: device.createBuffer( {
				size: Math.max( 16, maxKeys * 4 ),
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
			} ),

			// Bump counter for workgroup scheduling
			bump: device.createBuffer( {
				size: ( SORT_PASSES + 1 ) * 4,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			} ),

			// Global histogram
			hist: device.createBuffer( {
				size: RADIX * SORT_PASSES * 4,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			} ),

			// Per-block histograms for decoupled lookback
			passHist: device.createBuffer( {
				size: threadBlocks * RADIX * SORT_PASSES * 4,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			} ),

			// Status/error buffer
			status: device.createBuffer( {
				size: STATUS_LENGTH * 4,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
			} ),

			// Uniforms
			info: device.createBuffer( {
				size: 16,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			} ),

			// Upload buffer for info data (all 4 passes)
			infoUpload: device.createBuffer( {
				size: 16 * SORT_PASSES,
				usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
			} ),

			// Staging buffer for FLAG_INCLUSIVE initialization (256 u32s per pass = 1024 u32s total)
			// Used to avoid race between writeBuffer (immediate) and clearBuffer (recorded)
			flagInclusiveStaging: device.createBuffer( {
				size: RADIX * SORT_PASSES * 4,
				usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
			} ),
		};

	}

	/**
	 * Sort using command encoder (records commands, doesn't submit)
	 */
	sort( params ) {

		const { commandEncoder, keysIn, valsIn, count } = params;
		const device = this.device;

		// Reallocate if needed
		if ( count > this._maxKeys ) {

			this._maxKeys = count;
			this._createBuffers( count );

		}

		const threadBlocks = Math.ceil( count / this.partSize );

		// Initialize bump counters
		commandEncoder.clearBuffer( this._buffers.bump );

		// Initialize hist
		commandEncoder.clearBuffer( this._buffers.hist );

		// Initialize status
		commandEncoder.clearBuffer( this._buffers.status );

		// Initialize passHist: clear to 0, then set FLAG_INCLUSIVE for first block of each pass
		// This avoids allocating/uploading a huge array every build (was ~324KB for 300k tris)
		commandEncoder.clearBuffer( this._buffers.passHist );

		// Write FLAG_INCLUSIVE (256 u32s) at the start of each pass's section
		// Use staging buffer + copyBufferToBuffer to avoid race condition:
		// writeBuffer is IMMEDIATE while clearBuffer is RECORDED, so direct writeBuffer
		// would be wiped by the clearBuffer when the command encoder executes.
		// By using copyBufferToBuffer (recorded), FLAG_INCLUSIVE copies happen AFTER the clear.
		const passHistStrideBytes = threadBlocks * RADIX * 4;
		const stagingStrideBytes = RADIX * 4; // 256 * 4 = 1024 bytes per pass

		// Upload FLAG_INCLUSIVE data to staging buffer (immediate, but to staging not passHist)
		for ( let pass = 0; pass < SORT_PASSES; pass ++ ) {

			device.queue.writeBuffer(
				this._buffers.flagInclusiveStaging,
				pass * stagingStrideBytes,
				this._flagInclusiveBlock
			);

		}

		// Copy from staging to passHist (recorded, executes AFTER clearBuffer)
		for ( let pass = 0; pass < SORT_PASSES; pass ++ ) {

			commandEncoder.copyBufferToBuffer(
				this._buffers.flagInclusiveStaging, pass * stagingStrideBytes,
				this._buffers.passHist, pass * passHistStrideBytes,
				stagingStrideBytes
			);

		}

		// Pre-upload all pass info (using pre-allocated buffer to avoid GC pressure)
		for ( let pass = 0; pass < SORT_PASSES; pass ++ ) {

			const offset = pass * 4;
			this._infoUploadData[ offset + 0 ] = count;
			this._infoUploadData[ offset + 1 ] = pass * RADIX_LOG; // shift
			this._infoUploadData[ offset + 2 ] = threadBlocks;
			this._infoUploadData[ offset + 3 ] = 0;

		}

		device.queue.writeBuffer( this._buffers.infoUpload, 0, this._infoUploadData );

		// Execute passes
		// Buffer ping-pong: even passes read from keysIn/valsIn, write to alt
		// odd passes read from alt, write to keysIn/valsIn
		for ( let pass = 0; pass < SORT_PASSES; pass ++ ) {

			// Copy info for this pass
			commandEncoder.copyBufferToBuffer(
				this._buffers.infoUpload, pass * 16,
				this._buffers.info, 0, 16
			);

			const isEven = pass % 2 === 0;
			const sortIn = isEven ? keysIn : this._buffers.altKeys;
			const sortOut = isEven ? this._buffers.altKeys : keysIn;
			const payloadIn = isEven ? valsIn : this._buffers.altVals;
			const payloadOut = isEven ? this._buffers.altVals : valsIn;

			const bindGroup = device.createBindGroup( {
				layout: this._bindGroupLayout,
				entries: [
					{ binding: 0, resource: { buffer: this._buffers.info } },
					{ binding: 1, resource: { buffer: this._buffers.bump } },
					{ binding: 2, resource: { buffer: sortIn } },
					{ binding: 3, resource: { buffer: sortOut } },
					{ binding: 4, resource: { buffer: payloadIn } },
					{ binding: 5, resource: { buffer: payloadOut } },
					{ binding: 6, resource: { buffer: this._buffers.hist } },
					{ binding: 7, resource: { buffer: this._buffers.passHist } },
					{ binding: 8, resource: { buffer: this._buffers.status } },
				],
			} );

			// Global histogram (only on first pass)
			if ( pass === 0 ) {

				const passEncoder = commandEncoder.beginComputePass();
				passEncoder.setPipeline( this._pipelines.globalHist );
				passEncoder.setBindGroup( 0, bindGroup );
				const globalHistBlocks = Math.ceil( count / this.reducePartSize );
				passEncoder.dispatchWorkgroups( globalHistBlocks );
				passEncoder.end();

			}

			// Scan
			{

				const passEncoder = commandEncoder.beginComputePass();
				passEncoder.setPipeline( this._pipelines.scan );
				passEncoder.setBindGroup( 0, bindGroup );
				passEncoder.dispatchWorkgroups( 1 );
				passEncoder.end();

			}

			// OneSweep pass
			{

				const passEncoder = commandEncoder.beginComputePass();
				passEncoder.setPipeline( this._pipelines.pass );
				passEncoder.setBindGroup( 0, bindGroup );
				passEncoder.dispatchWorkgroups( threadBlocks );
				passEncoder.end();

			}

		}

		// After 4 passes (even number), result is back in keysIn/valsIn
		return { keysResult: keysIn, valsResult: valsIn };

	}

	async _detectSubgroupSize() {

		if ( this._subgroupSize > 0 ) {

			return this._subgroupSize;

		}

		const device = this.device;

		const module = device.createShaderModule( {
			label: 'Subgroup Probe',
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

		try {

			await stagingBuffer.mapAsync( GPUMapMode.READ );
			const detected = new Uint32Array( stagingBuffer.getMappedRange() )[ 0 ];
			stagingBuffer.unmap();
			this._subgroupSize = detected !== 0 ? detected : 16;

		} finally {

			stagingBuffer.destroy();
			outputBuffer.destroy();

		}

		return this._subgroupSize;

	}

	_selectShaderVariant( size ) {

		// Strict shader selection based on subgroup size:
		// - wave64: uses vec4 masks, works for any size > 32
		// - wave32: requires exactly 32 (MIN_SUBGROUP_SIZE = 32 in shader)
		// - wave16: works for 16-32 (MIN_SUBGROUP_SIZE = 16 in shader)
		if ( size > 32 ) {

			return { shaderSource: oneSweep64Shader, label: 'wave64' };

		}

		if ( size === 32 ) {

			return { shaderSource: oneSweep32Shader, label: 'wave32' };

		}

		if ( size >= 16 ) {

			return { shaderSource: oneSweep16Shader, label: 'wave16' };

		}

		console.warn( `OneSweepSorter: detected subgroup size ${size}, below minimum (16). Forcing wave16.` );
		return { shaderSource: oneSweep16Shader, label: 'wave16 (forced)' };

	}

	dispose() {

		if ( this._buffers ) {

			for ( const key in this._buffers ) {

				this._buffers[ key ]?.destroy();

			}

			this._buffers = null;

		}

	}

	// Minimal validation getters (added for debugging)
	get subgroupSize() {

		return this._subgroupSize;

	}

	get shaderVariant() {

		return this._shaderVariantLabel;

	}

}
