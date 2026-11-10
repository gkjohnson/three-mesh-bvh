// Blob urls for the bundled worker scripts, keyed by script url. The script is fetched once and
// shared by every instance, and nested workers spawned by the bundled parallel worker load the
// same blob url, so they are kept for the lifetime of the page.
const bundledWorkerUrls = new Map();

function getBundledWorkerUrl( url ) {

	const key = url.toString();
	if ( ! bundledWorkerUrls.has( key ) ) {

		// A worker can't be created from a script on another origin but a blob url is local so
		// fetch the script text and create the worker from that. This is what three.js'
		// DRACOLoader and KTX2Loader do, as well.
		const promise = fetch( url )
			.then( response => {

				if ( ! response.ok ) {

					throw new Error( `Failed to fetch "${ key }" with status ${ response.status }.` );

				}

				return response.text();

			} )
			.then( text => URL.createObjectURL( new Blob( [ text ], { type: 'application/javascript' } ) ) );

		// allow a later instance to try again if the script failed to load
		promise.catch( () => bundledWorkerUrls.delete( key ) );
		bundledWorkerUrls.set( key, promise );

	}

	return bundledWorkerUrls.get( key );

}

export class WorkerBase {

	/**
	 * @param {function(): Worker} createWorker - Creates the module worker.
	 * @param {URL} bundledWorkerUrl - Url of the bundled, self-contained classic worker script.
	 * @param {Object} [options]
	 * @param {boolean} [options.useBundledWorker=false]
	 */
	constructor( createWorker, bundledWorkerUrl, options = {} ) {

		const { useBundledWorker = false } = options;

		this.name = 'WorkerBase';
		this.running = false;
		this.useBundledWorker = useBundledWorker;
		this.worker = null;

		this._createWorker = createWorker;
		this._bundledWorkerUrl = bundledWorkerUrl;
		this._disposed = false;
		this._cancelLoad = null;

		// resolves with the worker once it has loaded. Errors are surfaced through "generate".
		this._workerPromise = this._initWorker();
		this._workerPromise.catch( () => {} );

	}

	async _initWorker() {

		if ( ! this.useBundledWorker ) {

			try {

				// Creating the worker throws a SecurityError if the script is on another origin, such
				// as when the library is loaded from a CDN. Otherwise it fails to load asynchronously
				// if the module can't be loaded, such as when the "three" import can't be resolved
				// because workers don't use the page's import map.
				this.worker = this._createWorker();
				return await this._waitForReady( this.worker );

			} catch ( error ) {

				if ( this._disposed ) {

					throw error;

				}

				if ( this.worker ) {

					this.worker.terminate();
					this.worker = null;

				}

				this.useBundledWorker = true;

			}

		}

		const url = await getBundledWorkerUrl( this._bundledWorkerUrl );
		if ( this._disposed ) {

			throw new Error( 'Worker has been disposed.' );

		}

		this.worker = new Worker( url );
		return this._waitForReady( this.worker );

	}

	// Resolves when the worker posts the "ready" message after its script has loaded and rejects if
	// it fails to load. Jobs are only posted to a loaded worker so the geometry buffers, which are
	// transferred, aren't lost to a worker that failed to load.
	_waitForReady( worker ) {

		return new Promise( ( resolve, reject ) => {

			const finish = () => {

				worker.onmessage = null;
				worker.onerror = null;
				this._cancelLoad = null;

			};

			this._cancelLoad = () => {

				finish();
				reject( new Error( 'Worker has been disposed.' ) );

			};

			worker.onmessage = ( { data } ) => {

				if ( data && data.type === 'ready' ) {

					finish();
					resolve( worker );

				}

			};

			worker.onerror = e => {

				// the error is handled here, so don't report it as uncaught
				e.preventDefault();
				finish();
				reject( new Error( e.message || 'The worker script failed to load.' ) );

			};

		} );

	}

	runTask() {}

	generate( ...args ) {

		if ( this.running ) {

			throw new Error( 'GenerateMeshBVHWorker: Already running job.' );

		}

		if ( this._disposed ) {

			throw new Error( 'GenerateMeshBVHWorker: Worker has been disposed.' );

		}

		this.running = true;

		// the returned promise settles after "running" is reset so a rejected job isn't also
		// reported as an unhandled rejection from a separate "finally" chain
		return this._workerPromise.then(
			worker => {

				if ( this._disposed ) {

					throw new Error( `${ this.name }: Worker has been disposed.` );

				}

				return this.runTask( worker, ...args );

			},
			error => {

				if ( this._disposed ) {

					throw new Error( `${ this.name }: Worker has been disposed.` );

				}

				throw new Error( `${ this.name }: Could not create Web Worker with error "${ error.message }"` );

			},
		).finally( () => {

			this.running = false;

		} );

	}

	dispose() {

		this._disposed = true;

		if ( this._cancelLoad ) {

			this._cancelLoad();

		}

		if ( this.worker ) {

			this.worker.terminate();
			this.worker = null;

		}

	}

}
