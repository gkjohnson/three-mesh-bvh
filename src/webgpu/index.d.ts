import { ObjectBVH } from 'three-mesh-bvh';

export class BVHComputeData {

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
		raycastAnyHit: unknown;
		sampleTrianglePoint: unknown;
		closestPointToPoint: unknown;
	};

	constructor( bvh: ObjectBVH | object | object[], options?: {
		attributes?: Record<string, string>;
		autogenerateBvh?: boolean;
	} );

	update(): void;
	updateAsync(): Promise<void>;
	getShapecastFn( options: {
		name?: string;
		shapeStruct: unknown;
		resultStruct?: unknown;
		boundsOrderFn?: unknown;
		intersectsBoundsFn: unknown;
		terminateOnHit?: boolean;
		intersectRangeFn: unknown;
		transformShapeFn?: unknown;
		transformResultFn?: unknown;
	} ): unknown;

}
