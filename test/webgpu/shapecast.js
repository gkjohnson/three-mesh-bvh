import { BoxGeometry, Mesh } from 'three';
import { WebGPURenderer, StorageBufferAttribute, StructTypeNode } from 'three/webgpu';
import { storage, uint } from 'three/tsl';
import { MeshBVH, NOT_INTERSECTED, INTERSECTED, STOP_TRAVERSAL } from '../../src/index.js';
import { BVHComputeData, wgslTagFn, rayStruct, rayIntersectionResultStruct, bvhNodeBoundsStruct } from '../../src/webgpu/index.js';

async function init() {

	const geometry = new BoxGeometry();
	geometry.clearGroups();
	geometry.boundsTree = new MeshBVH( geometry, { targetLeafSize: 1 } );
	const meshes = [ new Mesh( geometry ), new Mesh( geometry ) ];
	meshes[ 0 ].scale.set( 2, 3, 4 );
	meshes[ 1 ].position.z = - 5;
	meshes.forEach( mesh => mesh.updateMatrixWorld( true ) );
	const data = new BVHComputeData( meshes );
	data.update();

	const adapter = await navigator.gpu?.requestAdapter();
	if ( ! adapter ) throw new Error( 'A hardware WebGPU adapter is required.' );
	window.adapterInfo = { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description };
	if ( adapter.info.isFallbackAdapter || /swiftshader|llvmpipe|lavapipe|software/i.test( JSON.stringify( window.adapterInfo ) ) ) {

		throw new Error( 'Software WebGPU adapters are not supported by these tests.' );

	}

	// Use the verified adapter's device so the renderer cannot select a fallback adapter.
	const device = await adapter.requestDevice();
	const renderer = new WebGPURenderer( { device } );
	await renderer.init();

	async function readCompute( fn, count ) {

		const attribute = new StorageBufferAttribute( count, 1, Uint32Array );
		const output = storage( attribute, 'uint', count );
		const kernel = fn( output ).compute( 1 );
		renderer.backend.device.pushErrorScope( 'validation' );
		await renderer.computeAsync( kernel );
		const result = Array.from( new Uint32Array( await renderer.getArrayBufferAsync( attribute ) ) );
		const error = await renderer.backend.device.popErrorScope();
		if ( error ) throw new Error( error.message );
		return result;

	}

	// Exercise multiple BLAS leaves and TLAS placements, with hooks that detect leaked state.
	window.testShapecast = async ( booleanResult, hit, stopAfter ) => {

		const resetCount = uint( 0 ).toVar();
		const activeObject = uint( 0 ).toVar();
		const resultStruct = new StructTypeNode( { visits: 'uint', transforms: 'uint', badState: 'uint' }, 'TestResult' );
		const query = data.getShapecastFn( {
			shapeStruct: rayStruct,
			resultStruct,
			prefixFn: wgslTagFn`
				fn prefix() -> void {
					${ resetCount } = 0u;
					${ activeObject } = 0u;
				}
			`,
			intersectsBoundsFn: wgslTagFn`
				fn bounds( ray: ${ rayStruct }, bounds: ${ bvhNodeBoundsStruct }, result: ptr<function, ${ resultStruct }> ) -> u32 { return 1u; }
			`,
			intersectRangeFn: wgslTagFn`
				fn range( ray: ${ rayStruct }, offset: u32, count: u32, result: ptr<function, ${ resultStruct }> ) -> ${ booleanResult ? 'bool' : 'u32' } {
					result.visits += 1u;
					if ( ${ activeObject } == 0u ) { result.badState += 1u; }
					${ booleanResult ? `return ${ hit ? 'true' : 'false' };` : '' }
					${ booleanResult ? '' : `if ( result.visits == ${ stopAfter }u ) { return ${ STOP_TRAVERSAL }u; }` }
					${ booleanResult ? '' : `return ${ hit ? 1 : 0 }u;` }
				}
			`,
			transformShapeFn: wgslTagFn`
				fn testTransformShape( ray: ptr<function, ${ rayStruct }>, objectIndex: u32 ) -> void { ${ activeObject } = objectIndex + 1u; }
			`,
			transformResultFn: wgslTagFn`
				fn finish( result: ptr<function, ${ resultStruct }>, objectIndex: u32 ) -> void {
					result.transforms += 1u;
					if ( ${ activeObject } != objectIndex + 1u ) { result.badState += 1u; }
				}
			`,
			resetShapeFn: wgslTagFn`
				fn reset( objectIndex: u32 ) -> void { ${ resetCount } += 1u; ${ activeObject } = 0u; }
			`,
		} );
		return readCompute( output => wgslTagFn`
			fn run() -> void {
				var ray: ${ rayStruct };
				var result: ${ resultStruct };
				let hit = ${ query }( ray, &result );
				${ output }[ 0 ] = u32( hit );
				${ output }[ 1 ] = result.visits;
				${ output }[ 2 ] = result.transforms;
				${ output }[ 3 ] = ${ resetCount };
				${ output }[ 4 ] = result.badState + ${ activeObject };
			}
		`(), 5 );

	};

	window.testRays = async () => readCompute( output => wgslTagFn`
		fn rays() -> void {
			var ray: ${ rayStruct };
			ray.origin = vec3f( 0.1, 0.1, 5.0 );
			ray.direction = vec3f( 0.0, 0.0, -1.0 );
			var first: ${ rayIntersectionResultStruct };
			${ output }[ 0 ] = u32( ${ data.fns.raycastAnyHit }( ray ) );
			${ output }[ 1 ] = u32( ${ data.fns.raycastFirstHit }( ray, &first ) );
			${ output }[ 2 ] = u32( first.dist * 100.0 );
			ray.maxDist = 3.0;
			${ output }[ 3 ] = u32( ${ data.fns.raycastAnyHit }( ray ) );
			var bounded: ${ rayIntersectionResultStruct };
			${ output }[ 4 ] = u32( ${ data.fns.raycastFirstHit }( ray, &bounded ) );
			ray.maxDist = 3.1;
			${ output }[ 5 ] = u32( ${ data.fns.raycastAnyHit }( ray ) );
			ray.origin.x = 10.0;
			${ output }[ 6 ] = u32( ${ data.fns.raycastAnyHit }( ray ) );
			${ output }[ 7 ] = ${ NOT_INTERSECTED }u;
			${ output }[ 8 ] = ${ INTERSECTED }u;
			${ output }[ 9 ] = ${ STOP_TRAVERSAL }u;
		}
	`(), 10 );

	window.ready = true;

}

init().catch( error => {

	window.initError = error.message;
	console.error( error );

} );
