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

// Remove the listener after each operation so completed builds are not retained.
function abortable( promise, signal ) {

	let onAbort;
	const cancellation = new Promise( ( _, reject ) => {

		onAbort = () => reject( signal.reason );
		signal.addEventListener( 'abort', onAbort, { once: true } );
		if ( signal.aborted ) onAbort();

	} );

	return Promise.race( [ promise, cancellation ] ).finally( () => {

		signal.removeEventListener( 'abort', onAbort );

	} );

}

export class WorkerBase {

	constructor() {

		this.name = 'WorkerBase';
		this.running = false;
		this.worker = null;
		this._abortController = new AbortController();

		// errors are surfaced through "generate"
		this._workerPromise = this._loadWorker();
		this._workerPromise.catch( () => {} );

	}

	async _loadWorker() {

		const { signal } = this._abortController;
		try {

			// fails when loaded from another origin or if "three" can't be resolved
			this.worker = this.getWorker();
			return await abortable( waitForReady( this.worker ), signal );

		} catch {

			if ( signal.aborted ) throw signal.reason;
			if ( this.worker ) {

				this.worker.terminate();
				this.worker = null;

			}

			const worker = await this.getFallbackWorker();
			if ( signal.aborted ) {

				worker.terminate();
				throw signal.reason;

			}

			this.worker = worker;
			return abortable( waitForReady( worker ), signal );

		}

	}

	getWorker() {}

	getFallbackWorker() {}

	runTask() {}

	generate( ...args ) {

		const { signal } = this._abortController;
		if ( signal.aborted ) throw signal.reason;

		if ( this.running ) {

			throw new Error( 'GenerateMeshBVHWorker: Already running job.' );

		}

		this.running = true;
		const task = this._workerPromise.then(
			worker => {

				if ( signal.aborted ) throw signal.reason;
				return this.runTask( worker, ...args );

			},
			error => {

				if ( signal.aborted ) throw signal.reason;
				throw new Error( `${ this.name }: Could not create Web Worker with error "${ error.message }"` );

			},
		);
		const promise = abortable( task, signal );

		// "finally" would return a second promise that rejects unhandled when the build fails
		const onDone = () => {

			this.running = false;

		};

		promise.then( onDone, onDone );
		return promise;

	}

	dispose() {

		this._abortController.abort( new Error( `${ this.name }: Worker has been disposed.` ) );
		if ( this.worker ) {

			this.worker.onmessage = null;
			this.worker.onerror = null;
			this.worker.terminate();
			this.worker = null;

		}

	}

}
