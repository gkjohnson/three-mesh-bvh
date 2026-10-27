// @vitest-environment node

import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { runTestMatrix } from './utils.js';

describe( 'Workers', () => {

	let browser;
	let page;
	let viteServer;

	function generate( options = {} ) {

		return page.evaluate( async options => {

			const { TorusGeometry } = window.THREE;
			const { MeshBVH, ParallelMeshBVHWorker, GenerateMeshBVHWorker } = window;
			const worker = options.parallel ? new ParallelMeshBVHWorker() : new GenerateMeshBVHWorker();

			let bvh = null;
			let workerBvh = null;
			let error = null;
			let progress = null;
			try {

				const geometry = new TorusGeometry( 5, 5, 50, 100 );
				if ( options.groups ) {

					const chunks = geometry.index.count / 3;
					geometry.clearGroups();
					geometry.addGroup( 0, chunks, 0 );
					geometry.addGroup( chunks, chunks, 0 );
					geometry.addGroup( chunks * 2, chunks, 0 );

				}

				if ( options.progress ) {

					progress = [];
					options.onProgress = v => {

						progress.push( v );

					};

				}

				bvh = new MeshBVH( geometry.clone(), {
					...options,
					onProgress: null,
				} );

				workerBvh = await worker.generate( geometry.clone(), options );
				worker.dispose();

			} catch ( e ) {

				return {
					error: e.message,
					bvh: null,
					workerBvh: null,
					progress,
				};

			}

			const serializedBvh = MeshBVH.serialize( bvh );
			const serializedWorkerBvh = MeshBVH.serialize( workerBvh );

			serializedBvh.roots = serializedBvh.roots.map( ab => new Uint8Array( ab ) );
			serializedWorkerBvh.roots = serializedWorkerBvh.roots.map( ab => new Uint8Array( ab ) );

			return {
				error,
				bvh: serializedBvh,
				workerBvh: serializedWorkerBvh,
				progress,
			};

		}, options );

	}

	beforeAll( async () => {

		viteServer = await createServer( {
			root: process.cwd(),
			server: { port: 3000 },
		} );

		browser = await puppeteer.launch( {
			headless: true,
			args: [ '--enable-features=SharedArrayBuffer', '--no-sandbox', '--disable-setuid-sandbox' ],
		} );

		await viteServer.listen();

		page = await browser.newPage();
		page.on( 'console', msg => {

			const type = msg.type();
			if ( type === 'error' ) {

				console.error( 'error: ', msg.text() );

			} else {

				console.log( msg.text() );

			}

		} );

		await page.goto( `http://localhost:${ viteServer.config.server.port }/test/workers/parallel-worker-test.html` );

	} );

	afterAll( async () => {

		await page.close();
		await browser.close();
		await viteServer.close();

	} );

	it( 'should have shared array buffers available', async () => {

		const sharedArrayBuffersExist = await page.evaluate( async () => ! ! SharedArrayBuffer );
		expect( sharedArrayBuffersExist ).toEqual( true );

	} );

	runTestMatrix( {
		parallel: [ false, true ],
		groups: [ false, true ],
	}, ( desc, options ) => {

		describe( `Running with Options: { ${ desc } }`, () => {

			it( 'should generate a matching bvh and log onProgress correctly', async () => {

				const { workerBvh, bvh, error, progress } = await generate( { ...options, progress: true } );
				const minProgress = Math.min( ...progress );
				const maxProgress = Math.max( ...progress );

				expect( minProgress ).toBeLessThan( 0.01 );
				expect( maxProgress ).toBe( 1 );

				expect( error ).toBe( null );
				expect( workerBvh ).toEqual( bvh );

			} );

		} );

	} );

} );
