import { WorkerBase } from '../src/workers/utils/WorkerBase.js';

class TestWorker extends WorkerBase {

	getWorker() {

		return { terminate: vi.fn() };

	}

}

describe( 'WorkerBase disposal', () => {

	it( 'rejects a build waiting for the worker to load', async () => {

		const worker = new TestWorker();
		const underlyingWorker = worker.worker;
		const build = worker.generate();
		worker.dispose();

		await expect( build ).rejects.toThrow( 'Worker has been disposed.' );
		expect( worker.running ).toBe( false );
		expect( underlyingWorker.terminate ).toHaveBeenCalledOnce();

	} );

	it( 'rejects an active build', async () => {

		const worker = new TestWorker();
		const started = new Promise( resolve => {

			vi.spyOn( worker, 'runTask' ).mockImplementation( () => {

				resolve();
				return new Promise( () => {} );

			} );

		} );
		const build = worker.generate();
		worker.worker.onmessage( { data: { type: 'ready' } } );
		await started;
		worker.dispose();

		await expect( build ).rejects.toThrow( 'Worker has been disposed.' );
		expect( worker.running ).toBe( false );

	} );

	it( 'does not start a queued build after disposal', async () => {

		const worker = new TestWorker();
		const runTask = vi.spyOn( worker, 'runTask' );
		const build = worker.generate();
		worker.worker.onmessage( { data: { type: 'ready' } } );
		worker.dispose();

		await expect( build ).rejects.toThrow( 'Worker has been disposed.' );
		expect( runTask ).not.toHaveBeenCalled();
		expect( worker.running ).toBe( false );

	} );

} );
