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

	generate( ...args ) {

		if ( this.running ) {

			throw new Error( 'GenerateMeshBVHWorker: Already running job.' );

		}

		if ( this._disposed ) {

			throw new Error( 'GenerateMeshBVHWorker: Worker has been disposed.' );

		}

		this.running = true;

		const promise = this._workerPromise.then(
			worker => this.runTask( worker, ...args ),
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
