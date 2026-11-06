import {
	Mesh,
	MeshBasicMaterial,
	TorusGeometry,
} from 'three';
import {
	MeshBVH,
	SkinnedMeshBVH,
	CENTER,
	SAH,
} from 'three-mesh-bvh';

function getRootBytes( bvh ) {

	return bvh._roots.map( root => Array.from( new Uint8Array( root ) ) );

}

describe( 'MeshBVH.generateAsync', () => {

	let geometry;

	beforeEach( () => {

		geometry = new TorusGeometry( 5, 5, 400, 100 );

	} );

	it( 'should build the same tree and index as the constructor.', async () => {

		for ( const strategy of [ CENTER, SAH ] ) {

			for ( const indirect of [ false, true ] ) {

				const syncGeometry = geometry.clone();
				const asyncGeometry = geometry.clone();
				const syncBVH = new MeshBVH( syncGeometry, { strategy, indirect } );
				const asyncBVH = await MeshBVH.generateAsync( asyncGeometry, { strategy, indirect, timeSlice: 0 } );

				expect( asyncBVH ).toBeInstanceOf( MeshBVH );
				expect( getRootBytes( asyncBVH ) ).toEqual( getRootBytes( syncBVH ) );
				expect( Array.from( asyncGeometry.index.array ) ).toEqual( Array.from( syncGeometry.index.array ) );
				expect( asyncGeometry.boundingBox ).toEqual( syncGeometry.boundingBox );

			}

		}

	} );

	it( 'should build every root of a geometry with groups.', async () => {

		const count = geometry.index.count;
		geometry.addGroup( 0, count / 3 );
		geometry.addGroup( count / 3, count - count / 3 );

		const syncBVH = new MeshBVH( geometry.clone() );
		const asyncBVH = await MeshBVH.generateAsync( geometry.clone(), { timeSlice: 0 } );

		expect( asyncBVH._roots ).toHaveLength( 2 );
		expect( getRootBytes( asyncBVH ) ).toEqual( getRootBytes( syncBVH ) );

	} );

	it( 'should wait for new tasks during the build and report progress up to 1.', async () => {

		let tasks = 0;
		const interval = setInterval( () => tasks ++, 0 );

		const progress = [];
		const bvh = await MeshBVH.generateAsync( geometry, {
			timeSlice: 0,
			onProgress: value => progress.push( value ),
		} );

		clearInterval( interval );

		expect( bvh._roots ).toHaveLength( 1 );
		expect( tasks ).toBeGreaterThan( 0 );
		expect( progress.length ).toBeGreaterThan( 0 );
		expect( progress[ progress.length - 1 ] ).toBe( 1 );
		expect( progress.every( ( value, i ) => i === 0 || value >= progress[ i - 1 ] ) ).toBe( true );

	} );

	it( 'should not interfere with synchronous builds in between its tasks.', async () => {

		const expected = getRootBytes( new MeshBVH( geometry.clone(), { strategy: SAH } ) );

		const promise = MeshBVH.generateAsync( geometry.clone(), { strategy: SAH, timeSlice: 0 } );
		const interval = setInterval( () => new MeshBVH( new TorusGeometry( 1, 0.5, 20, 20 ), { strategy: SAH } ), 0 );
		const bvh = await promise;
		clearInterval( interval );

		expect( getRootBytes( bvh ) ).toEqual( expected );

	} );

	it( 'should support subclasses.', async () => {

		const mesh = new Mesh( geometry, new MeshBasicMaterial() );
		const bvh = await SkinnedMeshBVH.generateAsync( mesh, { timeSlice: 0 } );

		expect( bvh ).toBeInstanceOf( SkinnedMeshBVH );
		expect( bvh.mesh ).toBe( mesh );
		expect( bvh._roots ).toHaveLength( 1 );

	} );

} );
