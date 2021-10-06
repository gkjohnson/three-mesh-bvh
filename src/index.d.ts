// Author: Axel Antoine
// mail: ax.antoine@gmail.com
// website: https://axantoine.com
// 30/09/2021

// Loki, Inria project-team with Université de Lille
// within the Joint Research Unit UMR 9189 CNRS-Centrale
// Lille-Université de Lille, CRIStAL.
// https://loki.lille.inria.fr

// LICENCE: Licence.md 

import {BufferGeometry, Ray, Mesh, Raycaster, Material, FrontSide, BackSide, 
  Face, Vector2, Vector3, Matrix4, DoubleSide, Box3, Sphere, Triangle, Color,
  LineBasicMaterial, MeshBasicMaterial, Intersection, Side} from 'three';

/** Split each BVH node down the center of the longest axis of the bounds. */
export type CENTER = 0;
/** Split each BVH node at the average point along the longest axis for all triangle centroids in the bounds. */
export type AVERAGE = 1;
/** Split the bounds more optimally using a Surface Area Heuristic */
export type SAH = 2;
/** Split Strategy Constants */
export type SplitStrategy = CENTER | AVERAGE | SAH;

/** Indicates the shape did not intersect the given bounding box. */
export type NOT_INTERSECTED = 0;
/** Indicates the shape did intersect the given bounding box. */
export type INTERSECTED = 1;
/** Indicate the shape entirely contains the given bounding box. */
export type CONTAINED = 2;
/** Shapecast Intersection Constants */
export type ShapecastIntersection = NOT_INTERSECTED | INTERSECTED | CONTAINED;

export type TRIANGLE_INTERSECT_COST = 1.25;
export type TRAVERSAL_COST = 1;
export type SAHCost = TRIANGLE_INTERSECT_COST | TRAVERSAL_COST;

// ######################### Data interfaces #########################

/** Information about the triangle hit */
export interface HitPointInfo {
  /** hit point */
  point: Vector3;
  /** distance */
  distance: number;
  /** hit face buffer geometry index */
  faceIndex: number;
}

/**
 * Detailed information about the triangle hit after a call to closestPointToPoint() or 
 * closestPointToGeometry()
 */
export interface HitTriangleInfo {
  /** Face hit */
  face: {
    /** vertex buffer attribute index */
    a: number,
    /** vertex buffer attribute index */
    b: number,
    /** vertex butter attribute index */
    c: number,
    /** Face material index or 0 in not available */
    materialIndex: number,
    /** Face normal */
    normal: Vector3
  },
  /** UV Coordinates */
  uv: Vector2
}

export interface ExtremeInfo {
  /** The total number of nodes in the tree including leaf nodes. */
  nodeCount: number;
  /** The total number of leaf nodes in the tree. */
  leafNodeCount: number;
  /** Total tree score based on the surface area heuristic score */
  surfaceAreaScore: number;
  /** The min and max of leaf nodes in the tree. */
  depth: {min: number, max: number};
  /** The min and max number of triangles contained within the bounds the leaf nodes. */
  tris: {min: number, max: number};
  /** The number of splits on any given axis. */
  splits: [number, number, number];
}

// ###################  Callbacks types ###################


export type TraverseBoundsOrderShapecastCallback = (
  box: Box3
) => number;

export type IntersectsBoundsShapecastCallback = (
  box: Box3,
  isLeaf: boolean,
  score: number | undefined,
  depth: number,
  nodeIndex: number
) => ShapecastIntersection;

export type IntersectsRangeShapecastCallback = (
  triangleOffset: number,
  triangleCount: number,
  contained: boolean,
  depth: number,
  nodeIndex: number,
  box: Box3
) => boolean;

export type IntersectsTriangleShapecastCallback = (
  triangle: Triangle,
  triangleIndex: number,
  contained: boolean,
  depth: number
) => boolean;

export type IntersectsTrianglesBvhcastCallback = (
  /** first tested triangle */
  triangle1: Triangle,
  /** second tested triangle */
  triangle2: Triangle, 
  /** triangle 1 index in the first buffer geometry */
  i1: number, 
  /** triangle 2 index in the second buffer geometry */
  i2: number, 
  /** triangle 1 depth level in the first bvh */
  depth1: number, 
  index1: number,
  /** triangle 2 depth level in the second bvh */
  depth2: number, 
  index2: number,
) => boolean;

export type IntersectsRangesBvhcastCallback = (
  /** offset of triangles iteration begin in first bvh */
  offset1: number, 
  /** number of triangles iterated from offset in first bvh */
  count1: number, 
  /** offset of triangles iteration begin in second bvh */
  offset2: number,
  /** number of triangles iterated from offset in second bvh */ 
  count2: number, 
  /** triangle 1 depth level in the first bvh */
  depth1: number, 
  index1: number, 
  /** triangle 2 depth level in the second bvh */
  depth2: number, 
  index2: number
) => boolean;

export type TraverseBVHCallback = (
  depth: number, 
  isLeaf: boolean, 
  boundingData: ArrayBuffer, 
  offsetOrSplit: number, 
  count: number 
) => void;

// ############################### MeshBVH class ###############################

export interface MeshBVHOptions {
  /** Which split strategy to use when constructing the BVH.*/
  strategy?: SplitStrategy;
  /** Maximum depth to allow the tree to build to. */
  maxDepth?: number;
  /** Number of triangles to aim for in a leaf node. */
  maxLeafTris?: number;
  /** Set the bounding box for the geometry once the BVH has been constructed. */
  setBoundingBox?: boolean;
  /** Use SharedArrayBuffer rather than ArrayBuffer when nitializing the BVH buffers. */
  useSharedArrayBuffer?: boolean;
  /** Print out warnings encountered during tree construction */
  verbose?: boolean;
}

export interface MeshBVHSerializeOptions {
  /** 
   * Copy the geometry index array buffer attribute instead of modifying it
   */
  copyIndexBuffer?: boolean;
}

export interface MeshBVHDeserializeOptions {
  /**
   * Geometry index buffer attribute is set from the serialized data attribute 
   * or created if an index does not exist.
   */
  setIndex?: boolean;
}

/**
 * Class representing and building a BVH structure for a given BufferGeometry
 *
 * /!\ Note that all query functions expect arguments in local space of the mesh and 
 * return results in local space, as well. 
 * @class      MeshBVH (name)
 */
export class MeshBVH {

  /**
   * Generates a representation of the complete bounds tree and the geometry index buffer
   *
   * @param      {MeshBVH}                  bvh      MeshBVH to serialize
   * @param      {MeshBVHSerializeOptions}  options  Serialize options
   * @return     {SerializedBVH}            The serialized bvh.
   */
  static serialize(bvh: MeshBVH, options?: MeshBVHSerializeOptions): SerializedBVH;
  
  /**
   * Returns a new MeshBVH instance from the serialized data
   *
   * @param      {SerializedBVH}              data      Original data
   * @param      {BufferGeometry}             geometry  Geometry used to generate the original BVH associated to data
   * @param      {MeshBVHDeserializeOptions}  options   Deserialize options
   * @return     {MeshBVH}                    The mesh bvh.
   */
  static deserialize(data: SerializedBVH, geometry: BufferGeometry, 
                     options?: MeshBVHDeserializeOptions): MeshBVH;

  /**
   * Contructs a MeshBVH
   *
   * @param      {BufferGeometry}             geometry  Geometry used to generate the BVH
   * @param      {MeshBVHOptions}             options   Building options
   */
  constructor(geometry: BufferGeometry, options?: MeshBVHOptions);
  
  /**
   * Returns all raycast triangle hits in unsorted order.
   *
   * @param      {Ray}       ray             Ray in frame of the mesh being raycast against and that the geometry
   * @param      {Material}  materialOrSide  Material side to check when raycasting or a material with the side field set
   */
  raycast(ray: Ray, materialOrSide: Side | Material): Array<Intersection>
  
  /**
   * Returns the first raycast triangle hit.
   *
   * @param      {Ray}       ray             Ray in frame of the mesh being raycast against and that the geometry
   * @param      {Material}  materialOrSide  Material side to check when raycasting or a material with the side field set
   */
  raycastFirst(ray: Ray, materialOrSide: Side | Material): Intersection;

  /**
   * Check if mesh instersects the given sphere
   *
   * @param      {Sphere}   sphere  The sphere to check intersection with
   * @return     {boolean}  Returns whether or not the mesh instersects the given sphere
   */
  intersectsSphere(sphere: Sphere): boolean;

  /**
   * Check if mesh instersects the given box
   *
   * @param      {Box3}     box       The box to check intersection with
   * @param      {Matrix4}  boxToMesh  Transform matrix of the box in the meshs frame
   * @return     {boolean}  Returns whether or not the mesh instersects the given box
   */
  intersectsBox(box: Box3, boxToMesh: Matrix4): boolean;

  /**
   * Check if mesh instersects the given geometry
   *
   * @param      {BufferGeometry}  geometry       The geometry to check intersection with
   * @param      {Matrix4}         geometryToBvh  Transform matrix of the geometry in the meshs frame
   * @return     {boolean}         Returns whether or not the mesh instersects the given geometry
   */
  intersectsGeometry(geometry: BufferGeometry, geometryToBvh: Matrix4): boolean;

  /**
   *  Computes the closest distance from the given point to the mesh. 
   *
   * @param      {Vector3}       point         Reference point
   * @param      {HitPointInfo}  target        Additionnal point information
   * @param      {number}        minThreshold  The minimum threshold
   * @param      {number}        maxThreshold  The maximum threshold
   * @return     {HitPointInfo}  the hit point information
   */
  closestPointToPoint(
    point: Vector3, 
    target?: HitPointInfo, 
    minThreshold?: number, 
    maxThreshold?: number
  ): HitPointInfo | null;

  /**
   *  Computes the closest distance from the given geometry to the mesh. 
   *  Puts the closest point on the mesh in target1 (in the frame of the BVH) and the 
   *  closest point on the other geometry in target2 (in the geometry frame). 
   *
   * @param      {BufferGeometry}  geometry       Other geometry
   * @param      {Matrix4}         geometryToBvh  transform of the geometry in the mesh's frame
   * @param      {HitPointInfo}    target1        Info on the closest point belonging to mesh
   * @param      {HitPointInfo}    target2        Info on the closest point belonging to the other geometry
   * @param      {number}          minThreshold   The minimum threshold
   * @param      {number}          maxThreshold   The maximum threshold
   * @return     {HitPointInfo}    The closest point info on the mest
   */
  closestPointToGeometry(
    geometry: BufferGeometry, 
    geometryToBvh: Matrix4,
    target1?: HitPointInfo,
    target2?: HitPointInfo,
    minThreshold?: number,
    maxThreshold?: number
  ): HitPointInfo;

  shapecast(
    callbacks: {
      traverseBoundsOrder?: TraverseBoundsOrderShapecastCallback
      intersectsBounds: IntersectsBoundsShapecastCallback,
      intersectsRange?: IntersectsRangeShapecastCallback,
      intersectsTriangle?: IntersectsTriangleShapecastCallback,
    }
  ): boolean;

  bvhcast(
    otherBVH: MeshBVH, 
    matrixToLocal: Matrix4, 
    callbacks?: {
      intersectsRanges?: IntersectsRangesBvhcastCallback,
      intersectsTriangles?: IntersectsTrianglesBvhcastCallback,
    }): boolean;

  traverse(callback: TraverseBVHCallback, rootIndex?: number): void;

  /**
   * Refit the node bounds to the current triangle positions
   *
   * @param      {SetNumber}  nodeIndices  set of node indices that need to be refit including all internal nodes
   */
  refit(nodeIndices?: Array<Number> | Set<Number>): void;

  /**
   * Get the bounding box of the geometry
   *
   * @param      {Box3}  target  The target
   * @return     {Box3}  The bounding box.
   */
  getBoundingBox(target: Box3): Box3;

  /**
   * Get information about a point related to a geometry/
   * This function can be used after a call to closestPointPoint or closestPointToGeometry to retrieve more detailed result information.
   *
   * @param      {Vector3}                                     point                    The point
   * @param      {BufferGeometry}                              geometry                 The geometry
   * @param      {number}                                      triangleIndex            The triangle index
   * @param      {}                                            target?:HitTriangleInfo  The target hit triangle information
   * @return     {HitTriangleInfo}export class SerializedBVH}  The triangle hit point information.
   */
  getTriangleHitPointInfo(
    point: Vector3,
    geometry : BufferGeometry,
    triangleIndex: number,
    target?: HitTriangleInfo
  ): HitTriangleInfo
}

//############################ SerializedBVH class #############################

export class SerializedBVH {
  roots: Array<ArrayBuffer>;
  index: ArrayBufferView;
}

//########################## MeshBVHVisualizer class ###########################

/**
 * Displays a view of the bounds tree up to the given depth of the tree
 *
 * @class      MeshBVHVisualizer (name)
 */
export class MeshBVHVisualizer {
  depth: number;
  color: Color;
  opacity: number;
  displayParents: boolean;
  displayEdges: boolean;
  edgeMaterial: LineBasicMaterial;
  meshMaterial: MeshBasicMaterial;

  /**
   * Instantiates the helper with a depth and mesh to visualize
   */
  constructor(mesh: Mesh, depth?: number);

  /**
   * Updates the display of the bounds tree in the case that the bounds tree has changed or the depth parameter has changed
   */
  update(): void;

  /**
   * Disposes of the material used.
   */
  dispose(): void;
}

//########################## Extensions class ###########################

/**
 * A pre-made BufferGeometry extension function that builds a new BVH, assigns 
 * it to boundsTree, and applies the new index buffer to the geometry.
 *
 * @param      {MeshBVHOptions}  options  The options
 */
export function computeBoundsTree(options?: MeshBVHOptions): void;

/**
 * A BufferGeometry extension function that disposes of the BVH.
 */
export function disposeBoundsTree(): void;

/**
 * Uses the BVH for raycasting if it's available otherwise it falls back to the built-in approach.
 *
 * @param      {Ray}   ray     The ray
 * @param      {Side}  side    The side
 */
export function acceleratedRaycast(raycaster: Raycaster, intersects: Array<Intersection>): void;

/**
 * Three BufferGeometry module augmentation
 */
declare module 'three/src/core/BufferGeometry' {
  interface BufferGeometry {
    /**
     * BVH Structure
     */
    boundsTree?: MeshBVH;
   /**
    * Builds a new BVH, assigns it to boundsTree, and applies the new index buffer to the geometry.
    *
    * @param      {MeshBVHOptions}  options  The options
    */
    computeBoundsTree: typeof computeBoundsTree;
    /**
     * Disposes of the BVH.
     */
    disposeBoundsTree: typeof disposeBoundsTree;
  }
}

/**
 * Three Raycaster module augmentation
 */
declare module 'three/src/core/Raycaster' {
  interface Raycaster {
    firstHitOnly?: boolean;
  }
}

//######################## GenerateMeshBVHWorker class #########################

/**
 * Helper class for generating a MeshBVH for a given geometry in asynchronously 
 * in a worker
 *
 * @class      GenerateMeshBVHWorker (name)
 */
export class GenerateMeshBVHWorker {
  /**
   * Flag indicating whether or not a BVH is already being generated in the worker.
   *
   * @param      {BufferGeometry}  geometry  The geometry
   * @param      {MeshBVHOptions}  options   The options
   */
  running: boolean;

  /**
   * Generates a MeshBVH instance for the given geometry with the given options in a WebWorker. 
   * Returns a promise that resolves with the generated MeshBVH. 
   * This function will throw an error if it is already running
   *
   * @param      {BufferGeometry}  geometry  The geometry
   * @param      {MeshBVHOptions}  options   The options
   * @return      {Promise<MeshBVH>} Promise MeshBVH
   */
  generate(geometry: BufferGeometry, options?: MeshBVHOptions): Promise<MeshBVH>;

  /**
   * Terminates the worker.
   *
   * @return     {boolean}  return sucess value
   */
  terminate(): boolean;
}

//############################## Debug functions ###############################

/**
 * Roughly estimates the amount of memory in bytes a BVH is using.
 *
 * @param      {MeshBVH}  bvh     The bvh
 * @return     {number}   memory used in bytes
 */
export function estimateMemoryInBytes(bvh: MeshBVH ): number;

export function getBVHExtremes(bvh :MeshBVH ): Array<ExtremeInfo>;

export function validateBounds(bvh: MeshBVH): boolean;

// TODO: Set the return type
export function getJSONStructure(bvh: MeshBVH): any;

//############################## Extra functions ###############################

export function generateAsync(geometry: BufferGeometry, 
  options?: MeshBVHOptions): Promise<MeshBVH>;

//######################## THREE.js module augmentation ########################



