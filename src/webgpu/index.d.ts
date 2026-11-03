import { ObjectBVH } from 'three-mesh-bvh';
import { Node } from 'three/webgpu';

export const NOT_INTERSECTED: Node;
export const INTERSECTED: Node;
export const STOP_TRAVERSAL: Node;

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
		intersectRangeFn: unknown;
		transformShapeFn?: unknown;
		transformResultFn?: unknown;
	} ): unknown;

}
