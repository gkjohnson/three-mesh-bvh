export class WorkerPool {

	get workerCount() {

		return this.workers.length;

	}

	constructor( getWorkerCallback ) {

		this.workers = [];
		this._getWorker = getWorkerCallback;

	}

	setWorkerCount( count ) {

		const workers = this.workers;
		while ( workers.length < count ) {

			workers.push( this._getWorker() );

		}

		while ( workers.length > count ) {

			workers.pop().terminate();

		}

	}

	runSubTask( i, msg, onProgress ) {

		return new Promise( ( resolve, reject ) => {

			const worker = this.workers[ i ];
			if ( worker.isRunning ) {

				throw new Error( `${ this.name }: Worker ${ i } is already running.` );

			}

			worker.isRunning = true;
			worker.postMessage( msg );
			worker.onerror = e => {

				worker.isRunning = false;

				// a worker that fails to load reports a plain Event, which can't be posted on
				reject( new Error( e.message || 'Worker failed.' ) );

			};

			worker.onmessage = e => {

				if ( e.data.type === 'progress' ) {

					if ( onProgress ) {

						onProgress( e.data.progress );

					}

				} else {

					if ( onProgress ) {

						onProgress( 1 );

					}

					worker.isRunning = false;
					if ( e.data.error ) {

						reject( e.data.error );

					} else {

						resolve( e.data );

					}

				}

			};

		} );

	}

}
