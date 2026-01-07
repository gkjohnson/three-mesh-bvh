// @vitest-environment node

import puppeteer from 'puppeteer';
import { createServer } from 'vite';

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
			try {

				const geometry = new TorusGeometry( 5, 5, 40, 10 );
				if ( options.groups ) {

					const chunks = geometry.index.count / 3;
					geometry.clearGroups();
					geometry.addGroup( 0, chunks, 0 );
					geometry.addGroup( chunks, chunks, 0 );
					geometry.addGroup( chunks * 2, chunks, 0 );

				}

				bvh = new MeshBVH( geometry.clone(), options );
				workerBvh = await worker.generate( geometry.clone(), options );
				worker.dispose();

			} catch ( e ) {

				return {
					error: e.message,
					bvh: null,
					workerBvh: null,
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

	describe( 'GenerateMeshBVHWorker', () => {

		it( 'should generate a matching bvh', async () => {

			const { workerBvh, bvh, error } = await generate();
			expect( error ).toBe( null );
			expect( workerBvh ).toEqual( bvh );

		} );

		it( 'should generate a matching indirect bvh', async () => {

			const { workerBvh, bvh, error } = await generate( { indirect: true } );
			expect( error ).toBe( null );
			expect( workerBvh ).toEqual( bvh );

		} );

		it( 'should generate a matching bvh with groups', async () => {

			const { workerBvh, bvh, error } = await generate( { groups: true } );
			expect( error ).toBe( null );
			expect( workerBvh ).toEqual( bvh );

		} );

		it( 'should generate a matching indirect bvh with groups', async () => {

			const { workerBvh, bvh, error } = await generate( { indirect: true, groups: true } );
			expect( error ).toBe( null );
			expect( workerBvh ).toEqual( bvh );

		} );

	} );

	describe( 'ParallelMeshBVHWorker', () => {

		it( 'should generate a matching bvh', async () => {

			const { workerBvh, bvh, error } = await generate( { parallel: true } );
			expect( error ).toBe( null );
			expect( workerBvh ).toEqual( bvh );

		} );

		it( 'should generate a matching indirect bvh', async () => {

			const { workerBvh, bvh, error } = await generate( { indirect: true, parallel: true } );
			expect( error ).toBe( null );
			expect( workerBvh ).toEqual( bvh );

		} );

		it( 'should generate a matching bvh with groups', async () => {

			const { workerBvh, bvh, error } = await generate( { groups: true, parallel: true } );
			expect( error ).toBe( null );
			expect( workerBvh ).toEqual( bvh );

		} );

		it( 'should generate a matching indirect bvh with groups', async () => {

			const { workerBvh, bvh, error } = await generate( { indirect: true, groups: true, parallel: true } );
			expect( error ).toBe( null );
			expect( workerBvh ).toEqual( bvh );

		} );

	} );

} );
