import { WorkerBase } from '../WorkerBase.js';

const DEFAULT_WORKER_COUNT = typeof navigator === 'undefined' ? navigator.hardwareConcurrency : 4;
export class ParallelMeshBVHWorker extends WorkerBase {

	constructor() {

		const worker = new Worker( new URL( './generateAsync.worker.js', import.meta.url ), { type: 'module' } );
		super( worker );

		this.name = ParallelMeshBVHWorker;
		this.workerCount = Math.max( DEFAULT_WORKER_COUNT, 4 );

	}

	generate() {

		// TODO: interleaved buffers do not work

	}

}
