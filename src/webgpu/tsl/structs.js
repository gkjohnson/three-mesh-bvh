import { StructTypeNode } from 'three/webgpu';
import { uint } from 'three/tsl';
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

export const rayStruct = new StructTypeNode( {
	origin: 'vec3f',
	direction: 'vec3f',
}, 'Ray' );

export const transformStruct = new StructTypeNode( {
	matrixWorld: 'mat4x4f',
	inverseMatrixWorld: 'mat4x4f',
	nodeOffset: 'uint',
	visible: 'uint',
	_alignment0: 'uint',
	_alignment1: 'uint',
}, 'TransformStruct' );

export const BVH_STACK_DEPTH = uint( 60 );

//

/**
 * WGSL struct node describing a ray–triangle intersection result, including barycentric
 * coordinates, world-space normal, hit distance, face side, triangle indices, and the
 * object index within the TLAS.
 */
export const intersectionResultStruct = new StructTypeNode( {
	indices: 'vec4u',
	normal: 'vec3f',
	didHit: 'bool',
	barycoord: 'vec3f',
	objectIndex: 'uint',
	side: 'float',
	dist: 'float',
}, 'IntersectionResult' );

/**
 * WGSL function node that tests a ray against a single triangle and returns an
 * {@link intersectionResultStruct} result. Useful when writing a custom `intersectRangeFn`
 * for {@link BVHComputeData#getShapecastFn}.
 */
export const intersectsTriangle = wgslTagFn/* wgsl */ `
	// fn
	fn intersectsTriangle( ray: ${ rayStruct }, a: vec3f, b: vec3f, c: vec3f ) -> ${ intersectionResultStruct } {

		// TODO: see if we can remove the "DIST" epsilon and account for it on ray origin bounce positioning
		const DET_EPSILON = 1e-15;
		const DIST_EPSILON = 1e-5;

		var result: ${ intersectionResultStruct };
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
