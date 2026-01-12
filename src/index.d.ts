import { BufferGeometry, Vector3, Side, Material, Ray, Sphere, Matrix4, Color,
	Intersection, Box3, Triangle, Vector2, Raycaster, MeshBasicMaterial, Group,
	LineBasicMaterial, Mesh, DataTexture, BufferAttribute, Line3, Object3D } from 'three';

// Contants
export enum SplitStrategy {}
export const CENTER: SplitStrategy;
export const AVERAGE: SplitStrategy;
export const SAH: SplitStrategy;

export enum ShapecastIntersection {}
export const NOT_INTERSECTED: ShapecastIntersection;
export const INTERSECTED: ShapecastIntersection;
export const CONTAINED: ShapecastIntersection;

export interface HitPointInfo {
	point: Vector3;
	distance: number;
	faceIndex: number;
}

export interface BVHOptions {
	strategy?: SplitStrategy;
	maxDepth?: number;
	/** @deprecated Use maxLeafSize instead */
	maxLeafTris?: number;
	maxLeafSize?: number;
	setBoundingBox?: boolean;
	useSharedArrayBuffer?: boolean;
	indirect?: boolean;
	verbose?: boolean;
	onProgress?: ( progress: number ) => void;
	range?: { start: number; count: number };
}

/** @deprecated Use BVHOptions instead */
export interface MeshBVHOptions extends BVHOptions {} // eslint-disable-line

export interface ComputeBVHOptions extends BVHOptions {
	type?: typeof GeometryBVH;
}

export interface MeshBVHSerializeOptions {
	cloneBuffers?: boolean;
}

export interface MeshBVHDeserializeOptions {
	setIndex?: boolean;
}

export interface ShapecastCallbacks {
	intersectsBounds: (
		box: Box3,
		isLeaf: boolean,
		score: number | undefined,
		depth: number,
		nodeIndex: number
	) => ShapecastIntersection|boolean;

	boundsTraverseOrder?: (
		box: Box3
	) => number;

	intersectsRange?: (
		offset: number,
		count: number,
		contained: boolean,
		depth: number,
		nodeIndex: number,
		box: Box3
	) => boolean;
}

export class BVH {

	shiftPrimitiveOffsets( offset: number ): void;

	traverse(
		callback: (
			depth: number,
			isLeaf: boolean,
			boundingData: ArrayBuffer,
			offsetOrSplit: number,
			count: number
		) => void,
		rootIndex?: number
	): void;

	getBoundingBox( target: Box3 ): Box3;

	shapecast( callbacks: ShapecastCallbacks ): boolean;

}

export class GeometryBVH extends BVH {

	readonly geometry: BufferGeometry;

	constructor( geometry: BufferGeometry, options?: BVHOptions );
	raycastObject3D( object: Object3D, raycaster: Raycaster, intersects: Array<Intersection> ): void;

}

// MeshBVH
export class MeshBVH extends GeometryBVH {

	readonly resolveTriangleIndex: ( i: number ) => number;

	static serialize( bvh: MeshBVH, options?: MeshBVHSerializeOptions ): SerializedBVH;

	static deserialize(
		data: SerializedBVH,
		geometry: BufferGeometry,
		options?: MeshBVHDeserializeOptions
	): MeshBVH;

	constructor( geometry: BufferGeometry, options?: BVHOptions );

	shiftTriangleOffsets( offset: number ): void;

	raycast( ray: Ray, materialOrSide?: Side | Array<Material> | Material, near?: number, far?: number ): Array<Intersection>

	raycastFirst( ray: Ray, materialOrSide?: Side | Array<Material> | Material, near?: number, far?: number ): Intersection | null;

	intersectsSphere( sphere: Sphere ): boolean;

	intersectsBox( box: Box3, boxToMesh: Matrix4 ): boolean;

	intersectsGeometry( geometry: BufferGeometry, geometryToBvh: Matrix4 ): boolean;

	closestPointToPoint(
		point: Vector3,
		target?: HitPointInfo,
		minThreshold?: number,
		maxThreshold?: number
	): HitPointInfo | null;

	closestPointToGeometry(
		geometry: BufferGeometry,
		geometryToBvh: Matrix4,
		target1?: HitPointInfo,
		target2?: HitPointInfo,
		minThreshold?: number,
		maxThreshold?: number
	): HitPointInfo | null;

	shapecast(
		callbacks: ShapecastCallbacks & {
			intersectsTriangle?: (
				triangle: ExtendedTriangle,
				triangleIndex: number,
				contained: boolean,
				depth: number
			) => boolean|void
		}
	): boolean;

	// union types to enable at least one of two functions:
	// https://stackoverflow.com/a/60617060/9838891
	bvhcast(
		otherBVH: MeshBVH,
		matrixToLocal: Matrix4,
		callbacks: ( {

			intersectsRanges: (
				offset1: number,
				count1: number,
				offset2: number,
				count2: number,
				depth1: number,
				index1: number,
				depth2: number,
				index2: number
			) => boolean

		} | {

			intersectsTriangles: (
				triangle1: ExtendedTriangle,
				triangle2: ExtendedTriangle,
				i1: number,
				i2: number,
				depth1: number,
				index1: number,
				depth2: number,
				index2: number,
			) => boolean,

		} )
	): boolean;

	refit( nodeIndices?: Array<number> | Set<number> ): void;

}

// other BVHs
export class PointsBVH extends GeometryBVH {

	shapecast(
		callbacks: ShapecastCallbacks & {
			intersectsPoint?: (
				pointIndex: number,
				contained: boolean,
				depth: number
			) => boolean|void
		}
	): boolean;

}

export class LineSegmentsBVH extends GeometryBVH {

	shapecast(
		callbacks: ShapecastCallbacks & {
			intersectsLine?: (
				lineIndex: number,
				contained: boolean,
				depth: number
			) => boolean|void
		}
	): boolean;

}

export class LineLoopBVH extends LineSegmentsBVH {}
export class LineBVH extends LineLoopBVH {}

// SerializedBVH
export class SerializedBVH {

	roots: Array<ArrayBuffer>;
	index: ArrayBufferView;

}

// BVHHelper
export class BVHHelper extends Group {

	opacity: number;
	depth: number;
	displayParents: boolean;
	displayEdges: boolean;
	edgeMaterial: LineBasicMaterial;
	meshMaterial: MeshBasicMaterial;

	constructor( meshOrBVH: Object3D | GeometryBVH, depth?: number );
	constructor( mesh?: Object3D | null, bvh?: GeometryBVH | null, depth?: number );

	update(): void;

	get color(): Color;

}

export class MeshBVHHelper extends BVHHelper {}

// THREE.js Extensions

export function computeBoundsTree( options?: ComputeBVHOptions ): GeometryBVH;

export function disposeBoundsTree(): void;

export function computeBatchedBoundsTree( index?: number, options?: BVHOptions ): GeometryBVH | GeometryBVH[];

export function disposeBatchedBoundsTree( index?: number ): void;

export function acceleratedRaycast(
	raycaster: Raycaster,
	intersects: Array<Intersection>
): void;

declare module 'three' {
	export interface BufferGeometry {
		boundsTree?: GeometryBVH;
		computeBoundsTree: typeof computeBoundsTree;
		disposeBoundsTree: typeof disposeBoundsTree;
	}

	export interface BatchedMesh {
		boundsTrees?: Array<GeometryBVH | null>;
		computeBoundsTree: typeof computeBatchedBoundsTree;
		disposeBoundsTree: typeof disposeBatchedBoundsTree;
	}

	export interface Raycaster {
		firstHitOnly?: boolean;
	}
}

// GenerateMeshBVHWorker
// export class GenerateMeshBVHWorker {

//	 running: boolean;

//	 generate( geometry: BufferGeometry, options?: MeshBVHOptions ): Promise<MeshBVH>;

//	 terminate(): boolean;

// }

// Debug functions
export function estimateMemoryInBytes( bvh: BVH ): number;

export interface ExtremeInfo {
	nodeCount: number;
	leafNodeCount: number;
	surfaceAreaScore: number;
	depth: {min: number, max: number};
	primitives: {min: number, max: number};
	splits: [number, number, number];
}

export function getBVHExtremes( bvh: BVH ): Array<ExtremeInfo>;

export function validateBounds( bvh: MeshBVH ): boolean;

export interface TreeNode {
	bounds: Box3;
	count: number;
	offset: number;
	left?: TreeNode;
	right?: TreeNode;
}

export function getJSONStructure( bvh: BVH ): TreeNode;

// Triangle Utilities
export interface HitTriangleInfo {
	face: {
		a: number,
		b: number,
		c: number,
		materialIndex: number,
		normal: Vector3
	},
	uv: Vector2
}

export function getTriangleHitPointInfo(
	point: Vector3,
	geometry : BufferGeometry,
	triangleIndex: number,
	target?: HitTriangleInfo
): HitTriangleInfo

// Shader Utilities
declare class VertexAttributeTexture extends DataTexture {

	overrideItemSize: number | null;
	updateFrom( attribute: BufferAttribute ): void;

}

export class FloatVertexAttributeTexture extends VertexAttributeTexture {}
export class UIntVertexAttributeTexture extends VertexAttributeTexture {}
export class IntVertexAttributeTexture extends VertexAttributeTexture {}

export class MeshBVHUniformStruct {

	updateFrom( bvh: MeshBVH ): void;
	dispose(): void;

}

export const BVHShaderGLSL: {
	bvh_distance_functions: string;
	bvh_ray_functions: string;
	bvh_struct_definitions: string;
	common_functions: string;
};

// backwards compatibility
export const shaderStructs: string;
export const shaderDistanceFunction: string;
export const shaderIntersectFunction: string;

// Math classes
export class ExtendedTriangle extends Triangle {

	needsUpdate : boolean;

	intersectsTriangle( other : Triangle, target? : Line3 ) : boolean;
	intersectsSphere( sphere : Sphere ) : boolean;
	closestPointToSegment( segment : Line3, target1? : Vector3, target2? : Vector3 ) : number;
	distanceToPoint( point : Vector3 ) : number;
	distanceToTriangle( tri : Triangle ) : number;

}

export class OrientedBox {

	min: Vector3;
	max: Vector3;
	matrix : Matrix4;
	needsUpdate : boolean;

	constructor( min : Vector3, max : Vector3 );
	set( min : Vector3, max : Vector3, matrix : Matrix4 ) : OrientedBox;
	intersectsBox( box : Box3 ) : boolean;
	intersectsTriangle( tri : Triangle ) : boolean;
	closestPointToPoint( point : Vector3, target? : Vector3 ) : number;
	distanceToPoint( point : Vector3 ) : number;
	distanceToBox( box : Box3, threshold? : number, target1? : Vector3, target2? : Vector3 ) : number;

}

export class StaticGeometryGenerator {

	useGroups : boolean;
	attributes : Array<string>;
	applyWorldTransforms : boolean;

	constructor( objects : Array<Object3D> | Object3D );
	getMaterials() : Array<Material>;
	generate( target? : BufferGeometry ) : BufferGeometry;

}
