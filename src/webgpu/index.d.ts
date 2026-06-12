import { wgsl, wgslFn } from 'three/tsl';
import { ObjectBVH } from '../core/ObjectBVH.js';

export const bvhIntersectFirstHit: ReturnType<typeof wgslFn>;
export const closestPointToPoint: ReturnType<typeof wgslFn>;

export const bvhNodeBoundsStruct: ReturnType<typeof wgsl>;
export const bvhNodeStruct: ReturnType<typeof wgsl>;
export const rayStruct: ReturnType<typeof wgsl>;
export const intersectionResultStruct: ReturnType<typeof wgsl>;
export const closestPointToPointResultStruct: ReturnType<typeof wgsl>;
export const closestPointToTriangleResultStruct: ReturnType<typeof wgsl>;

export const intersectsTriangle: ReturnType<typeof wgslFn>;
export const intersectRayTriangle: ReturnType<typeof wgslFn>;
export const intersectTriangles: ReturnType<typeof wgslFn>;
export const intersectsBounds: ReturnType<typeof wgslFn>;
export const getVertexAttribute: ReturnType<typeof wgslFn>;
export const ndcToCameraRay: ReturnType<typeof wgslFn>;
export const closestPointToTriangle: ReturnType<typeof wgslFn>;
export const distanceToTriangles: ReturnType<typeof wgslFn>;
export const distanceSqToBounds: ReturnType<typeof wgslFn>;
export const distanceSqToBVHNodeBoundsPoint: ReturnType<typeof wgslFn>;

export class BVHComputeData {

	bvh: ObjectBVH;
	autogenerateBvh: boolean;
	attributes: Record<string, string>;

	storage: {
		index: unknown;
		attributes: unknown;
		nodes: unknown;
		transforms: unknown;
	};

	structs: {
		transform: unknown;
		attributes: unknown;
	};

	fns: {
		raycastFirstHit: unknown;
		sampleTrianglePoint: unknown;
	};

	constructor( bvh: ObjectBVH | object | object[], options?: {
		attributes?: Record<string, string>;
		autogenerateBvh?: boolean;
	} );

	update(): void;
	getShapecastFn( options: {
		name?: string;
		shapeStruct: unknown;
		resultStruct?: unknown;
		boundsOrderFn?: unknown;
		intersectsBoundsFn: unknown;
		intersectRangeFn: unknown;
		transformShapeFn?: unknown;
		transformResultFn?: unknown;
	} ): unknown;

	writeTransformData( info: object, premultiplyMatrix: unknown, writeOffset: number, targetBuffer: ArrayBuffer ): void;
	getBVH( object: object, instanceId: number, rangeTarget: object ): unknown;
	getDefaultAttributeValue( key: string, target: unknown ): unknown;
	dispose(): void;

}
