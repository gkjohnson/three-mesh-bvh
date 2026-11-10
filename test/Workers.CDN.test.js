// @vitest-environment node

import fs from 'fs';
import http from 'http';
import path from 'path';
import puppeteer from 'puppeteer';

describe( 'Workers loaded from another origin', () => {

	let browser;
	let page;
	let server;

	beforeAll( async () => {

		// serve the repository with CORS headers, like a CDN
		const root = process.cwd();
		server = http.createServer( ( req, res ) => {

			const filePath = path.join( root, decodeURIComponent( new URL( req.url, 'http://localhost' ).pathname ) );
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

		await new Promise( resolve => server.listen( 0, resolve ) );

		browser = await puppeteer.launch( {
			headless: true,
			args: [ '--enable-features=SharedArrayBuffer', '--no-sandbox', '--disable-setuid-sandbox' ],
		} );

		// load the page from "localhost" and the library from "127.0.0.1" so they're on different origins
		const { port } = server.address();
		page = await browser.newPage();
		await page.goto( `http://localhost:${ port }/test/workers/cdn-worker-test.html?cdn=http://127.0.0.1:${ port }` );
		await page.waitForFunction( () => Boolean( window.GenerateMeshBVHWorker ) );

	} );

	afterAll( async () => {

		await browser.close();
		server.close();

	} );

	it.each( [ 'GenerateMeshBVHWorker', 'ParallelMeshBVHWorker' ] )( '%s should fall back to the bundled worker and generate a matching bvh', async name => {

		const { bvh, workerBvh } = await page.evaluate( async name => {

			const { TorusGeometry } = window.THREE;
			const { MeshBVH } = window;
			const geometry = new TorusGeometry( 5, 5, 50, 100 );
			const bvh = new MeshBVH( geometry.clone() );

			const worker = new window[ name ]();
			const workerBvh = await worker.generate( geometry.clone() );
			worker.dispose();

			const serialize = bvh => MeshBVH.serialize( bvh ).roots.map( root => Array.from( new Uint8Array( root ) ) );
			return { bvh: serialize( bvh ), workerBvh: serialize( workerBvh ) };

		}, name );

		expect( workerBvh ).toEqual( bvh );

	} );

} );
