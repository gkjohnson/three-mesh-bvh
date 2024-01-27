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

			workers.push( new Worker( new URL( './parallelAsync.worker.js', import.meta.url ), { module: true } ) );

		}

		while ( workers.length > count ) {

			workers.pop().terminate();

		}

	}

	runSubTask( i, msg, onProgress ) {

		// TODO: do we need to handle buffer transfers here?
		return new Promise( ( resolve, reject ) => {

			const worker = this.workers[ i ];
			if ( worker.isRunning ) {

				throw new Error();

			}

			worker.isRunning = true;
			worker.postMessage( msg );
			worker.onerror = e => reject( e );
			worker.onmessage = e => {

				if ( e.type === 'progress' ) {

					onProgress( e.progress );

				} else {

					resolve( e.data );

				}

			};

		} );

	}

}
