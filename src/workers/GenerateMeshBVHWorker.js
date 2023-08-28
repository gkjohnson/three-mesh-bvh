import { Box3, BufferAttribute } from 'three';
import { MeshBVH } from '../core/MeshBVH.js';

export class GenerateMeshBVHWorker {

	constructor() {

		this.running = false;
		this.worker = new Worker( new URL( './generateAsync.worker.js', import.meta.url ), { type: 'module' } );
		this.worker.onerror = e => {

			if ( e.message ) {

				throw new Error( `GenerateMeshBVHWorker: Could not create Web Worker with error "${ e.message }"` );

			} else {

				throw new Error( 'GenerateMeshBVHWorker: Could not create Web Worker.' );

			}

		};

	}

	generate( geometry, options = {} ) {

		if ( this.running ) {

			throw new Error( 'GenerateMeshBVHWorker: Already running job.' );

		}

		if ( this.worker === null ) {

			throw new Error( 'GenerateMeshBVHWorker: Worker has been disposed.' );

		}

		const { worker } = this;
		this.running = true;

		return new Promise( ( resolve, reject ) => {

			worker.onerror = e => {

				reject( new Error( `GenerateMeshBVHWorker: ${ e.message }` ) );
				this.running = false;

			};

			worker.onmessage = e => {

				this.running = false;
				const { data } = e;

				if ( data.error ) {

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
					geometry.attributes.position.array = position;
					if ( geometry.index ) {

						geometry.index.array = serialized.index;

					} else {

						const newIndex = new BufferAttribute( serialized.index, 1, false );
						geometry.setIndex( newIndex );

					}

					if ( boundsOptions.setBoundingBox ) {

						geometry.boundingBox = bvh.getBoundingBox( new Box3() );

					}

					resolve( bvh );
					worker.onmessage = null;

				} else if ( options.onProgress ) {

					options.onProgress( data.progress );

				}

			};

			const index = geometry.index ? geometry.index.array : null;
			const position = geometry.attributes.position.array;

			if ( position.isInterleavedBufferAttribute || index && index.isInterleavedBufferAttribute ) {

				throw new Error( 'GenerateMeshBVHWorker: InterleavedBufferAttribute are not supported for the geometry attributes.' );

			}

			const transferable = [ position ];
			if ( index ) {

				transferable.push( index );

			}

			worker.postMessage( {

				index,
				position,
				options: {
					...options,
					onProgress: null,
					includedProgressCallback: Boolean( options.onProgress ),
					groups: [ ... geometry.groups ],
				},

			}, transferable.map( arr => arr.buffer ).filter( v => ( typeof SharedArrayBuffer === 'undefined' ) || ! ( v instanceof SharedArrayBuffer ) ) );

		} );

	}

	dispose() {

		this.worker.terminate();
		this.worker = null;

	}

}
