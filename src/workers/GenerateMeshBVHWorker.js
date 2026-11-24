/** @import { BufferGeometry } from 'three' */
import { Box3, BufferAttribute } from 'three';
import { MeshBVH } from '../core/MeshBVH.js';
import { WorkerBase } from './utils/WorkerBase.js';
import { copyRange } from './utils/rangeUtils.js';
import { copyAttributeArray, offsetArray } from '../utils/BufferUtils.js';
import { ensureIndex } from '../core/build/geometryUtils.js';
import { DEFAULT_OPTIONS } from '../core/Constants.js';

let _fallbackUrl = null;

/**
 * Helper class for generating a MeshBVH for a given geometry in asynchronously in a worker. The
 * geometry position and index arrays are copied to the Worker so the geometry can still be read
 * while the BVH is being generated, and the reordered index is written back to the geometry's
 * original index array when it finishes. If `transferBuffers` is set the array `ArrayBuffers` are
 * transferred instead, meaning the geometry will be unavailable to use while the BVH is being
 * processed unless `SharedArrayBuffers` are used. They will be automatically replaced when the
 * MeshBVH is finished generating.
 *
 * If the worker module can't be loaded, such as when the library is loaded from a CDN on another
 * origin or the worker can't resolve the "three" import, a pre-bundled copy of the worker script
 * with three.js included is loaded through a blob url instead.
 *
 * @note It's best to reuse a single instance of this class to avoid the overhead of instantiating
 * a new Worker.
 *
 * @extends WorkerBase
 */
export class GenerateMeshBVHWorker extends WorkerBase {

	constructor() {

		super();
		this.name = 'GenerateMeshBVHWorker';

	}

	getWorker() {

		return new Worker( new URL( './generateMeshBVH.worker.js', import.meta.url ), { type: 'module' } );

	}

	async getFallbackWorker() {

		// load the bundled script through a blob url so it works from another origin
		_fallbackUrl = _fallbackUrl || fetch( new URL( './generateMeshBVH.bundled.worker.js', import.meta.url ) )
			.then( response => {

				if ( ! response.ok ) {

					throw new Error( 'GenerateMeshBVHWorker: Could not load the bundled worker.' );

				}

				return response.blob();

			} )
			.then( blob => URL.createObjectURL( blob ) )
			.catch( error => {

				// allow a later worker to retry
				_fallbackUrl = null;
				throw error;

			} );

		return new Worker( await _fallbackUrl );

	}

	/**
	 * Flag indicating whether or not a BVH is already being generated in the worker.
	 * @name running
	 * @memberof GenerateMeshBVHWorker
	 * @instance
	 * @type {boolean}
	 */

	/**
	 * Generates a `MeshBVH` instance for the given geometry with the given options in a WebWorker.
	 * Returns a Promise that resolves with the generated `MeshBVH`. Throws if already running.
	 * By default the geometry can still be read during the build, but its position and index
	 * arrays must not be modified until the promise resolves.
	 *
	 * @name generate
	 * @memberof GenerateMeshBVHWorker
	 * @instance
	 * @function
	 * @param {BufferGeometry} geometry
	 * @param {Object} [options] - Same options accepted by the `MeshBVH` constructor.
	 * @param {function(number): void} [options.onProgress] - Callback invoked with a `[0, 1]`
	 *   progress value as the BVH is built.
	 * @param {boolean} [options.transferBuffers=false] - If true the position and index
	 *   `ArrayBuffers` are transferred to the worker rather than copied, avoiding the copy but
	 *   leaving the geometry unusable until the build finishes. Any other attribute stored in the
	 *   same `ArrayBuffer` is detached as well. Ignored with a warning for an interleaved position
	 *   attribute or a `range`.
	 * @returns {Promise<MeshBVH>}
	 * @note With a `range`, only its triangles and the vertices they span are copied, so separate
	 * ranges of one geometry can be built at the same time. The ranges must not overlap.
	 */

	/**
	 * Terminates the worker.
	 *
	 * @name dispose
	 * @memberof GenerateMeshBVHWorker
	 * @instance
	 * @function
	 */

	runTask( worker, geometry, options = {} ) {

		options = {
			...DEFAULT_OPTIONS,
			transferBuffers: false,
			...options,
		};

		return new Promise( ( resolve, reject ) => {

			const { range } = options;
			let { transferBuffers } = options;
			if ( transferBuffers && ( range || geometry.attributes.position.isInterleavedBufferAttribute ) ) {

				console.warn( 'GenerateMeshBVHWorker: An interleaved position attribute or a range cannot be transferred. Copying the buffers instead.' );
				transferBuffers = false;

			}

			// the worker can't create the index since it only gets the range
			if ( range && ! options.indirect ) {

				ensureIndex( geometry, options );

			}

			const indexAttribute = geometry.index;

			// the first index and vertex sent to the worker
			let indexStart = 0;
			let vertexStart = 0;

			worker.onerror = e => {

				reject( new Error( `GenerateMeshBVHWorker: ${ e.message }` ) );

			};

			worker.onmessage = e => {

				const { data } = e;

				if ( data.error ) {

					reject( new Error( data.error ) );
					worker.onmessage = null;

				} else if ( data.serialized ) {

					const { serialized, position } = data;
					const bvh = MeshBVH.deserialize( serialized, geometry, { setIndex: false } );

					if ( range ) {

						bvh.shiftPrimitiveOffsets( indexStart / 3 );

					}

					if ( transferBuffers ) {

						// we need to replace the arrays because they're neutered entirely by the
						// webworker transfer.
						geometry.attributes.position.array = position;

					}

					if ( serialized.index ) {

						if ( ! indexAttribute ) {

							const newIndex = new BufferAttribute( serialized.index, 1, false );
							geometry.setIndex( newIndex );

						} else if ( transferBuffers ) {

							indexAttribute.array = serialized.index;

						} else if ( ! bvh.indirect ) {

							// the build reordered a copy of the index so write it back
							offsetArray( serialized.index, vertexStart );
							indexAttribute.array.set( serialized.index, indexStart );

						}

					}

					if ( options.setBoundingBox ) {

						geometry.boundingBox = bvh.getBoundingBox( new Box3() );

					}

					if ( options.onProgress ) {

						options.onProgress( data.progress );

					}

					resolve( bvh );
					worker.onmessage = null;

				} else if ( options.onProgress ) {

					options.onProgress( data.progress );

				}

			};

			let index, position;
			if ( transferBuffers ) {

				index = geometry.index ? geometry.index.array : null;
				position = geometry.attributes.position.array;

			} else if ( range ) {

				( { index, position, indexStart, vertexStart } = copyRange( geometry, range ) );

			} else {

				index = geometry.index ? copyAttributeArray( geometry.index ) : null;
				position = copyAttributeArray( geometry.attributes.position );

			}

			const transferable = [ position ];
			if ( index ) {

				transferable.push( index );

			}

			worker.postMessage( {

				index,
				position,
				normalized: geometry.attributes.position.normalized,
				options: {
					...options,
					range: null,
					onProgress: null,
					includedProgressCallback: Boolean( options.onProgress ),
					groups: geometry.groups.map( group => ( { ...group, start: group.start - indexStart } ) ),
				},

			}, transferable.map( arr => arr.buffer ).filter( v => ( typeof SharedArrayBuffer === 'undefined' ) || ! ( v instanceof SharedArrayBuffer ) ) );

		} );

	}

}
