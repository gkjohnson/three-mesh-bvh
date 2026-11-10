// @vitest-environment node

import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { CENTER } from 'three-mesh-bvh';
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

	it.each( [ 'ParallelMeshBVHWorker', 'GenerateMeshBVHWorker' ] )( '%s should write the index back to the original attribute if it is replaced during the build', async name => {

		const result = await page.evaluate( async name => {

			const { TorusGeometry, BufferAttribute } = window.THREE;
			const { MeshBVH } = window;

			const geometry = new TorusGeometry( 5, 5, 50, 100 );
			const reference = geometry.clone();
			new MeshBVH( reference );

			const original = geometry.index;
			const replacement = new BufferAttribute( new Uint32Array( 3 ), 1 );
			const worker = new window[ name ]();
			// the first progress update is posted once the worker has the geometry
			let replaced = false;
			await worker.generate( geometry, {
				onProgress: () => {

					if ( ! replaced ) {

						geometry.setIndex( replacement );
						replaced = true;

					}

				},
			} );
			worker.dispose();

			return {
				replaced,
				replacementUntouched: geometry.index === replacement && replacement.array.every( v => v === 0 ),
				originalMatches: original.array.every( ( v, i ) => v === reference.index.array[ i ] ),
			};

		}, name );

		expect( result.replaced ).toBe( true );
		expect( result.replacementUntouched ).toBe( true );
		expect( result.originalMatches ).toBe( true );

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

	const copyMatrix = {
		parallel: [ false, true ],
		interleaved: [ false, true ],
		indexed: [ true, false ],
		transferBuffers: [ false, true ],
		strategy: [ CENTER ],
	};

	runTestMatrix( copyMatrix, copyTest );
	runTestMatrix( { ...copyMatrix, indexed: [ true ], normalized: [ true ] }, copyTest );

	function copyTest( desc, options ) {

		it( `should copy or transfer the geometry arrays with { ${ desc } }`, async () => {

			const result = await page.evaluate( async options => {

				const { TorusGeometry, BufferAttribute, InterleavedBuffer, InterleavedBufferAttribute } = window.THREE;
				const { MeshBVH, ParallelMeshBVHWorker, GenerateMeshBVHWorker } = window;

				let geometry = new TorusGeometry( 5, 5, 50, 100 );
				if ( ! options.indexed ) {

					geometry = geometry.toNonIndexed();

				}

				if ( options.normalized ) {

					// quantize to normalized int16 like KHR_mesh_quantization, scaling the positions into [ - 1, 1 ]
					for ( const [ name, scale ] of [[ 'position', 10 ], [ 'normal', 1 ]] ) {

						const attr = geometry.attributes[ name ];
						const array = new Int16Array( attr.count * 3 );
						for ( let i = 0; i < array.length; i ++ ) {

							array[ i ] = Math.round( attr.array[ i ] / scale * 32767 );

						}

						geometry.setAttribute( name, new BufferAttribute( array, 3, true ) );

					}

				}

				if ( options.interleaved ) {

					// store the normals and positions in one buffer
					const { position, normal } = geometry.attributes;
					const buffer = new InterleavedBuffer( new position.array.constructor( position.count * 6 ), 6 );
					const newNormal = new InterleavedBufferAttribute( buffer, 3, 0, normal.normalized );
					const newPosition = new InterleavedBufferAttribute( buffer, 3, 3, position.normalized );
					for ( let i = 0; i < position.count; i ++ ) {

						newNormal.setXYZ( i, normal.getX( i ), normal.getY( i ), normal.getZ( i ) );
						newPosition.setXYZ( i, position.getX( i ), position.getY( i ), position.getZ( i ) );

					}

					geometry.setAttribute( 'normal', newNormal );
					geometry.setAttribute( 'position', newPosition );

				}

				const reference = geometry.clone();
				const bvh = new MeshBVH( reference, options );
				const indexArray = geometry.index ? geometry.index.array : null;

				const warnings = [];
				const warn = console.warn;
				console.warn = ( ...args ) => warnings.push( args.join( ' ' ) );

				const worker = options.parallel ? new ParallelMeshBVHWorker() : new GenerateMeshBVHWorker();
				// the first progress update is posted once the worker has the geometry
				let readableDuringBuild = null;
				const workerBvh = await worker.generate( geometry, {
					...options,
					onProgress: () => {

						if ( readableDuringBuild === null ) {

							readableDuringBuild = geometry.attributes.position.array.length !== 0;

						}

					},
				} );
				worker.dispose();
				console.warn = warn;

				const serialize = b => {

					const serialized = MeshBVH.serialize( b );
					serialized.roots = serialized.roots.map( ab => new Uint8Array( ab ) );
					return serialized;

				};

				const sameValues = ( a, b ) => a === b || a && b && a.count === b.count && a.array.every( ( v, i ) => v === b.array[ i ] );

				return {
					bvh: serialize( bvh ),
					workerBvh: serialize( workerBvh ),
					readableDuringBuild,
					warnings,
					keptIndexArray: indexArray !== null && geometry.index.array === indexArray,
					indexMatches: sameValues( geometry.index, reference.index ),
					normalMatches: [ 'getX', 'getY', 'getZ' ].every( fn => {

						const a = geometry.attributes.normal;
						const b = reference.attributes.normal;
						for ( let i = 0; i < a.count; i ++ ) {

							if ( a[ fn ]( i ) !== b[ fn ]( i ) ) return false;

						}

						return true;

					} ),
				};

			}, options );

			// interleaved positions are always copied, and the parallel worker never detaches the arrays
			const copied = ! options.transferBuffers || options.interleaved;
			expect( result.workerBvh ).toEqual( result.bvh );
			expect( result.indexMatches ).toBe( true );
			expect( result.normalMatches ).toBe( true );
			expect( result.readableDuringBuild ).toBe( copied || options.parallel );
			expect( result.keptIndexArray ).toBe( copied && options.indexed );
			expect( result.warnings.some( w => /interleaved/.test( w ) ) ).toBe( options.transferBuffers && options.interleaved );

		} );

	}

} );
