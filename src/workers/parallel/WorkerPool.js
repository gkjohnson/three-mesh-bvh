export class WorkerPool {

	get workerCount() {

		return this.workers.length;

	}

	constructor() {

		this.workers = [];

	}

	setWorkerCount( count ) {

		const workers = this.workers;
		while ( workers.length < count ) {

			workers.push( new Worker( new URL( './parallelMeshBVH.worker.js', import.meta.url ), { type: 'module' } ) );

		}

		while ( workers.length > count ) {

			workers.pop().terminate();

		}

	}

	runSubTask( i, msg, onProgress ) {

		return new Promise( ( resolve, reject ) => {

			const worker = this.workers[ i ];
			if ( worker.isRunning ) {

				throw new Error();

			}

			worker.isRunning = true;
			worker.postMessage( msg );
			worker.onerror = e => {

				worker.isRunning = false;
				reject( e );

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
					resolve( e.data );

				}

			};

		} );

	}

}
