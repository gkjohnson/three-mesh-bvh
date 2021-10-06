// Author: Axel Antoine
// mail: ax.antoine@gmail.com
// website: https://axantoine.com
// 30/09/2021

// Loki, Inria project-team with Université de Lille
// within the Joint Research Unit UMR 9189 CNRS-Centrale
// Lille-Université de Lille, CRIStAL.
// https://loki.lille.inria.fr

import {BufferGeometry, Ray, Mesh, Raycaster, Material, FrontSide, BackSide, 
  Face, Vector2, Vector3, Matrix4, DoubleSide, Box3, Sphere, Triangle, Color,
  LineBasicMaterial, MeshBasicMaterial, Intersection, Side} from 'three';

/** Split each BVH node down the center of the longest axis of the bounds. */
export const CENTER = 0;
/** Split each BVH node at the average point along the longest axis for all triangle centroids in the bounds. */
export const AVERAGE = 1;
/** Split the bounds more optimally using a Surface Area Heuristic. */
export const SAH = 2;
/** Split Strategy Constants. */
export type SplitStrategy = typeof CENTER | typeof AVERAGE | typeof SAH;

/** Indicates the shape did not intersect the given bounding box. */
export const NOT_INTERSECTED = 0;
/** Indicates the shape did intersect the given bounding box. */
export const INTERSECTED = 1;
/** Indicate the shape entirely contains the given bounding box. */
export const CONTAINED = 2;
/** Shapecast Intersection Constants */
export type ShapecastIntersection = typeof NOT_INTERSECTED | typeof INTERSECTED | typeof CONTAINED;

/** */
export const TRIANGLE_INTERSECT_COST = 1.25;
/** */
export const TRAVERSAL_COST = 1;
/** SAH Cost Constants */
export type SAHCost = typeof TRIANGLE_INTERSECT_COST | typeof TRAVERSAL_COST;

// ######################### Data interfaces #########################

/** Information about the triangle hit */
export interface HitPointInfo {
  /** Hit point location */
  point: Vector3;
  /** Distance between the point and the target */
  distance: number;
  /** Hit face buffer geometry index */
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

/**
 * Information about the extremes of thre BVH tree.
 */
export interface ExtremeInfo {
  /** The total number of nodes in the tree including leaf nodes. */
  nodeCount: number;
  /** The total number of leaf nodes in the tree. */
  leafNodeCount: number;
  /** Total tree score based on the surface area heuristic score */
  surfaceAreaScore: number;
  /** The min and max of leaf nodes in the tree. */
  depth: {min: number, max: number};
  /** The min and max number of triangles contained within the bounds of the leaf nodes. */
  tris: {min: number, max: number};
  /** The number of splits on any given axis. */
  splits: [number, number, number];
}

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

  /**
   * A generalized cast function that can be used to implement intersection logic for custom shapes.
   * 
   * @param      {ShapecastCallbacks}  callbacks   Shapecast callbacks
   * @return     {boolean}             returns true if a triangle has been intersected
   */
  shapecast(
    callbacks: {
      /**
       * Returns a score (often distance) used to determine whether the left or right node should be traversed first.
       *
       * @param      {Box3}    box     Axis aligned bounding box of the BVH node
       * @return     {number}  The score given to the BVH node.
       */
      traverseBoundsOrder?: (
        box: Box3
      ) => number,

      /**
       * Returns a constant indicating whether or not the bounds is intersected or contained meaning traversal should continue
       *
       * @param      {Box3}                    box        Axis aligned bounding box of the BVH node
       * @param      {boolean}                 isLeaf     Indicates if node is BVH tree leaf
       * @param      {(number|undefined)}      score      The score given to a BVH node
       * @param      {number}                  depth      Depth of the bounds the box or triangles belong or depth of the parent bounds if triangles are marked as contained
       * @param      {number}                  nodeIndex  Index of the current traversed node
       * @return     {ShapecastIntersection}   Intersection status of the bounds
       */
      intersectsBounds: (
        box: Box3,
        isLeaf: boolean,
        score: number | undefined,
        depth: number,
        nodeIndex: number
      ) => ShapecastIntersection,

      /**
       * Returns whether or not the triangles in range has been intersected
       *
       * @param      {number}   triangleOffset  Starting offset of the geometry triangles to intersect
       * @param      {number}   triangleCount   Number of triangles of the geometry to intersect
       * @param      {boolean}  contained       Tell if triangle are completely contained whithin the node
       * @param      {number}   depth           Depth of the bounds the box or triangles belong or depth of the parent bounds if triangles are marked as contained
       * @param      {number}   nodeIndex       Index of the current traversed node
       * @param      {Box3}     box             Axis aligned bounding box of the BVH node
       * @return     {boolean}  Triangles in range has been intersected
       */
      intersectsRange?: (
        triangleOffset: number,
        triangleCount: number,
        contained: boolean,
        depth: number,
        nodeIndex: number,
        box: Box3
      ) => boolean,

      /**
       * Returns whether or not the triangle has been intersected
       *
       * @param      {Triangle}  triangle       The triangle
       * @param      {number}    triangleIndex  The triangle index
       * @param      {boolean}   contained      Indicates if parent is contained
       * @param      {number}    depth          Depth of the bounds the box or triangles belong or depth of the parent bounds if triangles are marked as contained
       * @return     {boolean}   Triangle has been intersected
       */
      intersectsTriangle?: (
        triangle: Triangle,
        triangleIndex: number,
        contained: boolean,
        depth: number
      ) => boolean,
    }
  ): boolean;


  bvhcast(
    otherBVH: MeshBVH, 
    matrixToLocal: Matrix4, 
    callbacks?: {

      /**
       * <TODO>
       *
       * @param      {number}  offset1  offset of triangles iteration begin in first bvh
       * @param      {number}  count1   number of triangles iterated from offset in first bvh
       * @param      {number}  offset2  offset of triangles iteration begin in second bvh
       * @param      {number}  count2   number of triangles iterated from offset in second bvh
       * @param      {number}  depth1   triangle 1 depth level in the first bvh
       * @param      {number}  index1   Index of the BVH node in the first geometry node containing triangle 1
       * @param      {number}  depth2   triangle 2 depth level in the second bvh
       * @param      {number}  index2   Index of the BVH node in the second geometry node containing triangle 2
       * @return     {boolean}  <TODO>
       */
      intersectsRanges?: (
        offset1: number, 
        count1: number, 
        offset2: number,
        count2: number, 
        depth1: number, 
        index1: number, 
        depth2: number, 
        index2: number
      ) => boolean,

      /**
       * <TODO>
       *
       * @param      {Triangle}  triangle1  first tested triangle
       * @param      {Triangle}  triangle2  second tested triangle
       * @param      {number}    i1         triangle 1 index in the first buffer geometry
       * @param      {number}    i2         triangle 2 index in the second buffer geometry
       * @param      {number}    depth1     triangle 1 depth level in the first bvh
       * @param      {number}    index1     Index of the BVH node in the first geometry node containing triangle 1
       * @param      {number}    depth2     triangle 2 depth level in the second bvh
       * @param      {number}    index2     Index of the BVH node in the second geometry contaiing triangle 2
       * @return     {boolean}   <TODO>
       */
      intersectsTriangles?: (
        triangle1: Triangle,
        triangle2: Triangle, 
        i1: number, 
        i2: number, 
        depth1: number, 
        index1: number,
        depth2: number, 
        index2: number,
      ) => boolean,
    }): boolean;

  /**
   * { function_description }
   *
   * @param      {number}  rootIndex  Index of the node to start the traversal
   */
  traverse(
    /**
     * Traverse the BVH nodes.
     *
     * @param      {number}       depth          The depth
     * @param      {boolean}      isLeaf         Indicates if leaf
     * @param      {ArrayBuffer}  boundingData   The bounding data
     * @param      {number}       offsetOrSplit  The offset or split
     * @param      {number}       count          The count
     */
    callback: (
      depth: number, 
      isLeaf: boolean, 
      boundingData: ArrayBuffer, 
      offsetOrSplit: number, 
      count: number 
    ) => void, 
    rootIndex?: number
  ): void;

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

/**
 * Gets the bvh extremes.
 *
 * @param      {MeshBVH}              bvh     The bvh
 * @return     {Array<ExtremeInfo>}   Array of ExtremeInfo objects
 */
export function getBVHExtremes(bvh :MeshBVH ): Array<ExtremeInfo>;

/**
 * <TODO>
 *
 * @param      {MeshBVH}  bvh     The bvh
 * @return     {boolean}  <TODO>
 */
export function validateBounds(bvh: MeshBVH): boolean;

/**
 * Gets the json structure.
 *
 * @param      {MeshBVH}  bvh     The bvh
 * @return     {any}      The json structure.
 */
export function getJSONStructure(bvh: MeshBVH): any; // Return type?

//############################## Extra functions ###############################

/**
 * Generates a MeshBVH structure for the given geometry asynchronously.
 *
 * @param      {BufferGeometry}    geometry  The Buffer Geometry
 * @param      {MeshBVHOptions}    options   MeshBVH build options
 * @return     {Promise<MeshBVH>}  MeshBVH as a promise.
 */
export function generateAsync(geometry: BufferGeometry, 
  options?: MeshBVHOptions): Promise<MeshBVH>;

//######################## THREE.js module augmentation ########################



