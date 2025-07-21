import { wgslFn } from 'three/tsl';


const intersectsTriangle = wgslFn( /* wgsl */ `

	fn intersectsTriangle(
		rayOrigin: vec3<f32>, rayDirection: vec3<f32>,
		a: vec3<f32>, b: vec3<f32>, c: vec3<f32>
	) -> IntersectionResult {

		var result: IntersectionResult;
		result.didHit = false;

		let edge1 = b - a;
		let edge2 = c - a;
		let n = cross( edge1, edge2 );

		let det = -dot( rayDirection, n );

		if abs(det) < TRI_INTERSECT_EPSILON {

			return result;

		}

		let invdet = 1.0 / det;

		let AO = rayOrigin - a;
		let DAO = cross( AO, rayDirection );

		let u = dot( edge2, DAO ) * invdet;
		let v = -dot( edge1, DAO ) * invdet;
		let t = dot( AO, n ) * invdet;

		let w = 1.0 - u - v;

		if u < -TRI_INTERSECT_EPSILON || v < -TRI_INTERSECT_EPSILON || w < -TRI_INTERSECT_EPSILON {

			return result;

		}

		result.didHit = true;
		result.barycoord = vec3<f32>( w, u, v );
		result.dist = t;
		result.side = sign( det );
		result.faceNormal = result.side * normalize( n );

		return result;

	}

` );


const intersectTriangles = wgslFn( /* wgsl */ `

	fn intersectTriangles(
		bvh_position: ptr<storage, array<vec3<f32>>, read>,
		bvh_index: ptr<storage, array<vec3<u32>>, read>,
		offset: u32,
		count: u32,
		rayOrigin: vec3<f32>,
		rayDirection: vec3<f32>
	) -> IntersectionResult {

		var closestResult: IntersectionResult;

		closestResult.didHit = false;
		closestResult.dist = INFINITY;

		for ( var i = offset; i < offset + count; i = i + 1u ) {

			let indices = bvh_index[ i ];
			let a = bvh_position[ indices.x ];
			let b = bvh_position[ indices.y ];
			let c = bvh_position[ indices.z ];

			var triResult = intersectsTriangle( rayOrigin, rayDirection, a, b, c );

			if triResult.didHit && triResult.dist < closestResult.dist {

				closestResult = triResult;
				closestResult.faceIndices = vec4<u32>( indices.xyz, i );

			}

		}

		return closestResult;

	}

` );


const bvhIntersectFirstHit = wgslFn( /* wgsl */ `

	fn bvhIntersectFirstHit(
		bvh_index: ptr<storage, array<vec3<u32>>, read>,
		bvh_position: ptr<storage, array<vec3<f32>>, read>,
		bvh: ptr<storage, array<BVHNode>,read>,
		rayOrigin: vec3<f32>,
		rayDirection: vec3<f32>
	) -> IntersectionResult {

		var ptr = 0;
		var stack: array<u32, BVH_STACK_DEPTH>;
		stack[ 0 ] = 0u;

		var bestHit: IntersectionResult;

		bestHit.didHit = false;
		bestHit.dist = INFINITY;

		loop {

			if ( ptr < 0 || ptr >= i32( BVH_STACK_DEPTH ) ) {

				break;

			}

			let currNodeIndex = stack[ ptr ];
			let node = bvh[ currNodeIndex ];

			ptr = ptr - 1;

			var boundsHitDistance: f32 = 0.0;

			if ( !intersectsBVHNodeBounds( rayOrigin, rayDirection, bvh, currNodeIndex, &boundsHitDistance ) || boundsHitDistance > bestHit.dist ) {

				continue;

			}

			let boundsInfox = node.splitAxisOrTriangleCount;
			let boundsInfoy = node.rightChildOrTriangleOffset;

			let isLeaf = ( boundsInfox & 0xffff0000u ) != 0u;

			if ( isLeaf ) {

				let count = boundsInfox & 0x0000ffffu;
				let offset = boundsInfoy;

				let localHit = intersectTriangles(
					bvh_position, bvh_index, offset,
					count, rayOrigin, rayDirection
				);

				if ( localHit.didHit && localHit.dist < bestHit.dist ) {

					bestHit = localHit;

				}

			} else {

				let leftIndex = currNodeIndex + 1u;
				let splitAxis = boundsInfox & 0x0000ffffu;
				let rightIndex = 4u * boundsInfoy / 32u;

				let leftToRight = rayDirection[splitAxis] >= 0.0;
				let c1 = select( rightIndex, leftIndex, leftToRight );
				let c2 = select( leftIndex, rightIndex, leftToRight );

				ptr = ptr + 1;
				stack[ ptr ] = c2;

				ptr = ptr + 1;
				stack[ ptr ] = c1;

			}

		}

		return bestHit;

	}

` );


export { intersectsTriangle, intersectTriangles, bvhIntersectFirstHit };
