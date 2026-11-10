// @vitest-environment node

import fs from 'fs';
import http from 'http';
import path from 'path';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { CENTER } from 'three-mesh-bvh';
import { runTestMatrix } from './utils.js';

function generate( page, options = {} ) {

	return page.evaluate( async options => {

		const { TorusGeometry } = window.THREE;
		const { MeshBVH, ParallelMeshBVHWorker, GenerateMeshBVHWorker } = window;
		const workerOptions = { useBundledWorker: options.bundled };
		const worker = options.parallel ? new ParallelMeshBVHWorker( workerOptions ) : new GenerateMeshBVHWorker( workerOptions );

		let bvh = null;
		let workerBvh = null;
		let error = null;
		let progress = null;
		let useBundledWorker = null;
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
			useBundledWorker = worker.useBundledWorker;
			worker.dispose();

		} catch ( e ) {

			return {
				error: e.message,
				bvh: null,
				workerBvh: null,
				progress,
				useBundledWorker,
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
			useBundledWorker,
		};

	}, options );

}

async function createPage( browser, url ) {

	const page = await browser.newPage();
	page.on( 'console', msg => {

		const type = msg.type();
		if ( type === 'error' ) {

			console.error( 'error: ', msg.text() );

		} else {

			console.log( msg.text() );

		}

	} );

	await page.goto( url );
	await page.waitForFunction( () => Boolean( window.GenerateMeshBVHWorker ) );
	return page;

}

// serves the repository files unmodified with CORS headers, like a CDN such as jsdelivr
function createStaticServer() {

	const root = process.cwd();
	const server = http.createServer( ( req, res ) => {

		const filePath = path.join( root, decodeURIComponent( new URL( req.url, 'http://localhost' ).pathname ) );
		if ( ! filePath.startsWith( root ) ) {

			res.writeHead( 403 );
			res.end();
			return;

		}

		fs.readFile( filePath, ( error, data ) => {

			if ( error ) {

				res.writeHead( 404 );
				res.end();
				return;

			}

			res.writeHead( 200, {
				'Content-Type': filePath.endsWith( '.html' ) ? 'text/html' : 'text/javascript',
				'Access-Control-Allow-Origin': '*',
			} );
			res.end( data );

		} );

	} );

	return new Promise( resolve => server.listen( 0, '127.0.0.1', () => resolve( server ) ) );

}

describe( 'Workers', () => {

	let browser;
	let page;
	let viteServer;

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

		page = await createPage( browser, `http://localhost:${ viteServer.config.server.port }/test/workers/parallel-worker-test.html` );

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
		bundled: [ false, true ],
	}, ( desc, options ) => {

		describe( `Running with Options: { ${ desc } }`, () => {

			it( 'should generate a matching bvh and log onProgress correctly', async () => {

				const { workerBvh, bvh, error, progress, useBundledWorker } = await generate( page, { ...options, progress: true } );
				const minProgress = Math.min( ...progress );
				const maxProgress = Math.max( ...progress );

				expect( minProgress ).toBeLessThan( 0.01 );
				expect( maxProgress ).toBe( 1 );

				expect( error ).toBe( null );
				expect( workerBvh ).toEqual( bvh );

				// the worker module loads on the same origin so it's only replaced when requested
				expect( useBundledWorker ).toBe( options.bundled );

			} );

		} );

	} );

	describe( 'loaded from another origin', () => {

		let cdnServer;
		let pageServer;
		let cdnPage;
		let cdnUrl;

		beforeAll( async () => {

			cdnServer = await createStaticServer();
			pageServer = await createStaticServer();
			cdnUrl = `http://127.0.0.1:${ cdnServer.address().port }`;

			const pageUrl = `http://127.0.0.1:${ pageServer.address().port }`;
			cdnPage = await createPage( browser, `${ pageUrl }/test/workers/cdn-worker-test.html?cdn=${ cdnUrl }` );

		} );

		afterAll( async () => {

			await cdnPage.close();
			cdnServer.close();
			pageServer.close();

		} );

		it( 'should not be able to create the worker module directly', async () => {

			const error = await cdnPage.evaluate( cdnUrl => {

				try {

					new Worker( `${ cdnUrl }/src/workers/generateMeshBVH.worker.js`, { type: 'module' } ).terminate();
					return null;

				} catch ( e ) {

					return e.name;

				}

			}, cdnUrl );

			expect( error ).toBe( 'SecurityError' );

		} );

		runTestMatrix( {
			strategy: [ CENTER ],
			parallel: [ false, true ],
			groups: [ false, true ],
		}, ( desc, options ) => {

			it( `should fall back to the bundled worker and generate a matching bvh with options: { ${ desc } }`, async () => {

				const { workerBvh, bvh, error, progress, useBundledWorker } = await generate( cdnPage, { ...options, progress: true } );

				expect( error ).toBe( null );
				expect( Math.max( ...progress ) ).toBe( 1 );
				expect( workerBvh ).toEqual( bvh );
				expect( useBundledWorker ).toBe( true );

			} );

		} );

	} );

} );
