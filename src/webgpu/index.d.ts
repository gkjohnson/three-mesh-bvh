import { wgsl, wgslFn } from 'three/tsl';

export const bvhIntersectFirstHit: ReturnType<typeof wgslFn>;
export const closestPointToPoint: ReturnType<typeof wgslFn>;

export const bvhNodeBoundsStruct: ReturnType<typeof wgsl>;
export const bvhNodeStruct: ReturnType<typeof wgsl>;
export const rayStruct: ReturnType<typeof wgsl>;
export const intersectionResultStruct: ReturnType<typeof wgsl>;
export const closestPointToPointResultStruct: ReturnType<typeof wgsl>;
export const closestPointToTriangleResultStruct: ReturnType<typeof wgsl>;

export const intersectsTriangle: ReturnType<typeof wgslFn>;
export const intersectTriangles: ReturnType<typeof wgslFn>;
export const intersectsBounds: ReturnType<typeof wgslFn>;
export const getVertexAttribute: ReturnType<typeof wgslFn>;
export const ndcToCameraRay: ReturnType<typeof wgslFn>;
export const closestPointToTriangle: ReturnType<typeof wgslFn>;
export const distanceToTriangles: ReturnType<typeof wgslFn>;
export const distanceSqToBounds: ReturnType<typeof wgslFn>;
export const distanceSqToBVHNodeBoundsPoint: ReturnType<typeof wgslFn>;
