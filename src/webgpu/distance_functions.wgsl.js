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

export const closestPointToTriangleOpt = wgslFn( /* wgsl */ `

	fn closestPointToTriangleOpt( p: vec3f, v0: vec3f, v1: vec3f, v2: vec3f, minDistSq: f32 ) -> ClosestPointToTriangleResult {

		let v10 = v1 - v0;
		let v21 = v2 - v1;
		let v02 = v0 - v2;

		let p0 = p - v0;
		let p1 = p - v1;
		let p2 = p - v2;

		let nor = cross( v10, v02 );
		let dot_nor_nor = dot( nor, nor );
		let d = 1.0 / dot_nor_nor;

		let dot_p0_nor = dot( p0, nor );
		let distToPlaneSq = ( dot_p0_nor * dot_p0_nor ) * d;
		if ( distToPlaneSq >= minDistSq ) {

			var result: ClosestPointToTriangleResult;
			result.barycoord = vec3f( -1.0, -1.0, -1.0 );
			return result;

		}

		// method 2, in barycentric space
		let  q = cross( nor, p0 );
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
		// Read geometry as vec4 because storage-buffer vec3 array elements use 16-byte stride.
		bvh_index: ptr<storage, array<vec4u>, read>,
		bvh_position: ptr<storage, array<vec4f>, read>,

		offset: u32, count: u32,

		// point and current result. Cut off range is taken from the struct
		point: vec3f,
		ioRes: ptr<function, ClosestPointToPointResult>,
	) -> void {

		for ( var i = offset; i < offset + count; i = i + 1u ) {

			let indices = bvh_index[ i ];
			let a = bvh_position[ indices.x ].xyz;
			let b = bvh_position[ indices.y ].xyz;
			let c = bvh_position[ indices.z ].xyz;

			// get the closest point and barycoord
			let pointRes = closestPointToTriangleOpt( point, a, b, c, ioRes.distanceSq );
			if ( pointRes.barycoord.x < 0.0 ) {

				continue;

			}
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
`, [ closestPointToTriangleOpt, closestPointToPointResultStruct ] );

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

		let minBounds = vec3f(
			bvh[ currNodeIndex ].bounds.min[0],
			bvh[ currNodeIndex ].bounds.min[1],
			bvh[ currNodeIndex ].bounds.min[2]
		);
		let maxBounds = vec3f(
			bvh[ currNodeIndex ].bounds.max[0],
			bvh[ currNodeIndex ].bounds.max[1],
			bvh[ currNodeIndex ].bounds.max[2]
		);
		return distanceSqToBounds( point, minBounds, maxBounds );

	}
`, [ distanceSqToBounds, bvhNodeStruct ] );

export const closestPointToPoint = wgslFn( /* wgsl */ `
	fn bvhClosestPointToPoint(
		bvh_index: ptr<storage, array<vec4u>, read>,
		bvh_position: ptr<storage, array<vec4f>, read>,
		bvh: ptr<storage, array<BVHNode>, read>,

		point: vec3f,
		maxDistance: f32
	) -> ClosestPointToPointResult {

		const BVH_STACK_DEPTH = 64;

		var res: ClosestPointToPointResult;
		res.distanceSq = maxDistance * maxDistance;

		// Check root first
		let rootDist = distanceSqToBVHNodeBoundsPoint( point, bvh, 0u );
		if ( rootDist > res.distanceSq ) {

			return res;

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
				distanceToTriangles(
					bvh_index, bvh_position,
					offset, count,
					point, &res
				);

				// Pop next node
				var popped = false;
				while ( pointer >= 0 ) {

					let topDist = distStack[ pointer ];
					let topIndex = stack[ pointer ];
					pointer = pointer - 1;

					if ( topDist <= res.distanceSq ) {

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

				let leftDist = distanceSqToBVHNodeBoundsPoint( point, bvh, leftIndex );
				let rightDist = distanceSqToBVHNodeBoundsPoint( point, bvh, rightIndex );

				let leftHit = leftDist <= res.distanceSq;
				let rightHit = rightDist <= res.distanceSq;

				if ( leftHit && rightHit ) {

					let leftToRight = leftDist < rightDist;
					let closerIndex = select( rightIndex, leftIndex, leftToRight );
					let furtherIndex = select( leftIndex, rightIndex, leftToRight );
					let closerDist = select( rightDist, leftDist, leftToRight );
					let furtherDist = select( leftDist, rightDist, leftToRight );

					// Push further
					pointer = pointer + 1;
					if ( pointer < BVH_STACK_DEPTH ) {

						stack[ pointer ] = furtherIndex;
						distStack[ pointer ] = furtherDist;

					}

					// Go to closer immediately
					currNodeIndex = closerIndex;

				} else if ( leftHit ) {

					currNodeIndex = leftIndex;

				} else if ( rightHit ) {

					currNodeIndex = rightIndex;

				} else {

					// Neither within range, pop next node
					var popped = false;
					while ( pointer >= 0 ) {

						let topDist = distStack[ pointer ];
						let topIndex = stack[ pointer ];
						pointer = pointer - 1;

						if ( topDist <= res.distanceSq ) {

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

		return res;

	}
`, [ bvhNodeStruct, closestPointToPointResultStruct, distanceToTriangles, distanceSqToBVHNodeBoundsPoint ] );
