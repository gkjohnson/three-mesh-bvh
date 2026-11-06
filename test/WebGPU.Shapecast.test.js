import puppeteer from 'puppeteer';
import { createServer } from 'vite';

// Opt in with BVH_WEBGPU_TESTS=1 npm test -- test/WebGPU.Shapecast.test.js.
// These tests require a real hardware adapter, with no software fallback.
describe.skipIf( ! process.env.BVH_WEBGPU_TESTS )( 'WebGPU shapecast', () => {

	let browser, page, server;
	const errors = [];
	const warnings = [];

	beforeAll( async () => {

		server = await createServer( { configFile: false, root: process.cwd(), server: { port: 0 } } );
		await server.listen();
		browser = await puppeteer.launch( { headless: true, args: [ '--enable-unsafe-webgpu' ] } );
		page = await browser.newPage();
		page.on( 'pageerror', error => errors.push( error.message ) );
		page.on( 'console', message => {

			if ( message.type() === 'error' ) errors.push( message.text() );
			if ( message.type() === 'warn' ) warnings.push( message.text() );

		} );
		await page.goto( `http://localhost:${ server.httpServer.address().port }/test/webgpu/shapecast.html` );
		await page.waitForFunction( () => window.ready || window.initError, { timeout: 20000 } );
		const initError = await page.evaluate( () => window.initError );
		if ( initError ) throw new Error( initError );
		console.log( 'WebGPU adapter:', await page.evaluate( () => window.adapterInfo ) );

	}, 30000 );

	afterAll( async () => {

		await browser?.close();
		await server?.close();

	} );

	it( 'preserves boolean hit and miss callbacks across the entire traversal', async () => {

		const miss = await page.evaluate( () => window.testShapecast( true, false, 0 ) );
		const hit = await page.evaluate( () => window.testShapecast( true, true, 0 ) );
		expect( miss[ 1 ] ).toBeGreaterThan( 3 );
		expect( miss ).toEqual( [ 0, miss[ 1 ], 0, 2, 0 ] );
		expect( hit ).toEqual( [ 1, miss[ 1 ], 2, 2, 0 ] );

	} );

	it( 'continues for uint hits and misses', async () => {

		const boolHit = await page.evaluate( () => window.testShapecast( true, true, 0 ) );
		const uintHit = await page.evaluate( () => window.testShapecast( false, true, 0 ) );
		const boolMiss = await page.evaluate( () => window.testShapecast( true, false, 0 ) );
		const uintMiss = await page.evaluate( () => window.testShapecast( false, false, 0 ) );
		expect( uintHit ).toEqual( boolHit );
		expect( uintMiss ).toEqual( boolMiss );

	} );

	it.each( [ 1, 3 ] )( 'stops after %i leaf callbacks and finalizes the active BLAS once', async stopAfter => {

		// Earlier leaves report hits; only STOP_TRAVERSAL may stop the query.
		const result = await page.evaluate( count => window.testShapecast( false, true, count ), stopAfter );
		expect( result ).toEqual( [ 1, stopAfter, 1, 1, 0 ] );
		// A stop after earlier misses must also report a hit and run both hooks.
		const afterMisses = await page.evaluate( count => window.testShapecast( false, false, count ), stopAfter );
		expect( afterMisses ).toEqual( result );

	} );

	it( 'can stop in a later object after accumulating earlier hits', async () => {

		const full = await page.evaluate( () => window.testShapecast( false, true, 0 ) );
		const stopAfter = full[ 1 ] / 2 + 1;
		const result = await page.evaluate( count => window.testShapecast( false, true, count ), stopAfter );
		expect( result ).toEqual( [ 1, stopAfter, 2, 2, 0 ] );

	} );

	it( 'supports closest-hit and any-hit together, transforms, misses, and exclusive maxDist', async () => {

		const result = await page.evaluate( () => window.testRays() );
		expect( result ).toEqual( [ 1, 1, 300, 0, 0, 1, 0, 0, 1, 3 ] );
		expect( errors ).toEqual( [] );

	} );

	it.each( [ false, true ] )( 'builds precise camera rays far from the origin (orthographic: %s)', async orthographic => {

		// one pixel of a 1080p, 60 degree view is ~1e-3 radians
		const { direction, origin, maxDist } = await page.evaluate( o => window.testCameraRay( o ), orthographic );
		expect( direction ).toBeLessThan( 1e-5 );

		// f32 spacing is ~1e-3 at 1e4 units. maxDist is limited by the f32 inverse projection, not
		// this function: ~0.8% for this near / far, and it grows with far / near
		expect( origin ).toBeLessThan( 2e-3 );
		expect( maxDist ).toBeLessThan( 2e-2 );
		expect( errors ).toEqual( [] );

	} );

	it.each( [ false, true ] )( 'supports the deprecated inverse model-view-projection camera ray arguments (named: %s)', async named => {

		warnings.length = 0;
		const { direction, maxDist } = await page.evaluate( n => window.testDeprecatedCameraRay( n ), named );
		expect( direction ).toBeLessThan( 1e-5 );
		expect( maxDist ).toBeLessThan( 1e-3 );
		expect( warnings.some( w => w.includes( 'ndcToCameraRay' ) ) ).toBe( true );
		expect( errors ).toEqual( [] );

	} );

} );
