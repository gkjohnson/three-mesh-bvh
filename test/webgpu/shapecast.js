import { BoxGeometry, Mesh, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { WebGPURenderer, StorageBufferAttribute, StructTypeNode } from 'three/webgpu';
import { storage, uint, uniform, vec2 } from 'three/tsl';
import { MeshBVH, NOT_INTERSECTED, INTERSECTED, STOP_TRAVERSAL } from '../../src/index.js';
import { BVHComputeData, ndcToCameraRay, wgslTagFn, rayStruct, rayIntersectionResultStruct, pointQueryResultStruct, bvhNodeBoundsStruct } from '../../src/webgpu/index.js';

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

	// Far from the origin with a small near plane, where f32 error is largest. Returns the max
	// direction angle (radians), origin distance, and relative maxDist error against float64.
	window.testCameraRay = async orthographic => {

		const camera = orthographic ? new OrthographicCamera( - 16, 16, 9, - 9, 0.01, 10000 ) : new PerspectiveCamera( 60, 16 / 9, 0.01, 10000 );
		camera.coordinateSystem = renderer.coordinateSystem;
		camera.position.set( 6000, 3000, 7400 );
		camera.lookAt( 0, 0, 0 );
		camera.updateMatrixWorld();
		camera.updateProjectionMatrix();

		const ndcs = [ - 1, 0, 1 ].flatMap( x => [ - 1, 0, 1 ].map( y => [ x, y ] ) );
		const cameraToWorld = uniform( camera.matrixWorld );
		const inverseProjection = uniform( camera.projectionMatrixInverse );
		const bits = await readCompute( output => wgslTagFn`
			fn cameraRays() -> void {
				for ( var i = 0u; i < 9u; i ++ ) {
					let ndc = vec2f( f32( i / 3u ), f32( i % 3u ) ) - vec2f( 1.0 );
					let ray = ${ ndcToCameraRay }( ndc, ${ cameraToWorld }, ${ inverseProjection } );
					let values = array<f32, 7>( ray.origin.x, ray.origin.y, ray.origin.z, ray.direction.x, ray.direction.y, ray.direction.z, ray.maxDist );
					for ( var j = 0u; j < 7u; j ++ ) {
						${ output }[ i * 7u + j ] = bitcast<u32>( values[ j ] );
					}
				}
			}
		`(), ndcs.length * 7 );

		const values = new Float32Array( new Uint32Array( bits ).buffer );
		let direction = 0, origin = 0, maxDist = 0;
		ndcs.forEach( ( [ x, y ], i ) => {

			const near = new Vector3( x, y, 0 ).unproject( camera );
			const toFar = new Vector3( x, y, 1 ).unproject( camera ).sub( near );
			const v = values.subarray( i * 7, i * 7 + 7 );
			direction = Math.max( direction, new Vector3( v[ 3 ], v[ 4 ], v[ 5 ] ).angleTo( toFar ) );
			origin = Math.max( origin, new Vector3( v[ 0 ], v[ 1 ], v[ 2 ] ).distanceTo( near ) );
			maxDist = Math.max( maxDist, Math.abs( v[ 6 ] - toFar.length() ) / toFar.length() );

		} );
		return { direction, origin, maxDist };

	};

	// The deprecated two argument form, called from TSL with an inverse model-view-projection.
	window.testDeprecatedCameraRay = async named => {

		const camera = new PerspectiveCamera( 60, 16 / 9, 0.1, 1000 );
		camera.coordinateSystem = renderer.coordinateSystem;
		camera.position.set( 3, 2, 5 );
		camera.lookAt( 0, 0, 0 );
		camera.updateMatrixWorld();
		camera.updateProjectionMatrix();

		const inverseModelViewProjection = camera.matrixWorld.clone().multiply( camera.projectionMatrixInverse );
		const ndc = vec2( 0.5, - 0.25 );
		const matrix = uniform( inverseModelViewProjection );
		const ray = named ? ndcToCameraRay( { ndc, inverseModelViewProjection: matrix } ) : ndcToCameraRay( ndc, matrix );
		const bits = await readCompute( output => wgslTagFn`
			fn deprecatedCameraRay() -> void {
				let ray = ${ ray };
				let values = array<f32, 4>( ray.direction.x, ray.direction.y, ray.direction.z, ray.maxDist );
				for ( var j = 0u; j < 4u; j ++ ) {
					${ output }[ j ] = bitcast<u32>( values[ j ] );
				}
			}
		`(), 4 );

		const v = new Float32Array( new Uint32Array( bits ).buffer );
		const near = new Vector3( 0.5, - 0.25, 0 ).unproject( camera );
		const toFar = new Vector3( 0.5, - 0.25, 1 ).unproject( camera ).sub( near );
		return {
			direction: new Vector3( v[ 0 ], v[ 1 ], v[ 2 ] ).angleTo( toFar ),
			maxDist: Math.abs( v[ 3 ] - toFar.length() ) / toFar.length(),
		};

	};

	// A layout with members smaller than vec4f. Returns every vertex read through getVertex, a
	// sampleTrianglePoint at each triangle's first corner, the raycast and closest point results, with the CPU values.
	window.testGetVertex = async () => {

		const vertexGeometry = new BoxGeometry();
		vertexGeometry.clearGroups();
		const uv1 = vertexGeometry.attributes.uv.clone();
		uv1.array.forEach( ( v, i, arr ) => arr[ i ] = v + 100 );
		vertexGeometry.setAttribute( 'uv1', uv1 );
		const vertexData = new BVHComputeData( new Mesh( vertexGeometry ), { attributes: { position: 'vec3f', uv: 'vec2f', uv1: 'vec2f', normal: 'vec3f' } } );
		vertexData.update();

		const { position, uv, normal } = vertexGeometry.attributes;
		const count = position.count;
		const triangle = vertexGeometry.index.array.slice( 0, 3 );
		const bits = await readCompute( output => wgslTagFn`
			fn vertices() -> void {
				for ( var i = 0u; i < ${ count }u; i ++ ) {
					let v = ${ vertexData.fns.getVertex }( i );
					let values = array<f32, 10>( v.position.x, v.position.y, v.position.z, v.uv.x, v.uv.y, v.uv1.x, v.uv1.y, v.normal.x, v.normal.y, v.normal.z );
					for ( var j = 0u; j < 10u; j ++ ) {
						${ output }[ i * 10u + j ] = bitcast<u32>( values[ j ] );
					}
				}
				let s = ${ vertexData.fns.sampleTrianglePoint }( vec3f( 1.0, 0.0, 0.0 ), vec3u( ${ triangle[ 0 ] }u, ${ triangle[ 1 ] }u, ${ triangle[ 2 ] }u ) );
				let sampled = array<f32, 10>( s.position.x, s.position.y, s.position.z, s.uv.x, s.uv.y, s.uv1.x, s.uv1.y, s.normal.x, s.normal.y, s.normal.z );
				for ( var j = 0u; j < 10u; j ++ ) {
					${ output }[ ${ count * 10 }u + j ] = bitcast<u32>( sampled[ j ] );
				}
				var ray: ${ rayStruct };
				ray.origin = vec3f( 0.1, 0.1, 5.0 );
				ray.direction = vec3f( 0.0, 0.0, -1.0 );
				var hit: ${ rayIntersectionResultStruct };
				let didHit = ${ vertexData.fns.raycastFirstHit }( ray, &hit );
				${ output }[ ${ count * 10 + 10 }u ] = bitcast<u32>( select( -1.0, hit.dist, didHit ) );
				ray.maxDist = 4.4;
				${ output }[ ${ count * 10 + 11 }u ] = bitcast<u32>( select( 0.0, 1.0, ${ vertexData.fns.raycastAnyHit }( ray ) ) );
				ray.maxDist = 4.6;
				${ output }[ ${ count * 10 + 12 }u ] = bitcast<u32>( select( 0.0, 1.0, ${ vertexData.fns.raycastAnyHit }( ray ) ) );
				var point: ${ pointQueryResultStruct };
				let found = ${ vertexData.fns.closestPointToPoint }( ray.origin, &point );
				${ output }[ ${ count * 10 + 13 }u ] = bitcast<u32>( select( -1.0, point.distanceSq, found ) );
			}
		`(), count * 10 + 14 );

		const values = Array.from( new Float32Array( new Uint32Array( bits ).buffer ) );
		const expected = [];
		for ( let i = 0; i < count; i ++ ) {

			expected.push( position.getX( i ), position.getY( i ), position.getZ( i ), uv.getX( i ), uv.getY( i ), uv1.getX( i ), uv1.getY( i ), normal.getX( i ), normal.getY( i ), normal.getZ( i ) );

		}

		expected.push( ...expected.slice( triangle[ 0 ] * 10, triangle[ 0 ] * 10 + 10 ) );
		expected.push( 4.5, 0, 1, 4.5 * 4.5 );
		return { values, expected: expected.map( Math.fround ) };

	};

	window.ready = true;

}

init().catch( error => {

	window.initError = error.message;
	console.error( error );

} );
