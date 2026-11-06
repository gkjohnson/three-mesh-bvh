import { WorkerPool } from '../src/workers/utils/WorkerPool.js';

describe( 'WorkerPool', () => {

	function createPool( reply ) {

		const pool = new WorkerPool( () => ( {
			postMessage() {

				setTimeout( () => reply( this ) );

			},
			terminate() {},
		} ) );
		pool.setWorkerCount( 1 );
		return pool;

	}

	it( 'should reject a sub task that posts back an error', async () => {

		const pool = createPool( worker => worker.onmessage( { data: { type: 'result', error: new Error( 'sub task failed' ) } } ) );
		await expect( pool.runSubTask( 0, {} ) ).rejects.toThrow( 'sub task failed' );
		expect( pool.workers[ 0 ].isRunning ).toBe( false );

	} );

	it( 'should reject with an Error when a sub worker fails to load', async () => {

		// a script that fails to load fires a plain Event with no message
		const pool = createPool( worker => worker.onerror( {} ) );
		const error = await pool.runSubTask( 0, {} ).catch( e => e );
		expect( error ).toBeInstanceOf( Error );
		expect( pool.workers[ 0 ].isRunning ).toBe( false );

	} );

	it( 'should resolve a sub task result', async () => {

		const pool = createPool( worker => worker.onmessage( { data: { type: 'result', value: 1 } } ) );
		await expect( pool.runSubTask( 0, {} ) ).resolves.toEqual( { type: 'result', value: 1 } );

	} );

} );
