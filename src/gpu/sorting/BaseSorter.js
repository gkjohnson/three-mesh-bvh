/**
 * Base class for GPU sorting implementations.
 * All sorters must implement this interface.
 */
export class BaseSorter {

	constructor( device ) {

		this.device = device;
		this.name = 'BaseSorter';
		this._initialized = false;

	}

	/**
	 * Initialize the sorter (create pipelines, allocate buffers)
	 * @param {number} maxKeys - Maximum number of keys to sort
	 * @returns {Promise<void>}
	 */
	async init( _maxKeys ) {

		void _maxKeys;
		throw new Error( 'BaseSorter.init() must be implemented by subclass' );

	}

	/**
	 * Sort keys and values in place (or into output buffers)
	 * @param {Object} params
	 * @param {GPUCommandEncoder} params.commandEncoder - Command encoder to record commands to
	 * @param {GPUBuffer} params.keysIn - Input keys buffer
	 * @param {GPUBuffer} params.keysOut - Output keys buffer (may be same as keysIn)
	 * @param {GPUBuffer} params.valsIn - Input values buffer
	 * @param {GPUBuffer} params.valsOut - Output values buffer (may be same as valsIn)
	 * @param {number} params.count - Number of elements to sort
	 * @param {GPUBuffer} [params.uniforms] - Optional uniforms buffer
	 * @param {number} [params.uniformOffset] - Offset into uniforms buffer
	 * @returns {Object} - { keysResult, valsResult } - buffers containing sorted results
	 */
	sort( _params ) {

		void _params;
		throw new Error( 'BaseSorter.sort() must be implemented by subclass' );

	}

	/**
	 * Dispose of GPU resources
	 */
	dispose() {

		// Override in subclass

	}

	/**
	 * Get timing information from last sort (if available)
	 * @returns {Object|null}
	 */
	getTimings() {

		return null;

	}

}
