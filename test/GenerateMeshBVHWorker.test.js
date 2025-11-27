import { TorusGeometry } from 'three';
import { MeshBVH } from '../src/index.js';
import { GenerateMeshBVHWorker } from '../src/workers/GenerateMeshBVHWorker.js';
import { ParallelMeshBVHWorker } from '../src/workers/ParallelMeshBVHWorker.js';

describe( 'GenerateMeshBVHWorker', () => {

	runTests( GenerateMeshBVHWorker );

} );

// ParallelMeshBVHWorker requires nested workers and SharedArrayBuffer
// which are not fully supported by @vitest/web-worker
describe.skip( 'ParallelMeshBVHWorker', () => {

	runTests( ParallelMeshBVHWorker );

} );


function runTests( generatorConstructor = GenerateMeshBVHWorker ) {

	let geometry;
	beforeEach( () => {

		geometry = new TorusGeometry( 5, 5, 40, 10 );

	} );

	it( 'should correctly generate a BVH using the worker', async () => {

		const generator = new generatorConstructor();
		const workerBvh = await generator.generate( geometry.clone() );
		const bvh = new MeshBVH( geometry.clone() );

		expect( workerBvh ).toEqualBVH( bvh );

		generator.dispose();

	} );

	// it( 'should correctly generate a BVH using the worker with indirect options', async () => {

	// 	const generator = new generatorConstructor();
	// 	const workerBvh = await generator.generate( geometry.clone(), { indirect: true } );
	// 	const bvh = new MeshBVH( geometry.clone(), { indirect: true } );

	// 	expect( workerBvh ).toEqualBVH( bvh );

	// 	generator.dispose();

	// } );

	// it( 'should correctly generate a BVH using the worker with groups', async () => {

	// 	geometry.clearGroups();

	// 	const chunks = geometry.index.count / 3;
	// 	geometry.addGroup( 0, chunks, 0 );
	// 	geometry.addGroup( chunks, chunks, 0 );
	// 	geometry.addGroup( chunks * 2, chunks, 0 );

	// 	const generator = new generatorConstructor();
	// 	const workerBvh = await generator.generate( geometry.clone() );
	// 	const bvh = new MeshBVH( geometry.clone() );

	// 	expect( workerBvh ).toEqualBVH( bvh );

	// 	generator.dispose();

	// } );

	// it( 'should correctly generate a BVH using the worker with indirect groups', async () => {

	// 	geometry.clearGroups();

	// 	const chunks = geometry.index.count / 3;
	// 	geometry.addGroup( 0, chunks, 0 );
	// 	geometry.addGroup( chunks, chunks, 0 );
	// 	geometry.addGroup( chunks * 2, chunks, 0 );

	// 	const generator = new generatorConstructor();
	// 	const workerBvh = await generator.generate( geometry.clone(), { indirect: true } );
	// 	const bvh = new MeshBVH( geometry.clone(), { indirect: true } );

	// 	expect( workerBvh ).toEqualBVH( bvh );

	// 	generator.dispose();

	// } );

}
