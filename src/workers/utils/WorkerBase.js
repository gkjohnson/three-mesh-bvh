// Blob urls for the bundled worker scripts, keyed by script url. They're shared by every instance and
// the bundled parallel worker spawns its sub workers from the same url, so they're never revoked.
const bundledWorkerUrls = {};

function getBundledWorkerUrl( url ) {

	// A worker can't be created from a script on another origin but a blob url is local, so fetch the
	// script and create the worker from that, as three.js' DRACOLoader does.
	if ( ! ( url in bundledWorkerUrls ) ) {

		bundledWorkerUrls[ url ] = fetch( url )
			.then( response => response.text() )
			.then( text => URL.createObjectURL( new Blob( [ text ], { type: 'application/javascript' } ) ) );

	}

	return bundledWorkerUrls[ url ];

}

// Resolves once the worker posts "ready" after its script has loaded, and rejects if it fails before
// then. Jobs are only sent to a loaded worker so the transferred geometry buffers aren't lost.
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

			// the failure is handled by the caller, so don't report it as uncaught
			e.preventDefault();
			reject( new Error( e.message || 'The worker script failed to load.' ) );

		};

	} );

}

export class WorkerBase {

	constructor( createWorker, bundledWorkerUrl ) {

		this.name = 'WorkerBase';
		this.running = false;
		this.worker = null;
		this._disposed = false;

		// resolves with the worker once it has loaded. Errors are surfaced through "generate".
		this._workerPromise = this._initWorker( createWorker, bundledWorkerUrl );
		this._workerPromise.catch( () => {} );

	}

	async _initWorker( createWorker, bundledWorkerUrl ) {

		try {

			// Creating the module worker throws if the script is on another origin, such as when the
			// library is loaded from a CDN, and it fails before "ready" if the module can't be loaded,
			// such as when "three" can't be resolved because workers don't use the page's import map.
			this.worker = createWorker();
			return await waitForReady( this.worker );

		} catch {

			// fall back to the self-contained copy of the worker script with three.js bundled in
			if ( this.worker ) {

				this.worker.terminate();
				this.worker = null;

			}

			const url = await getBundledWorkerUrl( bundledWorkerUrl );
			if ( this._disposed ) {

				throw new Error( 'Worker has been disposed.' );

			}

			this.worker = new Worker( url );
			return waitForReady( this.worker );

		}

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
