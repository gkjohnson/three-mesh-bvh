import { wgslFn, wgsl } from 'three/tsl';
import { bvhNodeStruct } from './common_functions.wgsl.js';

export const closestPointToPointResultStruct = wgsl( /* wgsl */ `
	struct ClosestPointToPointResult {
		faceIndices: vec4u,
		faceNormal: vec3f,
		barycoord: vec3f,
		point: vec3f,
		side: f32,
		distanceSq: f32,
		found: bool,
	};
` );

export const closestPointToTriangleResultStruct = wgsl( /* wgsl */ `
	struct ClosestPointToTriangleResult {
		barycoord: vec3f,
		point: vec3f,
	};
` );

export const closestPointToTriangle = wgslFn( /* wgsl */ `

	fn closestPointToTriangle( p: vec3f, v0: vec3f, v1: vec3f, v2: vec3f ) -> ClosestPointToTriangleResult {
		// https://www.shadertoy.com/view/ttfGWl

		let v10 = v1 - v0;
		let v21 = v2 - v1;
		let v02 = v0 - v2;

		let p0 = p - v0;
		let p1 = p - v1;
		let p2 = p - v2;

		let nor = cross( v10, v02 );

		// method 2, in barycentric space
		let  q = cross( nor, p0 );
		let d = 1.0 / dot( nor, nor );
		var u = d * dot( q, v02 );
		var v = d * dot( q, v10 );
		var w = 1.0 - u - v;

		if( u < 0.0 ) {

			w = clamp( dot( p2, v02 ) / dot( v02, v02 ), 0.0, 1.0 );
			u = 0.0;
			v = 1.0 - w;

		} else if( v < 0.0 ) {

			u = clamp( dot( p0, v10 ) / dot( v10, v10 ), 0.0, 1.0 );
			v = 0.0;
			w = 1.0 - u;

		} else if( w < 0.0 ) {

			v = clamp( dot( p1, v21 ) / dot( v21, v21 ), 0.0, 1.0 );
			w = 0.0;
			u = 1.0 - v;

		}

		var result: ClosestPointToTriangleResult;
		result.barycoord = vec3f( u, v, w );
		result.point = u * v1 + v * v2 + w * v0;

		return result;

	}
`, [ closestPointToTriangleResultStruct ] );

export const distanceToTriangles = wgslFn( /* wgsl */ `
	fn distanceToTriangles(
		// geometry info and triangle range
		bvh_index: ptr<storage, array<vec3u>, read>,
		bvh_position: ptr<storage, array<vec3f>, read>,

		offset: u32, count: u32,

		// point and current result. Cut off range is taken from the struct
		point: vec3f,
		ioRes: ptr<function, ClosestPointToPointResult>,
	) -> void {

		for ( var i = offset; i < offset + count; i = i + 1u ) {

			let indices = bvh_index[ i ];
			let a = bvh_position[ indices.x ];
			let b = bvh_position[ indices.y ];
			let c = bvh_position[ indices.z ];

			// get the closest point and barycoord
			let pointRes = closestPointToTriangle( point, a, b, c );
			let delta = point - pointRes.point;
			let distSq = dot( delta, delta );
			if ( distSq < ioRes.distanceSq ) {

				// set the output results
				ioRes.distanceSq = distSq;
				ioRes.faceIndices = vec4u( indices.xyz, i );
				ioRes.faceNormal = normalize( cross( a - b, b - c ) );
				ioRes.barycoord = pointRes.barycoord;
				ioRes.point = pointRes.point;
				ioRes.side = sign( dot( ioRes.faceNormal, delta ) );

			}

		}

	}
`, [ closestPointToTriangle, closestPointToPointResultStruct ] );

export const distanceSqToBounds = wgslFn( /* wgsl */ `
	fn distanceSqToBounds( point: vec3f, boundsMin: vec3f, boundsMax: vec3f ) -> f32 {

		let clampedPoint = clamp( point, boundsMin, boundsMax );
		let delta = point - clampedPoint;
		return dot( delta, delta );

	}
` );

export const distanceSqToBVHNodeBoundsPoint = wgslFn( /* wgsl */ `
	fn distanceSqToBVHNodeBoundsPoint(
		point: vec3f,
		bvh: ptr<storage, array<BVHNode>, read>,
		currNodeIndex: u32,
	) -> f32 {

		let node = bvh[ currNodeIndex ];
		let minBounds = vec3f(node.bounds.min[0], node.bounds.min[1], node.bounds.min[2]);
		let maxBounds = vec3f(node.bounds.max[0], node.bounds.max[1], node.bounds.max[2]);
		return distanceSqToBounds( point, minBounds, maxBounds );

	}
`, [ distanceSqToBounds, bvhNodeStruct ] );

export const closestPointToPoint = wgslFn( /* wgsl */ `
	fn bvhClosestPointToPoint(
		bvh_index: ptr<storage, array<vec3u>, read>,
		bvh_position: ptr<storage, array<vec3f>, read>,
		bvh: ptr<storage, array<BVHNode>, read>,

		point: vec3f,
		maxDistance: f32
	) -> ClosestPointToPointResult {

		const BVH_STACK_DEPTH = 64;

		// stack needs to be twice as long as the deepest tree we expect because
		// we push both the left and right child onto the stack every traversal
		var ptr = 0;
		var stack: array<u32, BVH_STACK_DEPTH>;
		stack[ 0 ] = 0u;

		var res: ClosestPointToPointResult;
		res.distanceSq = maxDistance * maxDistance;

		while ptr > - 1 && ptr < BVH_STACK_DEPTH {

			let currNodeIndex = stack[ ptr ];
			let node = bvh[ currNodeIndex ];
			ptr = ptr - 1;

			// check if we intersect the current bounds
			let boundsDistance = distanceSqToBVHNodeBoundsPoint( point, bvh, currNodeIndex );
			if ( boundsDistance > res.distanceSq ) {

				continue;

			}

			let boundsInfox = node.splitAxisOrTriangleCount;
			let boundsInfoy = node.rightChildOrTriangleOffset;

			let isLeaf = ( boundsInfox & 0xffff0000u ) != 0u;

			if ( isLeaf ) {

				let count = boundsInfox & 0x0000ffffu;
				let offset = boundsInfoy;
				distanceToTriangles(
					bvh_index, bvh_position,
					offset, count,
					point, &res
				);

			} else {

				let leftIndex = currNodeIndex + 1u;
				let splitAxis = boundsInfox & 0x0000ffffu;
				let rightIndex = 4u * boundsInfoy / 32u;

				let leftToRight = distanceSqToBVHNodeBoundsPoint( point, bvh, leftIndex ) < distanceSqToBVHNodeBoundsPoint( point, bvh, rightIndex );
				let c1 = select( rightIndex, leftIndex, leftToRight );
				let c2 = select( leftIndex, rightIndex, leftToRight );

				ptr = ptr + 1;
				stack[ ptr ] = c2;

				ptr = ptr + 1;
				stack[ ptr ] = c1;

			}

		}

		return res;

	}
`, [ bvhNodeStruct, closestPointToPointResultStruct, distanceToTriangles, distanceSqToBVHNodeBoundsPoint ] );
