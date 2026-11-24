/** @import { BufferGeometry } from 'three' */
import { Box3 } from 'three';
import { MeshBVH } from '../core/MeshBVH.js';
import { WorkerBase } from './utils/WorkerBase.js';
import { copyRange } from './utils/rangeUtils.js';
import { convertToBufferType, copyAttributeArray, isSharedArrayBufferSupported, offsetArray } from '../utils/BufferUtils.js';
import { GenerateMeshBVHWorker } from './GenerateMeshBVHWorker.js';
import { ensureIndex } from '../core/build/geometryUtils.js';
import { DEFAULT_OPTIONS } from '../core/Constants.js';

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

		options = {
			...DEFAULT_OPTIONS,
			...options,
		};

		return new Promise( ( resolve, reject ) => {

			const { range } = options;
			if ( ! options.indirect ) {

				ensureIndex( geometry, options );

			}

			const indexAttribute = geometry.index;

			// the first index and vertex sent to the worker
			let indexStart = 0;
			let vertexStart = 0;

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

					if ( range ) {

						bvh.shiftPrimitiveOffsets( indexStart / 3 );

					}

					if ( serialized.index && ! bvh.indirect ) {

						// the build reordered a copy of the index so write it back
						offsetArray( serialized.index, vertexStart );
						indexAttribute.array.set( serialized.index, indexStart );

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

			// the position is only read so it's shared if possible, while the index is always copied
			// since non-indirect builds reorder it
			const positionAttribute = geometry.attributes.position;
			let index, position;
			if ( range ) {

				( { index, position, indexStart, vertexStart } = copyRange( geometry, range, SharedArrayBuffer ) );

			} else {

				index = indexAttribute ? copyAttributeArray( indexAttribute, SharedArrayBuffer ) : null;
				position = positionAttribute.isInterleavedBufferAttribute ?
					copyAttributeArray( positionAttribute, SharedArrayBuffer ) :
					convertToBufferType( positionAttribute.array, SharedArrayBuffer );

			}

			worker.postMessage( {

				operation: 'BUILD_BVH',
				maxWorkerCount: this.maxWorkerCount,
				index,
				position,
				normalized: positionAttribute.normalized,
				options: {
					...options,
					range: null,
					onProgress: null,
					includedProgressCallback: Boolean( options.onProgress ),
					groups: geometry.groups.map( group => ( { ...group, start: group.start - indexStart } ) ),
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
 *
 * @note With a `range`, only its triangles and the vertices they span are copied, so separate
 * ranges of one geometry can be built at the same time. The ranges must not overlap.
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
