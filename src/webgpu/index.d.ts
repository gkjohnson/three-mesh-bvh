import { Matrix4, Object3D, Vector4 } from 'three';
import { MeshBVH, ObjectBVH, SkinnedMeshBVH } from 'three-mesh-bvh';

export interface ObjectInfo {
	object: Object3D;
	instanceId: number;
	group: number;
	objectIndex: number;
	indexOffset: number;
	attributesOffset: number;
	primitiveOffset: number;
	primitiveCount: number;
}

export interface AttributeLayoutMember {
	name: string;
	type: string;
	structType: string;
	offset: number;
	size: number;
}

export interface AttributeLayout {
	members: AttributeLayoutMember[];
	stride: number;
}

export class BVHComputeData {

	autogenerateBvh: boolean;
	attributes: Record<string, string>;
	attributeLayout: AttributeLayout | null;

	storage: {
		nodes: unknown;
		objects: unknown;
	};

	structs: {
		objectRecord: unknown;
		attributes: unknown;
	};

	fns: {
		raycastFirstHit: unknown;
		raycastAnyHit: unknown;
		sampleTrianglePoint: unknown;
		getTriangleIndices: unknown;
		getVertex: unknown;
		getVertexPosition: unknown;
		closestPointToPoint: unknown;
	};

	constructor( bvh: ObjectBVH | object | object[], options?: {
		attributes?: Record<string, string>;
		autogenerateBvh?: boolean;
	} );

	update(): void;
	updateAsync(): Promise<void>;
	getObjectInfo( object: Object3D, instanceId?: number, group?: number ): ObjectInfo | null;
	getAllObjectInfo(): ObjectInfo[];
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
	writeObjectRecord(
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
