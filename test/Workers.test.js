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
			let readable = true;
			let keptArrays = false;
			let positionMatches = false;
			let hasIndex = false;
			try {

				let geometry = new TorusGeometry( 5, 5, 50, 100 );
				if ( options.nonIndexed ) {

					geometry = geometry.toNonIndexed();

				}

				if ( options.groups ) {

					const chunks = ( geometry.index || geometry.attributes.position ).count / 3;
					geometry.clearGroups();
					geometry.addGroup( 0, chunks, 0 );
					geometry.addGroup( chunks, chunks, 0 );
					geometry.addGroup( chunks * 2, chunks, 0 );

				}

				if ( options.normalized ) {

					// quantize the positions to normalized int16 values in the range [ - 1, 1 ]
					const array = Int16Array.from( geometry.attributes.position.array, v => Math.round( 32767 * v / 10 ) );
					geometry.setAttribute( 'position', new BufferAttribute( array, 3, true ) );

				}

				if ( options.offsetBuffers ) {

					// views into larger buffers, as GLTFLoader produces, with a length that isn't a multiple of 4
					for ( const attr of [ geometry.index, geometry.attributes.position ].filter( Boolean ) ) {

						const { array } = attr;
						attr.array = new array.constructor( new ArrayBuffer( array.byteLength * 2 + 2 ), array.byteLength, array.length );
						attr.array.set( array );

					}

				}

				if ( options.interleaved ) {

					// pad the vertices so the positions are read with a stride and an offset
					const { array, count, normalized } = geometry.attributes.position;
					const buffer = new InterleavedBuffer( new array.constructor( count * 6 ), 6 );
					for ( let i = 0; i < count; i ++ ) {

						buffer.array.set( array.subarray( i * 3, i * 3 + 3 ), i * 6 + 3 );

					}

					geometry.setAttribute( 'position', new InterleavedBufferAttribute( buffer, 3, 3, normalized ) );

				}

				const { index, attributes } = geometry;
				const indexArray = index ? index.array : null;
				const positionArray = attributes.position.array;
				if ( options.progress ) {

					progress = [];
					options.onProgress = v => {

						// transferred arrays are empty until the build finishes
						readable = readable && ( ! index || index.array.length !== 0 ) && attributes.position.array.length !== 0;
						progress.push( v );

					};

				}

				const reference = geometry.clone();
				bvh = new MeshBVH( reference, {
					...options,
					onProgress: null,
				} );

				workerBvh = await worker.generate( geometry, options );
				worker.dispose();

				keptArrays = ( ! index || index.array === indexArray ) && attributes.position.array === positionArray;
				hasIndex = Boolean( geometry.index );
				const referenceArray = reference.attributes.position.array;
				positionMatches = attributes.position.array.length === referenceArray.length &&
					referenceArray.every( ( v, i ) => v === attributes.position.array[ i ] );

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
				readable,
				keptArrays,
				positionMatches,
				hasIndex,
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

	it.each( [ 'ParallelMeshBVHWorker', 'GenerateMeshBVHWorker' ] )( '%s should reject a failed build and accept the next one', async name => {

		const { error, built, unhandled } = await page.evaluate( async name => {

			const { TorusGeometry } = window.THREE;
			const worker = new window[ name ]();

			let unhandled = 0;
			const onUnhandled = () => unhandled ++;
			window.addEventListener( 'unhandledrejection', onUnhandled );

			let error = null;
			try {

				// nothing validates the range, so a negative count throws inside the worker
				await worker.generate( new TorusGeometry( 5, 5, 50, 100 ), { range: { start: 0, count: - 30 } } );

			} catch ( e ) {

				error = e.message;

			}

			const bvh = await worker.generate( new TorusGeometry( 5, 5, 50, 100 ) );
			worker.dispose();
			window.removeEventListener( 'unhandledrejection', onUnhandled );
			return { error, built: Boolean( bvh ), unhandled };

		}, name );

		expect( error ).toMatch( /RangeError/ );
		expect( built ).toBe( true );
		expect( unhandled ).toBe( 0 );

	} );

	runTestMatrix( {
		parallel: [ false, true ],
		groups: [ false, true ],
		nonIndexed: [ false, true ],
		interleaved: [ false, true ],
		normalized: [ false, true ],
		offsetBuffers: [ false, true ],
	}, ( desc, options ) => {

		describe( `Running with Options: { ${ desc } }`, () => {

			it( 'should generate a matching bvh and log onProgress correctly', async () => {

				const { workerBvh, bvh, error, progress, hasIndex } = await generate( { ...options, progress: true } );
				const minProgress = Math.min( ...progress );
				const maxProgress = Math.max( ...progress );

				expect( minProgress ).toBeLessThan( 0.01 );
				expect( maxProgress ).toBe( 1 );

				expect( error ).toBe( null );
				expect( workerBvh ).toEqual( bvh );

				// indirect builds leave a non-indexed geometry without an index
				expect( hasIndex ).toBe( ! ( options.nonIndexed && options.indirect ) );

			} );

			it.each( [ false, true ] )( 'should copy the geometry buffers unless transferred with { transferBuffers: %s }', async transferBuffers => {

				const result = await generate( { ...options, transferBuffers, progress: true } );

				// only GenerateMeshBVHWorker transfers, and an interleaved position is always copied
				const transferred = transferBuffers && ! options.parallel && ! options.interleaved;
				expect( result.error ).toBe( null );
				expect( result.workerBvh ).toEqual( result.bvh );
				expect( result.readable ).toBe( ! transferred );
				expect( result.keptArrays ).toBe( ! transferred );
				expect( result.positionMatches ).toBe( true );

			} );

		} );

	} );

} );
