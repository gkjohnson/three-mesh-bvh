import { StructTypeNode } from 'three/webgpu';

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
	visible: 'uint',
	_alignment0: 'uint',
	_alignment1: 'uint',
	_alignment2: 'uint',
}, 'TransformStruct' );


/**
 * WGSL struct node representing a ray with an origin and direction.
 * Used as the input to BVH traversal and intersection functions.
 * @type {StructTypeNode}
 * @section TSL Structs
 */
export const rayStruct = new StructTypeNode( {
	origin: 'vec3f',
	direction: 'vec3f',
}, 'Ray' );

/**
 * WGSL struct node describing a ray–triangle intersection result, including barycentric
 * coordinates, world-space normal, hit distance, face side, triangle indices, and the
 * object index within the TLAS.
 * @type {StructTypeNode}
 * @section TSL Structs
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
 * @type {StructTypeNode}
 * @section TSL Structs
 */
export const pointQueryResultStruct = new StructTypeNode( {
	faceIndices: 'vec4u',
	closestPoint: 'vec3f',
	found: 'bool',
	barycoord: 'vec3f',
	objectIndex: 'uint',
	faceNormal: 'vec3f',
	side: 'float',
	distanceSq: 'float',
}, 'PointQueryResult' );
