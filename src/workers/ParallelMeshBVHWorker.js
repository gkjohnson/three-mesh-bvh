/** @import { BufferGeometry } from 'three' */
import { Box3, BufferAttribute } from 'three';
import { MeshBVH } from '../core/MeshBVH.js';
import { WorkerBase } from './utils/WorkerBase.js';
import { convertToBufferType, copyAttributeArray, isSharedArrayBufferSupported } from '../utils/BufferUtils.js';
import { GenerateMeshBVHWorker } from './GenerateMeshBVHWorker.js';
import { ensureIndex } from '../core/build/geometryUtils.js';

let _fallbackUrl = null;

const DEFAULT_WORKER_COUNT = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4;
class _ParallelMeshBVHWorker extends WorkerBase {

	constructor() {

		super();

		this.name = 'ParallelMeshBVHWorker';

		/**
		 * Maximum number of parallel workers to use. Defaults to `navigator.hardwareConcurrency` (minimum 4).
		 * @type {number}
		 */
		this.maxWorkerCount = Math.max( DEFAULT_WORKER_COUNT, 4 );

		if ( ! isSharedArrayBufferSupported() ) {

			throw new Error( 'ParallelMeshBVHWorker: Shared Array Buffers are not supported.' );

		}

	}

	getWorker() {

		return new Worker( new URL( './parallelMeshBVH.worker.js', import.meta.url ), { type: 'module' } );

	}

	async getFallbackWorker() {

		// load the bundled script through a blob url so it works from another origin
		_fallbackUrl = _fallbackUrl || fetch( new URL( './parallelMeshBVH.bundled.worker.js', import.meta.url ) )
			.then( response => {

				if ( ! response.ok ) {

					throw new Error( 'ParallelMeshBVHWorker: Could not load the bundled worker.' );

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

	runTask( worker, geometry, options = {} ) {

		return new Promise( ( resolve, reject ) => {

			if ( ! options.indirect ) {

				ensureIndex( geometry, options );

			}

			if ( geometry.index && geometry.index.isInterleavedBufferAttribute ) {

				throw new Error( 'ParallelMeshBVHWorker: InterleavedBufferAttribute is not supported for the index attribute.' );

			}

			let { transferBuffers = false } = options;
			if ( transferBuffers && geometry.attributes.position.isInterleavedBufferAttribute ) {

				console.warn( 'ParallelMeshBVHWorker: An interleaved position attribute cannot be transferred. Copying the buffers instead.' );
				transferBuffers = false;

			}

			const indexAttribute = geometry.index;

			worker.onerror = e => {

				reject( new Error( `ParallelMeshBVHWorker: ${ e.message }` ) );

			};

			worker.onmessage = e => {

				const { data } = e;

				if ( data.error ) {

					reject( new Error( data.error ) );
					worker.onmessage = null;

				} else if ( data.serialized ) {

					const { serialized, position } = data;
					const bvh = MeshBVH.deserialize( serialized, geometry, { setIndex: false } );
					const boundsOptions = {
						setBoundingBox: true,
						...options,
					};

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
							indexAttribute.array.set( serialized.index );
							indexAttribute.needsUpdate = true;

						}

					}

					if ( boundsOptions.setBoundingBox ) {

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

				index = convertToBufferType( geometry.index ? geometry.index.array : null, SharedArrayBuffer );
				position = convertToBufferType( geometry.attributes.position.array, SharedArrayBuffer );

			} else {

				index = geometry.index ? copyAttributeArray( geometry.index, SharedArrayBuffer ) : null;
				position = copyAttributeArray( geometry.attributes.position, SharedArrayBuffer );

			}

			worker.postMessage( {

				operation: 'BUILD_BVH',
				maxWorkerCount: this.maxWorkerCount,
				index,
				position,
				normalized: geometry.attributes.position.normalized,
				options: {
					...options,
					onProgress: null,
					includedProgressCallback: Boolean( options.onProgress ),
					groups: [ ...geometry.groups ],
				},

			} );

		} );

	}

}

/**
 * A drop-in replacement for `GenerateMeshBVHWorker` that distributes BVH construction across
 * multiple Web Workers in parallel for faster builds on large geometry. Requires
 * `SharedArrayBuffer` support (cross-origin isolated context). Falls back to a single-threaded
 * `GenerateMeshBVHWorker` automatically if `SharedArrayBuffer` is unavailable. A parallel build
 * transfers nothing: the geometry arrays are copied into `SharedArrayBuffers` for it. With
 * `transferBuffers` set, arrays that already use a `SharedArrayBuffer` are shared without a copy,
 * and the others are replaced by their copies when the build finishes.
 *
 * Exposes the same API as `GenerateMeshBVHWorker`: `generate`, `dispose`, `running`, and
 * `maxWorkerCount`.
 */
export class ParallelMeshBVHWorker {

	/**
	 * Constructs the worker. If `SharedArrayBuffer` is supported, spawns a parallel worker
	 * capable of using up to `maxWorkerCount` threads. Otherwise, logs a warning and returns a
	 * `GenerateMeshBVHWorker` instance instead.
	 */
	constructor() {

		if ( isSharedArrayBufferSupported() ) {

			return new _ParallelMeshBVHWorker();

		} else {

			console.warn( 'ParallelMeshBVHWorker: SharedArrayBuffers not supported. Falling back to single-threaded GenerateMeshBVHWorker.' );

			const object = new GenerateMeshBVHWorker();
			object.maxWorkerCount = DEFAULT_WORKER_COUNT;
			return object;

		}

	}

}
