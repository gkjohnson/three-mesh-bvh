import { wgslFn } from 'three/tsl';
import { bvhNodeStruct, intersectionResultStruct, intersectsBoundsInvDir, rayStruct, constants } from './common_functions.wgsl.js';

export const intersectsTriangle = wgslFn( /* wgsl */ `

	fn intersectsTriangle(
		ray: Ray,
		a: vec3f, b: vec3f, c: vec3f,
		maxDist: f32,
		result: ptr<function, IntersectionResult>
	) -> bool {

		let edge1 = b - a;
		let edge2 = c - a;
		let n = cross( edge1, edge2 );

		let det = - dot( ray.direction, n );

		if ( abs( det ) < TRI_INTERSECT_EPSILON ) {

			return false;

		}

		let invdet = 1.0 / det;

		let AO = ray.origin - a;
		let t = dot( AO, n ) * invdet;

		if ( t < TRI_INTERSECT_EPSILON || t >= maxDist ) {

			return false;

		}

		let DAO = cross( AO, ray.direction );

		let u = dot( edge2, DAO ) * invdet;
		if ( u < - TRI_INTERSECT_EPSILON ) {

			return false;

		}

		let v = -dot( edge1, DAO ) * invdet;
		let w = 1.0 - u - v;

		if ( v < - TRI_INTERSECT_EPSILON || w < - TRI_INTERSECT_EPSILON ) {

			return false;

		}

		( *result ).didHit = true;
		( *result ).barycoord = vec3f( w, u, v );
		( *result ).dist = t;
		( *result ).side = sign( det );
		( *result ).normal = ( *result ).side * normalize( n );

		return true;

	}

`, [ rayStruct, intersectionResultStruct, constants ] );

export const intersectTriangles = wgslFn( /* wgsl */ `

	fn intersectTriangles(
		bvh_position: ptr<storage, array<vec3f>, read>,
		bvh_index: ptr<storage, array<vec3u>, read>,
		offset: u32,
		count: u32,
		ray: Ray,
		closestResult: ptr<function, IntersectionResult>
	) -> void {

		for ( var i = offset; i < offset + count; i = i + 1u ) {

			let indices = bvh_index[ i ];
			let a = bvh_position[ indices.x ];
			let b = bvh_position[ indices.y ];
			let c = bvh_position[ indices.z ];

			var triResult: IntersectionResult;

			if ( intersectsTriangle( ray, a, b, c, ( *closestResult ).dist, &triResult ) ) {

				( *closestResult ) = triResult;
				( *closestResult ).indices = vec4u( indices.xyz, i );

			}

		}

	}

`, [ intersectsTriangle, rayStruct, intersectionResultStruct, constants ] );

export const bvhIntersectFirstHit = wgslFn( /* wgsl */ `

	fn bvhIntersectFirstHit(
		bvh_index: ptr<storage, array<vec3u>, read>,
		bvh_position: ptr<storage, array<vec3f>, read>,
		bvh: ptr<storage, array<BVHNode>,read>,
		ray: Ray,
	) -> IntersectionResult {

		var bestHit: IntersectionResult;
		bestHit.didHit = false;
		bestHit.dist = INFINITY;

		let invDir = 1.0 / ray.direction;

		// Check root first
		var rootHitDist: f32 = 0.0;
		if ( ! intersectsBoundsInvDir( ray, invDir, bvh, 0u, bestHit.dist, &rootHitDist ) ) {

			return bestHit;

		}

		var pointer = -1;
		var stack: array<u32, BVH_STACK_DEPTH>;
		var distStack: array<f32, BVH_STACK_DEPTH>;

		var currNodeIndex = 0u;

		loop {

			let boundsInfox = bvh[ currNodeIndex ].splitAxisOrTriangleCount;
			let boundsInfoy = bvh[ currNodeIndex ].rightChildOrTriangleOffset;

			let isLeaf = ( boundsInfox & 0xffff0000u ) != 0u;

			if ( isLeaf ) {

				let count = boundsInfox & 0x0000ffffu;
				let offset = boundsInfoy;

				intersectTriangles(
					bvh_position, bvh_index, offset,
					count, ray, &bestHit
				);

				// Pop next node from stack
				var popped = false;
				while ( pointer >= 0 ) {

					let topDist = distStack[ pointer ];
					let topIndex = stack[ pointer ];
					pointer = pointer - 1;

					if ( topDist <= bestHit.dist ) {

						currNodeIndex = topIndex;
						popped = true;
						break;

					}

				}

				if ( ! popped ) {

					break;

				}

			} else {

				let leftIndex = currNodeIndex + 1u;
				let rightIndex = currNodeIndex + boundsInfoy;

				var leftHitDist: f32 = 0.0;
				var rightHitDist: f32 = 0.0;

				let leftHit = intersectsBoundsInvDir( ray, invDir, bvh, leftIndex, bestHit.dist, &leftHitDist );
				let rightHit = intersectsBoundsInvDir( ray, invDir, bvh, rightIndex, bestHit.dist, &rightHitDist );

				if ( leftHit && rightHit ) {

					let leftToRight = leftHitDist < rightHitDist;
					let closerIndex = select( rightIndex, leftIndex, leftToRight );
					let furtherIndex = select( leftIndex, rightIndex, leftToRight );
					let closerDist = select( rightHitDist, leftHitDist, leftToRight );
					let furtherDist = select( leftHitDist, rightHitDist, leftToRight );

					// Push further node to stack
					pointer = pointer + 1;
					if ( pointer < i32( BVH_STACK_DEPTH ) ) {

						stack[ pointer ] = furtherIndex;
						distStack[ pointer ] = furtherDist;

					}

					// Go to closer node immediately
					currNodeIndex = closerIndex;

				} else if ( leftHit ) {

					currNodeIndex = leftIndex;

				} else if ( rightHit ) {

					currNodeIndex = rightIndex;

				} else {

					// Neither child intersects, pop next node
					var popped = false;
					while ( pointer >= 0 ) {

						let topDist = distStack[ pointer ];
						let topIndex = stack[ pointer ];
						pointer = pointer - 1;

						if ( topDist <= bestHit.dist ) {

							currNodeIndex = topIndex;
							popped = true;
							break;

						}

					}

					if ( ! popped ) {

						break;

					}

				}

			}

		}

		return bestHit;

	}

`, [ intersectTriangles, intersectsBoundsInvDir, rayStruct, bvhNodeStruct, intersectionResultStruct, constants ] );

