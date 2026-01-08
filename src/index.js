export * from './core/BVH.js';
export * from './core/MeshBVH.js';
export * from './core/LineBVH.js';
export * from './core/PointsBVH.js';
export * from './objects/BVHHelper.js';
export { CENTER, AVERAGE, SAH, NOT_INTERSECTED, INTERSECTED, CONTAINED } from './core/Constants.js';
export { getBVHExtremes, estimateMemoryInBytes, getJSONStructure, validateBounds } from './debug/Debug.js';
export * from './utils/ExtensionUtilities.js';
export { getTriangleHitPointInfo } from './utils/TriangleUtilities.js';
export * from './math/ExtendedTriangle.js';
export * from './math/OrientedBox.js';
export * from './webgl/MeshBVHUniformStruct.js';
export * from './webgl/VertexAttributeTexture.js';
export * from './utils/StaticGeometryGenerator.js';
export * as BVHShaderGLSL from './webgl/BVHShaderGLSL.js';

// backwards compatibility
import * as BVHShaderGLSL from './webgl/BVHShaderGLSL.js';
export const shaderStructs = BVHShaderGLSL.bvh_struct_definitions;
export const shaderDistanceFunction = BVHShaderGLSL.bvh_distance_functions;
export const shaderIntersectFunction = `
	${ BVHShaderGLSL.common_functions }
	${ BVHShaderGLSL.bvh_ray_functions }
`;
