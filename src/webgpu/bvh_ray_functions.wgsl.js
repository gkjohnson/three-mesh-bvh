import { wgslFn } from 'three/tsl';
import {
	bvhNodeStruct, bvh2NodeStruct, intersectionResultStruct, intersectionResultWithStatsStruct,
	traversalStatsStruct, intersectsBounds, intersectsBoundsBVH2, rayStruct, constants,
	instanceStruct, tlasHitResultStruct
} from './common_functions.wgsl.js';

export const intersectsTriangle = wgslFn( /* wgsl */ `

	fn intersectsTriangle( ray: Ray, a: vec3f, b: vec3f, c: vec3f ) -> IntersectionResult {

		var result: IntersectionResult;
		result.didHit = false;

		let edge1 = b - a;
		let edge2 = c - a;
		let n = cross( edge1, edge2 );

		let det = - dot( ray.direction, n );

		if ( abs( det ) < TRI_INTERSECT_EPSILON ) {

			return result;

		}

		let invdet = 1.0 / det;

		let AO = ray.origin - a;
		let DAO = cross( AO, ray.direction );

		let u = dot( edge2, DAO ) * invdet;
		let v = -dot( edge1, DAO ) * invdet;
		let t = dot( AO, n ) * invdet;

		let w = 1.0 - u - v;

		if ( u < - TRI_INTERSECT_EPSILON || v < - TRI_INTERSECT_EPSILON || w < - TRI_INTERSECT_EPSILON || t < TRI_INTERSECT_EPSILON ) {

			return result;

		}

		result.didHit = true;
		result.barycoord = vec3f( w, u, v );
		result.dist = t;
		result.side = sign( det );
		result.normal = result.side * normalize( n );

		return result;

	}

`, [ rayStruct, intersectionResultStruct, constants ] );

export const intersectTriangles = wgslFn( /* wgsl */ `

	fn intersectTriangles(
		bvh_position: ptr<storage, array<vec3f>, read>,
		bvh_index: ptr<storage, array<vec3u>, read>,
		offset: u32,
		count: u32,
		ray: Ray
	) -> IntersectionResult {

		var closestResult: IntersectionResult;

		closestResult.didHit = false;
		closestResult.dist = INFINITY;

		for ( var i = offset; i < offset + count; i = i + 1u ) {

			let indices = bvh_index[ i ];
			let a = bvh_position[ indices.x ];
			let b = bvh_position[ indices.y ];
			let c = bvh_position[ indices.z ];

			var triResult = intersectsTriangle( ray, a, b, c );

			if ( triResult.didHit && triResult.dist < closestResult.dist ) {

				closestResult = triResult;
				closestResult.indices = vec4u( indices.xyz, i );

			}

		}

		return closestResult;

	}

`, [ intersectsTriangle, rayStruct, intersectionResultStruct, constants ] );

export const bvhIntersectFirstHit = wgslFn( /* wgsl */ `

	fn bvhIntersectFirstHit(
		bvh_index: ptr<storage, array<vec3u>, read>,
		bvh_position: ptr<storage, array<vec3f>, read>,
		bvh: ptr<storage, array<BVHNode>,read>,
		ray: Ray,
	) -> IntersectionResult {

		var pointer = 0;
		var stack: array<u32, BVH_STACK_DEPTH>;
		stack[ 0 ] = 0u;

		var bestHit: IntersectionResult;

		bestHit.didHit = false;
		bestHit.dist = INFINITY;

		loop {

			if ( pointer < 0 || pointer >= i32( BVH_STACK_DEPTH ) ) {

				break;

			}

			let currNodeIndex = stack[ pointer ];
			let node = bvh[ currNodeIndex ];

			pointer = pointer - 1;

			var boundsHitDistance: f32 = 0.0;

			if ( ! intersectsBounds( ray, node.bounds, &boundsHitDistance ) || boundsHitDistance > bestHit.dist ) {

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
					count, ray
				);

				if ( localHit.didHit && localHit.dist < bestHit.dist ) {

					bestHit = localHit;

				}

			} else {

				let leftIndex = currNodeIndex + 1u;
				let splitAxis = boundsInfox & 0x0000ffffu;
				let rightIndex = currNodeIndex + boundsInfoy;

				let leftToRight = ray.direction[splitAxis] >= 0.0;
				let c1 = select( rightIndex, leftIndex, leftToRight );
				let c2 = select( leftIndex, rightIndex, leftToRight );

				pointer = pointer + 1;
				stack[ pointer ] = c2;

				pointer = pointer + 1;
				stack[ pointer ] = c1;

			}

		}

		return bestHit;

	}

`, [ intersectTriangles, intersectsBounds, rayStruct, bvhNodeStruct, intersectionResultStruct, constants ] );

// BVH2 traversal - works directly with H-PLOC GPU builder output
// Uses absolute child indices instead of relative offsets
// Leaf nodes have leftChild == INVALID_IDX, rightChild == triangle index
export const bvh2IntersectFirstHit = wgslFn( /* wgsl */ `

	fn bvh2IntersectFirstHit(
		bvh_index: ptr<storage, array<vec3u>, read>,
		bvh_position: ptr<storage, array<vec3f>, read>,
		bvh: ptr<storage, array<BVH2Node>, read>,
		ray: Ray,
		rootIndex: u32,
	) -> IntersectionResult {

		const INVALID_IDX = 0xFFFFFFFFu;

		var pointer = 0;
		var stack: array<u32, BVH_STACK_DEPTH>;
		stack[ 0 ] = rootIndex;

		var bestHit: IntersectionResult;

		bestHit.didHit = false;
		bestHit.dist = INFINITY;

		loop {

			if ( pointer < 0 || pointer >= i32( BVH_STACK_DEPTH ) ) {

				break;

			}

			let currNodeIndex = stack[ pointer ];
			let node = bvh[ currNodeIndex ];

			pointer = pointer - 1;

			var boundsHitDistance: f32 = 0.0;

			if ( ! intersectsBoundsBVH2( ray, node.boundsMin, node.boundsMax, &boundsHitDistance ) || boundsHitDistance > bestHit.dist ) {

				continue;

			}

			let isLeaf = node.leftChild == INVALID_IDX;

			if ( isLeaf ) {

				// For leaf nodes, rightChild contains the triangle index
				let triIndex = node.rightChild;

				let indices = bvh_index[ triIndex ];
				let a = bvh_position[ indices.x ];
				let b = bvh_position[ indices.y ];
				let c = bvh_position[ indices.z ];

				var triResult = intersectsTriangle( ray, a, b, c );

				if ( triResult.didHit && triResult.dist < bestHit.dist ) {

					bestHit = triResult;
					bestHit.indices = vec4u( indices.xyz, triIndex );

				}

			} else {

				// Internal node - use absolute child indices
				let leftIndex = node.leftChild;
				let rightIndex = node.rightChild;

				// Determine traversal order based on ray direction and node bounds
				// Use the largest axis of the node extent as split axis heuristic
				let extent = node.boundsMax - node.boundsMin;
				var splitAxis = 0u;
				if ( extent.y > extent.x && extent.y > extent.z ) {
					splitAxis = 1u;
				} else if ( extent.z > extent.x ) {
					splitAxis = 2u;
				}

				let leftToRight = ray.direction[ splitAxis ] >= 0.0;
				let c1 = select( rightIndex, leftIndex, leftToRight );
				let c2 = select( leftIndex, rightIndex, leftToRight );

				pointer = pointer + 1;
				stack[ pointer ] = c2;

				pointer = pointer + 1;
				stack[ pointer ] = c1;

			}

		}

		return bestHit;

	}

`, [ intersectsTriangle, intersectsBoundsBVH2, rayStruct, bvh2NodeStruct, intersectionResultStruct, constants ] );

// BVH2 traversal with statistics collection - for BVH quality comparison
export const bvh2IntersectFirstHitWithStats = wgslFn( /* wgsl */ `

	fn bvh2IntersectFirstHitWithStats(
		bvh_index: ptr<storage, array<vec3u>, read>,
		bvh_position: ptr<storage, array<vec3f>, read>,
		bvh: ptr<storage, array<BVH2Node>, read>,
		ray: Ray,
		rootIndex: u32,
	) -> IntersectionResultWithStats {

		const INVALID_IDX = 0xFFFFFFFFu;

		var pointer = 0;
		var stack: array<u32, BVH_STACK_DEPTH>;
		stack[ 0 ] = rootIndex;

		var bestHit: IntersectionResultWithStats;

		bestHit.didHit = false;
		bestHit.dist = INFINITY;
		bestHit.stats.nodesVisited = 0u;
		bestHit.stats.trianglesTested = 0u;

		loop {

			if ( pointer < 0 || pointer >= i32( BVH_STACK_DEPTH ) ) {

				break;

			}

			let currNodeIndex = stack[ pointer ];
			let node = bvh[ currNodeIndex ];

			pointer = pointer - 1;

			bestHit.stats.nodesVisited = bestHit.stats.nodesVisited + 1u;

			var boundsHitDistance: f32 = 0.0;

			if ( ! intersectsBoundsBVH2( ray, node.boundsMin, node.boundsMax, &boundsHitDistance ) || boundsHitDistance > bestHit.dist ) {

				continue;

			}

			let isLeaf = node.leftChild == INVALID_IDX;

			if ( isLeaf ) {

				// For leaf nodes, rightChild contains the triangle index
				let triIndex = node.rightChild;

				bestHit.stats.trianglesTested = bestHit.stats.trianglesTested + 1u;

				let indices = bvh_index[ triIndex ];
				let a = bvh_position[ indices.x ];
				let b = bvh_position[ indices.y ];
				let c = bvh_position[ indices.z ];

				var triResult = intersectsTriangle( ray, a, b, c );

				if ( triResult.didHit && triResult.dist < bestHit.dist ) {

					bestHit.didHit = true;
					bestHit.indices = vec4u( indices.xyz, triIndex );
					bestHit.normal = triResult.normal;
					bestHit.barycoord = triResult.barycoord;
					bestHit.side = triResult.side;
					bestHit.dist = triResult.dist;

				}

			} else {

				// Internal node - use absolute child indices
				let leftIndex = node.leftChild;
				let rightIndex = node.rightChild;

				// Determine traversal order based on ray direction and node bounds
				let extent = node.boundsMax - node.boundsMin;
				var splitAxis = 0u;
				if ( extent.y > extent.x && extent.y > extent.z ) {
					splitAxis = 1u;
				} else if ( extent.z > extent.x ) {
					splitAxis = 2u;
				}

				let leftToRight = ray.direction[ splitAxis ] >= 0.0;
				let c1 = select( rightIndex, leftIndex, leftToRight );
				let c2 = select( leftIndex, rightIndex, leftToRight );

				pointer = pointer + 1;
				stack[ pointer ] = c2;

				pointer = pointer + 1;
				stack[ pointer ] = c1;

			}

		}

		return bestHit;

	}

`, [ intersectsTriangle, intersectsBoundsBVH2, rayStruct, bvh2NodeStruct, intersectionResultWithStatsStruct, traversalStatsStruct, constants ] );

// CPU BVH (flattened) traversal with statistics collection - for BVH quality comparison
export const bvhIntersectFirstHitWithStats = wgslFn( /* wgsl */ `

	fn bvhIntersectFirstHitWithStats(
		bvh_index: ptr<storage, array<vec3u>, read>,
		bvh_position: ptr<storage, array<vec3f>, read>,
		bvh: ptr<storage, array<BVHNode>,read>,
		ray: Ray,
	) -> IntersectionResultWithStats {

		var pointer = 0;
		var stack: array<u32, BVH_STACK_DEPTH>;
		stack[ 0 ] = 0u;

		var bestHit: IntersectionResultWithStats;

		bestHit.didHit = false;
		bestHit.dist = INFINITY;
		bestHit.stats.nodesVisited = 0u;
		bestHit.stats.trianglesTested = 0u;

		loop {

			if ( pointer < 0 || pointer >= i32( BVH_STACK_DEPTH ) ) {

				break;

			}

			let currNodeIndex = stack[ pointer ];
			let node = bvh[ currNodeIndex ];

			pointer = pointer - 1;

			bestHit.stats.nodesVisited = bestHit.stats.nodesVisited + 1u;

			var boundsHitDistance: f32 = 0.0;

			if ( ! intersectsBounds( ray, node.bounds, &boundsHitDistance ) || boundsHitDistance > bestHit.dist ) {

				continue;

			}

			let boundsInfox = node.splitAxisOrTriangleCount;
			let boundsInfoy = node.rightChildOrTriangleOffset;

			let isLeaf = ( boundsInfox & 0xffff0000u ) != 0u;

			if ( isLeaf ) {

				let count = boundsInfox & 0x0000ffffu;
				let offset = boundsInfoy;

				for ( var i = offset; i < offset + count; i = i + 1u ) {

					bestHit.stats.trianglesTested = bestHit.stats.trianglesTested + 1u;

					let indices = bvh_index[ i ];
					let a = bvh_position[ indices.x ];
					let b = bvh_position[ indices.y ];
					let c = bvh_position[ indices.z ];

					var triResult = intersectsTriangle( ray, a, b, c );

					if ( triResult.didHit && triResult.dist < bestHit.dist ) {

						bestHit.didHit = true;
						bestHit.indices = vec4u( indices.xyz, i );
						bestHit.normal = triResult.normal;
						bestHit.barycoord = triResult.barycoord;
						bestHit.side = triResult.side;
						bestHit.dist = triResult.dist;

					}

				}

			} else {

				let leftIndex = currNodeIndex + 1u;
				let splitAxis = boundsInfox & 0x0000ffffu;
				let rightIndex = currNodeIndex + boundsInfoy;

				let leftToRight = ray.direction[splitAxis] >= 0.0;
				let c1 = select( rightIndex, leftIndex, leftToRight );
				let c2 = select( leftIndex, rightIndex, leftToRight );

				pointer = pointer + 1;
				stack[ pointer ] = c2;

				pointer = pointer + 1;
				stack[ pointer ] = c1;

			}

		}

		return bestHit;

	}

`, [ intersectsTriangle, intersectsBounds, rayStruct, bvhNodeStruct, intersectionResultWithStatsStruct, traversalStatsStruct, constants ] );

// BLAS intersection with local indices (for TLAS/BLAS system)
// Returns hit in local space, caller must transform normal to world space
export const bvh2IntersectBLAS = wgslFn( /* wgsl */ `

	fn bvh2IntersectBLAS(
		bvh_index: ptr<storage, array<vec3u>, read>,
		bvh_position: ptr<storage, array<vec3f>, read>,
		bvh: ptr<storage, array<BVH2Node>, read>,
		localRay: Ray,
		rootIndex: u32,
		indexOffset: u32,
		positionOffset: u32,
		maxDist: f32,
	) -> IntersectionResult {

		const INVALID_IDX = 0xFFFFFFFFu;

		var pointer = 0;
		var stack: array<u32, BVH_STACK_DEPTH>;
		stack[ 0 ] = rootIndex;

		var bestHit: IntersectionResult;

		bestHit.didHit = false;
		bestHit.dist = maxDist;

		loop {

			if ( pointer < 0 || pointer >= i32( BVH_STACK_DEPTH ) ) {

				break;

			}

			let currNodeIndex = stack[ pointer ];
			let node = bvh[ currNodeIndex ];

			pointer = pointer - 1;

			var boundsHitDistance: f32 = 0.0;

			if ( ! intersectsBoundsBVH2( localRay, node.boundsMin, node.boundsMax, &boundsHitDistance ) || boundsHitDistance > bestHit.dist ) {

				continue;

			}

			let isLeaf = node.leftChild == INVALID_IDX;

			if ( isLeaf ) {

				// For leaf nodes, rightChild contains the local triangle index
				let localTriIndex = node.rightChild;
				let globalTriIndex = indexOffset + localTriIndex;

				let indices = bvh_index[ globalTriIndex ];
				let a = bvh_position[ indices.x ];
				let b = bvh_position[ indices.y ];
				let c = bvh_position[ indices.z ];

				var triResult = intersectsTriangle( localRay, a, b, c );

				if ( triResult.didHit && triResult.dist < bestHit.dist ) {

					bestHit = triResult;
					bestHit.indices = vec4u( indices.xyz, globalTriIndex );

				}

			} else {

				let leftIndex = node.leftChild;
				let rightIndex = node.rightChild;

				let extent = node.boundsMax - node.boundsMin;
				var splitAxis = 0u;
				if ( extent.y > extent.x && extent.y > extent.z ) {
					splitAxis = 1u;
				} else if ( extent.z > extent.x ) {
					splitAxis = 2u;
				}

				let leftToRight = localRay.direction[ splitAxis ] >= 0.0;
				let c1 = select( rightIndex, leftIndex, leftToRight );
				let c2 = select( leftIndex, rightIndex, leftToRight );

				pointer = pointer + 1;
				stack[ pointer ] = c2;

				pointer = pointer + 1;
				stack[ pointer ] = c1;

			}

		}

		return bestHit;

	}

`, [ intersectsTriangle, intersectsBoundsBVH2, rayStruct, bvh2NodeStruct, intersectionResultStruct, constants ] );

// Two-level BVH traversal: TLAS over instances, BLAS for geometry
// TLAS is a simple BVH2 over instance AABBs
// Each TLAS leaf contains an instance index
export const tlasBlasIntersect = wgslFn( /* wgsl */ `

	fn tlasBlasIntersect(
		tlas: ptr<storage, array<BVH2Node>, read>,
		instances: ptr<storage, array<Instance>, read>,
		blas: ptr<storage, array<BVH2Node>, read>,
		bvh_index: ptr<storage, array<vec3u>, read>,
		bvh_position: ptr<storage, array<vec3f>, read>,
		worldRay: Ray,
		tlasRootIndex: u32,
	) -> TLASHitResult {

		const INVALID_IDX = 0xFFFFFFFFu;
		const INSTANCE_FLAG = 0x80000000u;

		var pointer = 0;
		var stack: array<u32, BVH_STACK_DEPTH>;
		stack[ 0 ] = tlasRootIndex;

		var bestHit: TLASHitResult;
		bestHit.didHit = false;
		bestHit.dist = INFINITY;
		bestHit.instanceIndex = 0u;
		bestHit.materialIndex = 0u;

		loop {

			if ( pointer < 0 || pointer >= i32( BVH_STACK_DEPTH ) ) {

				break;

			}

			let currNodeIndex = stack[ pointer ];
			let node = tlas[ currNodeIndex ];

			pointer = pointer - 1;

			var boundsHitDistance: f32 = 0.0;

			if ( ! intersectsBoundsBVH2( worldRay, node.boundsMin, node.boundsMax, &boundsHitDistance ) || boundsHitDistance > bestHit.dist ) {

				continue;

			}

			let isLeaf = node.leftChild == INVALID_IDX;

			if ( isLeaf ) {

				// TLAS leaf: rightChild contains instance index
				let instanceIndex = node.rightChild;
				let instance = instances[ instanceIndex ];

				// Transform ray to local space
				var localRay: Ray;
				let origin4 = instance.inverseTransform * vec4f( worldRay.origin, 1.0 );
				localRay.origin = origin4.xyz;
				let dir4 = instance.inverseTransform * vec4f( worldRay.direction, 0.0 );
				localRay.direction = dir4.xyz;

				// Traverse BLAS in local space
				let blasHit = bvh2IntersectBLAS(
					bvh_index,
					bvh_position,
					blas,
					localRay,
					instance.blasRootIndex + instance.blasOffset,
					instance.indexOffset,
					instance.positionOffset,
					bestHit.dist
				);

				if ( blasHit.didHit && blasHit.dist < bestHit.dist ) {

					bestHit.didHit = true;
					bestHit.dist = blasHit.dist;
					bestHit.indices = blasHit.indices;
					bestHit.barycoord = blasHit.barycoord;
					bestHit.side = blasHit.side;
					bestHit.instanceIndex = instanceIndex;
					bestHit.materialIndex = instance.materialIndex;

					// Transform normal from local to world space
					let n4 = transpose( instance.inverseTransform ) * vec4f( blasHit.normal, 0.0 );
					bestHit.normal = normalize( n4.xyz );

				}

			} else {

				let leftIndex = node.leftChild;
				let rightIndex = node.rightChild;

				let extent = node.boundsMax - node.boundsMin;
				var splitAxis = 0u;
				if ( extent.y > extent.x && extent.y > extent.z ) {
					splitAxis = 1u;
				} else if ( extent.z > extent.x ) {
					splitAxis = 2u;
				}

				let leftToRight = worldRay.direction[ splitAxis ] >= 0.0;
				let c1 = select( rightIndex, leftIndex, leftToRight );
				let c2 = select( leftIndex, rightIndex, leftToRight );

				pointer = pointer + 1;
				stack[ pointer ] = c2;

				pointer = pointer + 1;
				stack[ pointer ] = c1;

			}

		}

		return bestHit;

	}

`, [ bvh2IntersectBLAS, intersectsBoundsBVH2, rayStruct, bvh2NodeStruct, instanceStruct, tlasHitResultStruct, constants ] );
