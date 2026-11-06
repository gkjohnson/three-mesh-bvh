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

			const { TorusGeometry, BufferAttribute, InterleavedBuffer, InterleavedBufferAttribute } = window.THREE;
			const { MeshBVH, ParallelMeshBVHWorker, GenerateMeshBVHWorker } = window;
			const worker = options.parallel ? new ParallelMeshBVHWorker() : new GenerateMeshBVHWorker();

			let bvh = null;
			let workerBvh = null;
			let error = null;
			let progress = null;
			let attributesRestored = null;
			try {

				const geometry = new TorusGeometry( 5, 5, 50, 100 );
				if ( options.groups ) {

					const chunks = geometry.index.count / 3;
					geometry.clearGroups();
					geometry.addGroup( 0, chunks, 0 );
					geometry.addGroup( chunks, chunks, 0 );
					geometry.addGroup( chunks * 2, chunks, 0 );

				}

				if ( options.interleaved || options.normalized ) {

					// interleaved stores the position after the normal in a 6 item stride. Normalized stores
					// Int16 like a quantized glTF, scaled to fit the [ - 1, 1 ] range.
					const { position, normal } = geometry.attributes;
					const normalized = Boolean( options.normalized );
					const scale = normalized ? 0.1 : 1;
					const ArrayType = normalized ? Int16Array : Float32Array;

					let newNormal, newPosition;
					if ( options.interleaved ) {

						const buffer = new InterleavedBuffer( new ArrayType( position.count * 6 ), 6 );
						newNormal = new InterleavedBufferAttribute( buffer, 3, 0, normalized );
						newPosition = new InterleavedBufferAttribute( buffer, 3, 3, normalized );

					} else {

						newNormal = new BufferAttribute( new ArrayType( position.count * 3 ), 3, normalized );
						newPosition = new BufferAttribute( new ArrayType( position.count * 3 ), 3, normalized );

					}

					for ( let i = 0; i < position.count; i ++ ) {

						newNormal.setXYZ( i, normal.getX( i ), normal.getY( i ), normal.getZ( i ) );
						newPosition.setXYZ( i, position.getX( i ) * scale, position.getY( i ) * scale, position.getZ( i ) * scale );

					}

					geometry.setAttribute( 'normal', newNormal );
					geometry.setAttribute( 'position', newPosition );

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

				const workerGeometry = geometry.clone();
				workerBvh = await worker.generate( workerGeometry, options );
				worker.dispose();

				// the transferred arrays must be put back, including any attribute interleaved with the positions
				attributesRestored = [ 'position', 'normal' ].every( name => {

					const attr = geometry.attributes[ name ];
					const workerAttr = workerGeometry.attributes[ name ];
					for ( let i = 0; i < attr.count * 3; i ++ ) {

						const item = Math.floor( i / 3 );
						if ( workerAttr.getComponent( item, i % 3 ) !== attr.getComponent( item, i % 3 ) ) {

							return false;

						}

					}

					return true;

				} );

			} catch ( e ) {

				return {
					error: e.message,
					bvh: null,
					workerBvh: null,
					progress,
					attributesRestored,
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
				attributesRestored,
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
		interleaved: [ false, true ],
	}, ( desc, options ) => {

		describe( `Running with Options: { ${ desc } }`, () => {

			it( 'should generate a matching bvh and log onProgress correctly', async () => {

				const { workerBvh, bvh, error, progress, attributesRestored } = await generate( { ...options, progress: true } );
				const minProgress = Math.min( ...progress );
				const maxProgress = Math.max( ...progress );

				expect( minProgress ).toBeLessThan( 0.01 );
				expect( maxProgress ).toBe( 1 );

				expect( error ).toBe( null );
				expect( workerBvh ).toEqual( bvh );
				expect( attributesRestored ).toBe( true );

			} );

		} );

	} );

	runTestMatrix( {
		parallel: [ false, true ],
		interleaved: [ false, true ],
	}, ( desc, options ) => {

		it( `should generate a matching bvh for a normalized position with { ${ desc } }`, async () => {

			const { workerBvh, bvh, error, attributesRestored } = await generate( { ...options, normalized: true } );

			expect( error ).toBe( null );
			expect( workerBvh ).toEqual( bvh );
			expect( attributesRestored ).toBe( true );

		} );

	} );

} );
