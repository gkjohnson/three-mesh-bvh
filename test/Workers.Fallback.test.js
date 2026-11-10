// @vitest-environment node

import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { runTestMatrix } from './utils.js';

describe( 'Workers fallback', () => {

	let browser;
	let page;
	let viteServer;
	const workerUrls = [];

	beforeAll( async () => {

		// the page is loaded from "localhost" and imports the workers from "127.0.0.1", so the worker
		// scripts are on another origin
		viteServer = await createServer( {
			root: process.cwd(),
			server: { port: 3001, host: '127.0.0.1' },
		} );

		browser = await puppeteer.launch( {
			headless: true,
			args: [ '--enable-features=SharedArrayBuffer', '--no-sandbox', '--disable-setuid-sandbox' ],
		} );

		await viteServer.listen();

		page = await browser.newPage();
		page.on( 'workercreated', worker => workerUrls.push( worker.url() ) );
		await page.goto( `http://localhost:${ viteServer.config.server.port }/test/workers/fallback-worker-test.html` );

	} );

	afterAll( async () => {

		await page.close();
		await browser.close();
		await viteServer.close();

	} );

	runTestMatrix( {
		parallel: [ false, true ],
	}, ( desc, options ) => {

		it( `should fall back to the bundled worker and generate a matching bvh with options: { ${ desc } }`, async () => {

			workerUrls.length = 0;

			const { bvh, workerBvh } = await page.evaluate( async options => {

				const { TorusGeometry } = window.THREE;
				const { MeshBVH, ParallelMeshBVHWorker, GenerateMeshBVHWorker } = window;

				const geometry = new TorusGeometry( 5, 5, 50, 100 );
				const bvh = new MeshBVH( geometry.clone(), options );
				const worker = options.parallel ? new ParallelMeshBVHWorker() : new GenerateMeshBVHWorker();
				const workerBvh = await worker.generate( geometry.clone(), options );
				worker.dispose();

				const serialize = bvh => {

					const serialized = MeshBVH.serialize( bvh );
					serialized.roots = serialized.roots.map( root => new Uint8Array( root ) );
					return serialized;

				};

				return { bvh: serialize( bvh ), workerBvh: serialize( workerBvh ) };

			}, options );

			// the bundled fallback workers are created from blob urls
			expect( workerUrls.length ).toBeGreaterThan( 0 );
			expect( workerUrls.every( url => url.startsWith( 'blob:' ) ) ).toBe( true );
			expect( workerBvh ).toEqual( bvh );

		} );

	} );

} );
