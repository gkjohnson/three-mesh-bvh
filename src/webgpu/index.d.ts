import { ObjectBVH } from 'three-mesh-bvh';

export class BVHComputeData {

	autogenerateBvh: boolean;
	useCompressedWideBVH: boolean;
	attributes: Record<string, string>;

	storage: {
		index: unknown;
		attributes: unknown;
		nodes: unknown;
		leaves?: unknown;
		transforms: unknown;
	};

	structs: {
		transform: unknown;
		attributes: unknown;
	};

	fns: {
		raycastFirstHit: unknown;
		sampleTrianglePoint: unknown;
		closestPointToPoint: unknown;
	};

	constructor( bvh: ObjectBVH | object | object[], options?: {
		attributes?: Record<string, string>;
		autogenerateBvh?: boolean;
		useCompressedWideBVH?: boolean;
	} );

	update(): void;
	getShapecastFn( options: {
		name?: string;
		shapeStruct: unknown;
		resultStruct?: unknown;
		boundsOrderFn?: unknown;
		childOrderFn?: unknown;
		intersectsBoundsFn: unknown;
		intersectRangeFn: unknown;
		transformShapeFn?: unknown;
		transformResultFn?: unknown;
	} ): unknown;

}
