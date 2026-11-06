/** @import { BufferGeometry } from 'three' */
import { Box3, BufferAttribute } from 'three';
import { MeshBVH } from '../core/MeshBVH.js';
import { WorkerBase } from './utils/WorkerBase.js';

/**
 * Helper class for generating a MeshBVH for a given geometry in asynchronously in a worker. The
 * geometry position and index buffer attribute `ArrayBuffers` are transferred to the Worker while
 * the BVH is being generated meaning the geometry will be unavailable to use while the BVH is
 * being processed unless `SharedArrayBuffers` are used. For an interleaved position attribute this
 * includes every attribute stored in the same interleaved buffer. They will be automatically
 * replaced when the MeshBVH is finished generating or the build fails.
 *
 * @note It's best to reuse a single instance of this class to avoid the overhead of instantiating
 * a new Worker.
 *
 * @extends WorkerBase
 */
export class GenerateMeshBVHWorker extends WorkerBase {

	constructor() {

		const worker = new Worker( new URL( './generateMeshBVH.worker.js', import.meta.url ), { type: 'module' } );
		super( worker );
		this.name = 'GenerateMeshBVHWorker';

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
	 *
	 * @name generate
	 * @memberof GenerateMeshBVHWorker
	 * @instance
	 * @function
	 * @param {BufferGeometry} geometry
	 * @param {Object} [options] - Same options accepted by the `MeshBVH` constructor.
	 * @param {function(number): void} [options.onProgress] - Callback invoked with a `[0, 1]`
	 *   progress value as the BVH is built.
	 * @returns {Promise<MeshBVH>}
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

		return new Promise( ( resolve, reject ) => {

			if ( geometry.index && geometry.index.isInterleavedBufferAttribute ) {

				throw new Error( 'GenerateMeshBVHWorker: InterleavedBufferAttribute is not supported for the index attribute.' );

			}

			const positionAttr = geometry.attributes.position;
			const positionBuffer = positionAttr.isInterleavedBufferAttribute ? positionAttr.data : positionAttr;

			worker.onerror = e => {

				reject( new Error( `GenerateMeshBVHWorker: ${ e.message }` ) );

			};

			worker.onmessage = e => {

				const { data } = e;

				if ( data.error ) {

					if ( data.position ) {

						positionBuffer.array = data.position;

					}

					if ( data.index ) {

						geometry.index.array = data.index;

					}

					reject( new Error( data.error ) );
					worker.onmessage = null;

				} else if ( data.serialized ) {

					const { serialized, position } = data;
					const bvh = MeshBVH.deserialize( serialized, geometry, { setIndex: false } );
					const boundsOptions = Object.assign( {

						setBoundingBox: true,

					}, options );

					// we need to replace the arrays because they're neutered entirely by the
					// webworker transfer.
					positionBuffer.array = position;
					if ( serialized.index ) {

						if ( geometry.index ) {

							geometry.index.array = serialized.index;

						} else {

							const newIndex = new BufferAttribute( serialized.index, 1, false );
							geometry.setIndex( newIndex );

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

			const index = geometry.index ? geometry.index.array : null;
			const position = positionBuffer.array;
			const transferable = [ position ];
			if ( index ) {

				transferable.push( index );

			}

			worker.postMessage( {

				index,
				position,
				positionStride: positionAttr.isInterleavedBufferAttribute ? positionAttr.data.stride : 3,
				positionOffset: positionAttr.offset || 0,
				positionNormalized: positionAttr.normalized,
				options: {
					...options,
					onProgress: null,
					includedProgressCallback: Boolean( options.onProgress ),
					groups: [ ... geometry.groups ],
				},

			}, transferable.map( arr => arr.buffer ).filter( v => ( typeof SharedArrayBuffer === 'undefined' ) || ! ( v instanceof SharedArrayBuffer ) ) );

		} );

	}

}
