import { Matrix4, Object3D, Vector4 } from 'three';
import { MeshBVH, ObjectBVH, SkinnedMeshBVH } from 'three-mesh-bvh';

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

	// override points for subclasses
	writeTransformData(
		info: {
			object: Object3D;
			instanceId: number;
			compositeId: number;
			root: number;
			slot: number;
		},
		premultiplyMatrix: Matrix4,
		writeOffset: number,
		targetBuffer: ArrayBuffer,
	): void;

	getBVH(
		object: Object3D,
		instanceId: number,
		rangeTarget: {
			start: number;
			count: number;
			vertexStart: number;
			vertexCount: number;
		},
	): MeshBVH | SkinnedMeshBVH | null | Promise<MeshBVH | SkinnedMeshBVH | null>;

	getDefaultAttributeValue( key: string, target: Vector4 ): Vector4;

}
