import { BufferAttribute, BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute } from 'three';
import { ensureIndex, getFullPrimitiveRange } from '../../core/build/geometryUtils.js';

// resolves when the worker posts "ready" and rejects if it fails to load first
function waitForReady( worker ) {

	return new Promise( ( resolve, reject ) => {

		worker.onmessage = ( { data } ) => {

			if ( data.type === 'ready' ) {

				worker.onmessage = null;
				worker.onerror = null;
				resolve( worker );

			}

		};

		worker.onerror = e => {

			// handled by the caller
			e.preventDefault();
			reject( new Error( e.message || 'The worker script failed to load.' ) );

		};

	} );

}

export class WorkerBase {

	constructor() {

		this.name = 'WorkerBase';
		this.running = false;
		this.worker = null;
		this._disposed = false;

		// errors are surfaced through "generate"
		this._workerPromise = this._loadWorker();
		this._workerPromise.catch( () => {} );

	}

	async _loadWorker() {

		try {

			// fails when loaded from another origin or if "three" can't be resolved
			this.worker = this.getWorker();
			return await waitForReady( this.worker );

		} catch {

			if ( this.worker ) {

				this.worker.terminate();

			}

			const worker = await this.getFallbackWorker();
			if ( this._disposed ) {

				worker.terminate();
				throw new Error( `${ this.name }: Worker has been disposed.` );

			}

			this.worker = worker;
			return waitForReady( worker );

		}

	}

	getWorker() {}

	getFallbackWorker() {}

	runTask() {}

	// Builds the range as its own geometry so only its data is sent to the worker and written back
	async runRangeTask( worker, geometry, options ) {

		if ( ! options.indirect ) {

			ensureIndex( geometry, options );

		}

		const { index, groups } = geometry;
		const { position } = geometry.attributes;
		const { offset, count } = getFullPrimitiveRange( geometry, options.range, 3 );
		const start = offset * 3;

		const rangeGeometry = new BufferGeometry();
		rangeGeometry.groups = groups.map( group => ( { ...group, start: group.start - start } ) );

		// copy the triangles, with indices relative to the first vertex they use
		let vertexStart = start;
		let vertexEnd = start + count * 3;
		if ( index ) {

			const indices = index.array.slice( start, start + count * 3 );
			vertexStart = indices.reduce( ( min, v ) => Math.min( min, v ) );
			vertexEnd = indices.reduce( ( max, v ) => Math.max( max, v ) ) + 1;
			indices.forEach( ( v, i ) => {

				indices[ i ] = v - vertexStart;

			} );
			rangeGeometry.setIndex( new BufferAttribute( indices, 1 ) );

		}

		// the positions are a view since "runTask" makes the copy for the worker
		if ( position.isInterleavedBufferAttribute ) {

			const { array, stride } = position.data;
			const buffer = new InterleavedBuffer( array.subarray( vertexStart * stride, vertexEnd * stride ), stride );
			rangeGeometry.setAttribute( 'position', new InterleavedBufferAttribute( buffer, 3, position.offset, position.normalized ) );

		} else {

			const array = position.array.subarray( vertexStart * 3, vertexEnd * 3 );
			rangeGeometry.setAttribute( 'position', new BufferAttribute( array, 3, position.normalized ) );

		}

		const bvh = await this.runTask( worker, rangeGeometry, { ...options, range: null } );

		// move the result to the original geometry
		bvh.geometry = geometry;
		if ( ! bvh.indirect ) {

			rangeGeometry.index.array.forEach( ( v, i ) => {

				index.array[ start + i ] = v + vertexStart;

			} );

		} else if ( bvh._indirectBuffer instanceof Uint16Array && offset + count > 2 ** 16 ) {

			// the offset indices don't fit in 16 bits
			const { buffer, length } = bvh._indirectBuffer;
			const indirectBuffer = new Uint32Array( new buffer.constructor( length * 4 ) );
			indirectBuffer.set( bvh._indirectBuffer );
			bvh._indirectBuffer = indirectBuffer;

		}

		bvh.shiftTriangleOffsets( offset );
		return bvh;

	}

	generate( geometry, options = {} ) {

		if ( this.running ) {

			throw new Error( 'GenerateMeshBVHWorker: Already running job.' );

		}

		if ( this._disposed ) {

			throw new Error( 'GenerateMeshBVHWorker: Worker has been disposed.' );

		}

		this.running = true;

		const promise = this._workerPromise.then(
			worker => {

				// transferred buffers are sent whole
				const copied = ! options.transferBuffers || geometry.attributes.position.isInterleavedBufferAttribute;
				const isRange = copied && options.range?.count > 0;
				return isRange ? this.runRangeTask( worker, geometry, options ) : this.runTask( worker, geometry, options );

			},
			error => {

				throw new Error( `${ this.name }: Could not create Web Worker with error "${ error.message }"` );

			},
		);

		// "finally" would return a second promise that rejects unhandled when the build fails
		const onDone = () => {

			this.running = false;

		};

		promise.then( onDone, onDone );

		return promise;

	}

	dispose() {

		this._disposed = true;

		if ( this.worker ) {

			this.worker.terminate();
			this.worker = null;

		}

	}

}
