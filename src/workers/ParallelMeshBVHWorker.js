/** @import { BufferGeometry } from 'three' */
import { Box3 } from 'three';
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

					const { serialized } = data;
					const bvh = MeshBVH.deserialize( serialized, geometry, { setIndex: false } );
					const boundsOptions = {
						setBoundingBox: true,
						...options,
					};

					if ( indexAttribute && ! bvh.indirect ) {

						// the build reordered a copy of the index so write it back
						indexAttribute.array.set( serialized.index );

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

			// the position is only read so it's shared if possible, while the index is always copied
			// since non-indirect builds reorder it
			const positionAttribute = geometry.attributes.position;
			const position = positionAttribute.isInterleavedBufferAttribute ?
				copyAttributeArray( positionAttribute, SharedArrayBuffer ) :
				convertToBufferType( positionAttribute.array, SharedArrayBuffer );
			const index = indexAttribute ? copyAttributeArray( indexAttribute, SharedArrayBuffer ) : null;

			worker.postMessage( {

				operation: 'BUILD_BVH',
				maxWorkerCount: this.maxWorkerCount,
				index,
				position,
				normalized: positionAttribute.normalized,
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
 * shares the position array if it already uses a `SharedArrayBuffer` and copies it otherwise.
 * The index is always copied and written back to the original array when the build finishes.
 * `transferBuffers` only applies to the fallback.
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
