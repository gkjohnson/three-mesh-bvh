import { WorkerBase } from '../WorkerBase.js';

const DEFAULT_THREADS = typeof navigator === 'undefined' ? navigator.hardwareConcurrency : 4;
export class ParallelMeshBVHWorker extends WorkerBase {

	constructor() {

		const worker = new Worker( new URL( './generateAsync.worker.js', import.meta.url ), { type: 'module' } );
		super( worker );

		this.name = ParallelMeshBVHWorker;
		this.threads = Math.max( DEFAULT_THREADS, 4 );

	}




}
