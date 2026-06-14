import { StructTypeNode } from 'three/webgpu';
import { wgslTagFn } from '../nodes/WGSLTagFnNode.js';

// temporary shim so StructTypeNodes can be passed to storage functions until
// this is fixed in three.js
Object.defineProperty( StructTypeNode.prototype, 'layout', {

	get() {

		return this;

	}

} );
StructTypeNode.prototype.isStruct = true;

//

export const bvhNodeBoundsStruct = new StructTypeNode( {
	min: 'array<f32, 3>',
	max: 'array<f32, 3>',
}, 'BVHBoundingBox' );
bvhNodeBoundsStruct.getLength = () => 6;

export const bvhNodeStruct = new StructTypeNode( {
	bounds: 'BVHBoundingBox',
	rightChildOrTriangleOffset: 'uint',
	splitAxisOrTriangleCount: 'uint',
}, 'BVHNode' );
bvhNodeStruct.getLength = () => bvhNodeBoundsStruct.getLength() + 2;

export const transformStruct = new StructTypeNode( {
	matrixWorld: 'mat4x4f',
	inverseMatrixWorld: 'mat4x4f',
	nodeOffset: 'uint',
	visible: 'uint',
	_alignment0: 'uint',
	_alignment1: 'uint',
}, 'TransformStruct' );


/**
 * WGSL struct node representing a ray with an origin and direction.
 * Used as the input to BVH traversal and intersection functions.
 */
export const rayStruct = new StructTypeNode( {
	origin: 'vec3f',
	direction: 'vec3f',
}, 'Ray' );

/**
 * WGSL struct node describing a ray–triangle intersection result, including barycentric
 * coordinates, world-space normal, hit distance, face side, triangle indices, and the
 * object index within the TLAS.
 */
export const rayIntersectionResultStruct = new StructTypeNode( {
	indices: 'vec4u',
	normal: 'vec3f',
	didHit: 'bool',
	barycoord: 'vec3f',
	objectIndex: 'uint',
	side: 'float',
	dist: 'float',
}, 'IntersectionResult' );

/**
 * WGSL struct node describing a closest-point query result, including the world-space
 * closest point, squared distance, barycentric coordinates, face normal, side, triangle
 * indices, and the object index within the TLAS.
 *
 * Barycoord convention matches {@link rayIntersectionResultStruct}: `(bary_a, bary_b, bary_c)`
 * where each component is the weight for the corresponding vertex in `faceIndices.xyz`.
 */
export const pointQueryResultStruct = new StructTypeNode( {
	faceIndices: 'vec4u',
	closestPoint: 'vec3f',
	found: 'bool',
	barycoord: 'vec3f',
	objectIndex: 'uint',
	normal: 'vec3f',
	side: 'float',
	distanceSq: 'float',
}, 'PointQueryResult' );

/**
 * WGSL function node that finds the closest point on a triangle to `p` and returns a
 * {@link pointQueryResultStruct}. `faceIndices` and `objectIndex` are left zero — fill
 * them in the caller. Useful when writing a custom `intersectRangeFn` for
 * {@link BVHComputeData#getShapecastFn}.
 */
export const closestPointToTriangle = wgslTagFn/* wgsl */`
	// fn
	fn closestPointToTriangle(
		p: vec3f,
		v0: vec3f,
		v1: vec3f,
		v2: vec3f,
		outPoint: ptr<function, vec3f>,
		outBarycoord: ptr<function, vec3f>
	) -> void {

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

		let closestPoint = w * v0 + u * v1 + v * v2;

		outBarycoord.x = w;
		outBarycoord.y = u;
		outBarycoord.z = v;

		outPoint.x = closestPoint.x;
		outPoint.y = closestPoint.y;
		outPoint.z = closestPoint.z;

	}
`;

/**
 * WGSL function node that tests a ray against a single triangle and returns an
 * {@link rayIntersectionResultStruct} result. Useful when writing a custom `intersectRangeFn`
 * for {@link BVHComputeData#getShapecastFn}.
 */
export const intersectRayTriangle = wgslTagFn/* wgsl */ `
	// fn
	fn intersectRayTriangle( ray: ${ rayStruct }, a: vec3f, b: vec3f, c: vec3f ) -> ${ rayIntersectionResultStruct } {

		// TODO: consider using a pointer to the result struct here
		// TODO: see if we can remove the "DIST" epsilon and account for it on ray origin bounce positioning
		const DET_EPSILON = 1e-15;
		const DIST_EPSILON = 1e-5;

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
		if ( t < DIST_EPSILON ) {

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
