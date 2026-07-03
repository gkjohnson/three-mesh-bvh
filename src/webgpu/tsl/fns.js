/** @import { FunctionNode } from 'three/tsl'; */
import { wgslTagFn } from '../nodes/WGSLTagFnNode.js';
import { rayIntersectionResultStruct, rayStruct } from './structs.js';

/**
 * WGSL function node that finds the closest point on a triangle to `p` and returns the barycoord.
 * @type {FunctionNode}
 * @section TSL Functions
 */
export const closestPointToTriangle = wgslTagFn/* wgsl */`
	// fn
	fn closestPointToTriangle(
		p: vec3f,
		v0: vec3f,
		v1: vec3f,
		v2: vec3f
	) -> vec3f {

		let v10 = v1 - v0;
		let v21 = v2 - v1;
		let v02 = v0 - v2;
		let p0 = p - v0;
		let p1 = p - v1;
		let p2 = p - v2;

		let nor = cross( v10, v02 );
		let q = cross( nor, p0 );
		let d = 1.0 / dot( nor, nor );
		var u = d * dot( q, v02 );
		var v = d * dot( q, v10 );
		var w = 1.0 - u - v;

		if ( u < 0.0 ) {

			w = clamp( dot( p2, v02 ) / dot( v02, v02 ), 0.0, 1.0 );
			u = 0.0;
			v = 1.0 - w;

		} else if ( v < 0.0 ) {

			u = clamp( dot( p0, v10 ) / dot( v10, v10 ), 0.0, 1.0 );
			v = 0.0;
			w = 1.0 - u;

		} else if ( w < 0.0 ) {

			v = clamp( dot( p1, v21 ) / dot( v21, v21 ), 0.0, 1.0 );
			w = 0.0;
			u = 1.0 - v;

		}

		return vec3f( w, u, v );

	}
`;

/**
 * WGSL function node that tests a ray against a single triangle and returns an
 * {@link rayIntersectionResultStruct} result. Useful when writing a custom `intersectRangeFn`
 * for {@link BVHComputeData#getShapecastFn}.
 * @type {FunctionNode}
 * @section TSL Functions
 */
export const intersectRayTriangle = wgslTagFn/* wgsl */ `
	// fn
	fn intersectRayTriangle( ray: ${ rayStruct }, a: vec3f, b: vec3f, c: vec3f, threshold: f32 ) -> ${ rayIntersectionResultStruct } {

		const DET_EPSILON = 1e-15;

		var result: ${ rayIntersectionResultStruct };
		result.didHit = false;

		let edge1 = b - a;
		let edge2 = c - a;
		let n = cross( edge1, edge2 );

		let det = - dot( ray.direction, n );
		if ( abs( det ) < DET_EPSILON ) {

			return result;

		}

		let invdet = 1.0 / det;

		let AO = ray.origin - a;
		let DAO = cross( AO, ray.direction );

		let u = dot( edge2, DAO ) * invdet;
		if ( u < 0.0 || u > 1.0 ) {

			return result;

		}

		let v = - dot( edge1, DAO ) * invdet;
		if ( v < 0.0 || u + v > 1.0 ) {

			return result;

		}

		let t = dot( AO, n ) * invdet;
		let w = 1.0 - u - v;
		if ( t < threshold ) {

			return result;

		}

		result.didHit = true;
		result.barycoord = vec3f( w, u, v );
		result.dist = t;
		result.side = sign( det );
		result.normal = result.side * normalize( n );

		return result;

	}
`;

/**
 * WGSL function node that builds a camera ray (origin + far-plane direction) from an NDC
 * coordinate and an inverse model-view-projection matrix. Works for both perspective and
 * orthographic projections. The returned direction is not normalized and extends to the
 * camera far plane.
 * @type {FunctionNode}
 * @section TSL Functions
 */
export const ndcToCameraRay = wgslTagFn/* wgsl */`
	// fn
	fn ndcToCameraRay( ndc: vec2f, inverseModelViewProjection: mat4x4f ) -> ${ rayStruct } {

		var homogeneous = vec4f();
		var ray: ${ rayStruct };

		homogeneous = inverseModelViewProjection * vec4f( ndc, 0.0, 1.0 );
		ray.origin = homogeneous.xyz / homogeneous.w;

		homogeneous = inverseModelViewProjection * vec4f( ndc, 1.0, 1.0 );
		ray.direction = ( homogeneous.xyz / homogeneous.w ) - ray.origin;

		return ray;

	}
`;
