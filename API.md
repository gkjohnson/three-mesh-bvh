<!-- This file is generated automatically. Do not edit it directly. -->
# three-mesh-bvh

## Constants

### CENTER

```js
CENTER: number
```

Option for splitting each BVH node down the center of the longest axis of the bounds.

This is the fastest construction option and will yield a good, performant bounds.

### AVERAGE

```js
AVERAGE: number
```

Option for splitting each BVH node at the average point along the longest axis for
all triangle centroids in the bounds.

This strategy may be better than `CENTER` with some geometry.

### SAH

```js
SAH: number
```

Option to use a Surface Area Heuristic to split the bounds more optimally. This SAH
implementation tests 32 discrete splits in each node along each axis to determine
which split is the lowest cost.

This is the slowest construction option but will yield the best bounds of the three
options and use the least memory.

### NOT_INTERSECTED

```js
NOT_INTERSECTED: number
```

Indicates the shape did not intersect the given bounding box.

### INTERSECTED

```js
INTERSECTED: number
```

Indicates the shape did intersect the given bounding box.

### CONTAINED

```js
CONTAINED: number
```

Indicate the shape entirely contains the given bounding box.

## Shader and Texture Packing API

### bvh_ray_functions

```js
bvh_ray_functions: string
```

Set of shader functions used for interacting with the packed BVH in a shader and sampling
VertexAttributeTextures. Provides ray intersection functions. See
[src/webgl/glsl](https://github.com/gkjohnson/three-mesh-bvh/tree/master/src/webgl/glsl)
for full implementations and declarations.

Accessed as `BVHShaderGLSL.bvh_ray_functions`.

### common_functions

```js
common_functions: string
```

Set of shader functions used for interacting with the packed BVH in a shader and sampling
VertexAttributeTextures. Provides common utility functions including `texelFetch1D`. See
[src/webgl/glsl](https://github.com/gkjohnson/three-mesh-bvh/tree/master/src/webgl/glsl)
for full implementations and declarations.

Accessed as `BVHShaderGLSL.common_functions`.

### bvh_distance_functions

```js
bvh_distance_functions: string
```

Set of shader functions used for interacting with the packed BVH in a shader and sampling
VertexAttributeTextures. Provides distance query functions. See
[src/webgl/glsl](https://github.com/gkjohnson/three-mesh-bvh/tree/master/src/webgl/glsl)
for full implementations and declarations.

Accessed as `BVHShaderGLSL.bvh_distance_functions`.

### bvh_struct_definitions

```js
bvh_struct_definitions: string
```

Set of shader structs and defined constants used for interacting with the packed BVH in a
shader. See [src/webgl/glsl/bvh_struct_definitions.glsl.js](https://github.com/gkjohnson/three-mesh-bvh/blob/master/src/webgl/glsl/bvh_struct_definitions.glsl.js)
for full implementations and declarations.

Accessed as `BVHShaderGLSL.bvh_struct_definitions`.

## BVH

Abstract base class for BVH implementations. Provides core tree traversal and spatial query
methods. Subclasses implement primitive-specific logic by overriding `writePrimitiveBounds`
and related internal methods.


### .shiftPrimitiveOffsets

```js
shiftPrimitiveOffsets( offset: number ): void
```

Adjusts all primitive offsets stored in the BVH leaf nodes by the given value. Useful when
geometry buffers have been shifted or compacted (e.g. when merging geometries).


### .traverse

```js
traverse( callback: function, rootIndex = 0: number ): void
```

Traverses all nodes of the BVH, invoking a callback for each node.

For leaf nodes the callback receives `( depth, isLeaf, boundingData, offset, count )`.
For internal nodes it receives `( depth, isLeaf, boundingData, splitAxis )` and may
return `true` to stop descending into that node's children.


### .refit

```js
refit(): void
```

Refits all BVH node bounds to reflect the current primitive positions. Faster than
rebuilding the BVH but produces a less optimal tree after large vertex deformations.


### .getBoundingBox

```js
getBoundingBox( target: Box3 ): Box3
```

Computes the axis-aligned bounding box of all primitives in the BVH.


### .shapecast

```js
shapecast(
	{
		intersectsBounds: (
			box: Box3,
			isLeaf: boolean,
			score: number | undefined,
			depth: number,
			nodeIndex: number
		) => number,
		intersectsRange?: (
			offset: number,
			count: number,
			contained: boolean,
			depth: number,
			nodeIndex: number,
			box: Box3
		) => boolean,
		boundsTraverseOrder?: (
			box: Box3
		) => number,
	}
): boolean
```

A generalized traversal function for performing spatial queries against the BVH. Returns
`true` as soon as a primitive has been reported as intersected. The tree is traversed
depth-first; `boundsTraverseOrder` controls which child is visited first. Returning
`CONTAINED` from `intersectsBounds` skips further child traversal and intersects all
primitives in that subtree immediately.


### .bvhcast

```js
bvhcast(
	otherBvh: BVH,
	matrixToLocal: Matrix4,
	{
		intersectsRanges: (
			offset1: number,
			count1: number,
			offset2: number,
			count2: number,
			depth1: number,
			nodeIndex1: number,
			depth2: number,
			nodeIndex2: number
		) => boolean,
	}
): boolean
```

Simultaneously traverses two BVH structures to find intersecting primitive pairs. Returns
`true` as soon as any intersection is reported. Both trees are traversed depth-first with
alternating descent. `matrixToLocal` transforms `otherBvh` into the local space of this BVH.


## GeometryBVH

_extends [`BVH`](#bvh)_

Abstract base class for geometry-backed BVH implementations. Handles geometry
indexing, indirect mode, and bounding box initialization. Subclasses implement
primitive-specific bounds computation and raycasting via `writePrimitiveBounds`
and `raycastObject3D`.


### .indirect

```js
readonly indirect: boolean
```

Whether the BVH was built in indirect mode.


### .geometry

```js
readonly geometry: BufferGeometry
```

The geometry this BVH was built from.


### .constructor

```js
constructor(
	geometry: BufferGeometry,
	{
		strategy = CENTER: number,
		maxDepth = 40: number,
		maxLeafSize = 10: number,
		setBoundingBox = true: boolean,
		useSharedArrayBuffer = false: boolean,
		indirect = false: boolean,
		verbose = true: boolean,
		onProgress = null: function | null,
		range = null: Object | null,
	}
)
```

## LineSegmentsBVH

_extends [`GeometryBVH`](#geometrybvh)_

BVH for `THREE.LineSegments` geometries. Each BVH primitive represents one line segment
(two consecutive vertices).


### .shapecast

```js
shapecast(
	{
		intersectsBounds: (
			box: Box3,
			isLeaf: boolean,
			score: number | undefined,
			depth: number,
			nodeIndex: number
		) => number,
		intersectsLine?: (
			line: Line3,
			index: number,
			contained: boolean,
			depth: number
		) => boolean,
		intersectsRange?: (
			offset: number,
			count: number,
			contained: boolean,
			depth: number,
			nodeIndex: number,
			box: Box3
		) => boolean,
		boundsTraverseOrder?: (
			box: Box3
		) => number,
	}
): boolean
```

Performs a spatial query against the BVH. Extends the base `shapecast` with an
`intersectsLine` callback that is called once per line segment primitive in leaf nodes.


## LineLoopBVH

_extends [`LineSegmentsBVH`](#linesegmentsbvh)_

BVH for `THREE.LineLoop` geometries. Forces indirect mode since the loop structure
requires that the index buffer remain unmodified.


### .constructor

```js
constructor( geometry: BufferGeometry, options: Object )
```

## LineBVH

_extends [`LineLoopBVH`](#lineloopbvh)_

BVH for `THREE.Line` geometries. Like `LineLoopBVH` but excludes the final closing
segment so the open line is accurately represented.


### .constructor

```js
constructor( geometry: BufferGeometry, options: Object )
```

## MeshBVH

_extends [`GeometryBVH`](#geometrybvh)_

The MeshBVH generation process modifies the geometry's index bufferAttribute in place to save
memory. The BVH construction will use the geometry's boundingBox if it exists or set it if it
does not. The BVH will no longer work correctly if the index buffer is modified.

Only triangles within the geometry's draw range (or provided `range` option) are included in the
BVH. When a geometry has multiple groups, only triangles within the defined group ranges are
included. Triangles in gaps between groups are excluded.

Note that all query functions expect arguments in local space of the BVH and return results in
local space, as well. If world space results are needed they must be transformed into world space
using `object.matrixWorld`.


### static .serialize

```js
static serialize(
	bvh: MeshBVH,
	{
		cloneBuffers = true: boolean,
	}
): SerializedBVH
```

Generates a representation of the complete bounds tree and the geometry index buffer which
can be used to recreate a bounds tree using the `deserialize` function. The `serialize` and
`deserialize` functions can be used to generate a MeshBVH asynchronously in a background web
worker to prevent the main thread from stuttering. The BVH roots buffer stored in the
serialized representation are the same as the ones used by the original BVH so they should
not be modified. If `SharedArrayBuffers` are used then the same BVH memory can be used for
multiple BVH in multiple WebWorkers.


### static .deserialize

```js
static deserialize(
	data: SerializedBVH,
	geometry: BufferGeometry,
	{
		setIndex = true: boolean,
	}
): MeshBVH
```

Returns a new MeshBVH instance from the serialized data. `geometry` is the geometry used
to generate the original BVH `data` was derived from. The root buffers stored in `data`
are set directly on the new BVH so the memory is shared.


### .resolveTriangleIndex

```js
readonly resolveTriangleIndex: function
```

Helper function for use when `indirect` is set to true. This function takes a triangle
index in the BVH layout and returns the associated triangle index in the geometry index
buffer or position attribute.


### .constructor

```js
constructor( geometry: BufferGeometry, options: Object )
```

### .shiftTriangleOffsets

```js
shiftTriangleOffsets( offset: number ): void
```

Adjusts all triangle offsets stored in the BVH by the given offset. This is useful when the
triangle data has been compacted or shifted in the geometry buffers (e.g. in `BatchedMesh`
when geometries are compacted using the 'optimize' function or constructing a 'merged' BVH).
This function only adjusts the BVH to point to different triangles in the geometry. The
geometry's index buffer and/or position attributes must be updated separately to match.


### .raycastObject3D

```js
raycastObject3D(
	object: Object3D,
	raycaster: Raycaster,
	intersects = []: Array<Intersection>
): Array<Intersection>
```

A convenience function for performing a raycast based on a mesh. Results are formed like
three.js raycast results in world frame.


### .refit

```js
refit( nodeIndices = null: Set<number> | Array<number> | null ): void
```

Refit the node bounds to the current triangle positions. This is quicker than regenerating
a new BVH but will not be optimal after significant changes to the vertices. `nodeIndices`
is a set of node indices (provided by the `shapecast` function) that need to be refit
including all internal nodes.


### .raycast

```js
raycast(
	ray: Ray,
	materialOrSide = FrontSide: number | Material | Array<Material>,
	near = 0: number,
	far = Infinity: number
): Array<Intersection>
```

Returns all raycast triangle hits in unsorted order. It is expected that `ray` is in the
frame of the BVH already. Likewise the returned results are also provided in the local
frame of the BVH. The `side` identifier is used to determine the side to check when
raycasting or a material with the given side field can be passed. If an array of materials
is provided then it is expected that the geometry has groups and the appropriate material
side is used per group.

Note that unlike three.js' Raycaster results the points and distances in the intersections
returned from this function are relative to the local frame of the MeshBVH. When using the
`acceleratedRaycast` function as an override for `Mesh.raycast` they are transformed into
world space to be consistent with three's results.


### .raycastFirst

```js
raycastFirst(
	ray: Ray,
	materialOrSide = FrontSide: number | Material | Array<Material>,
	near = 0: number,
	far = Infinity: number
): Intersection | null
```

Returns the first raycast hit in the model. This is typically much faster than returning
all hits. See `raycast` for information on the side and material options as well as the
frame of the returned intersections.


### .intersectsGeometry

```js
intersectsGeometry(
	otherGeometry: BufferGeometry,
	geometryToBvh: Matrix4
): boolean
```

Returns whether or not the mesh intersects the given geometry.

The `geometryToBvh` parameter is the transform of the geometry in the BVH's local frame.

Performance improves considerably if the provided geometry also has a `boundsTree`.


### .shapecast

```js
shapecast(
	{
		intersectsBounds: (
			box: Box3,
			isLeaf: boolean,
			score: number | undefined,
			depth: number,
			nodeIndex: number
		) => number,
		intersectsTriangle?: (
			triangle: ExtendedTriangle,
			index: number,
			contained: boolean,
			depth: number
		) => boolean,
		intersectsRange?: (
			offset: number,
			count: number,
			contained: boolean,
			depth: number,
			nodeIndex: number,
			box: Box3
		) => boolean,
		boundsTraverseOrder?: (
			box: Box3
		) => number,
	}
): boolean
```

A generalized cast function that can be used to implement intersection logic for custom
shapes. This is used internally for `intersectsBox`, `intersectsSphere`, and more. The
function returns as soon as a triangle has been reported as intersected and returns `true`
if a triangle has been intersected.


### .bvhcast

```js
bvhcast(
	otherBvh: MeshBVH,
	matrixToLocal: Matrix4,
	{
		intersectsRanges?: (
			offset1: number,
			count1: number,
			offset2: number,
			count2: number,
			depth1: number,
			nodeIndex1: number,
			depth2: number,
			nodeIndex2: number
		) => boolean,
		intersectsTriangles?: (
			triangle1: ExtendedTriangle,
			triangle2: ExtendedTriangle,
			triangleIndex1: number,
			triangleIndex2: number,
			depth1: number,
			nodeIndex1: number,
			depth2: number,
			nodeIndex2: number
		) => boolean,
	}
): boolean
```

A generalized cast function that traverses two BVH structures simultaneously to perform
intersection tests between them. This is used internally by `intersectsGeometry`. The
function returns `true` as soon as a triangle pair has been reported as intersected by
the callbacks.

`matrixToLocal` is a Matrix4 that transforms `otherBvh` into the local space of this BVH.
The other BVH's triangles are transformed by this matrix before intersection tests.


### .intersectsBox

```js
intersectsBox( box: Box3, boxToBvh: Matrix4 ): boolean
```

Returns whether or not the mesh intersects the given box.

The `boxToBvh` parameter is the transform of the box in the meshes frame.


### .intersectsSphere

```js
intersectsSphere( sphere: Sphere ): boolean
```

Returns whether or not the mesh intersects the given sphere.


### .closestPointToGeometry

```js
closestPointToGeometry(
	otherGeometry: BufferGeometry,
	geometryToBvh: Matrix4,
	target1 = {}: HitPointInfo,
	target2 = {}: HitPointInfo,
	minThreshold = 0: number,
	maxThreshold = Infinity: number
): HitPointInfo | null
```

Computes the closest distance from the geometry to the mesh and puts the closest point on
the mesh in `target1` (in the frame of the BVH) and the closest point on the other
geometry in `target2` (in the geometry frame). If `target1` is not provided a new Object
is created and returned from the function.

The `geometryToBvh` parameter is the transform of the geometry in the BVH's local frame.

If a point is found that is closer than `minThreshold` then the function will return that
result early. Any triangles or points outside of `maxThreshold` are ignored. If no point
is found within the min / max thresholds then `null` is returned and the target objects
are not modified.

The returned faceIndex in `target1` and `target2` can be used with the standalone function
`getTriangleHitPointInfo` to obtain more information like UV coordinates, triangle normal
and materialIndex.

_Note that this function can be very slow if `geometry` does not have a
`geometry.boundsTree` computed._


### .closestPointToPoint

```js
closestPointToPoint(
	point: Vector3,
	target = {}: HitPointInfo,
	minThreshold = 0: number,
	maxThreshold = Infinity: number
): HitPointInfo | null
```

Computes the closest distance from the point to the mesh and gives additional information
in `target`. The target can be left undefined to default to a new object which is
ultimately returned by the function.

If a point is found that is closer than `minThreshold` then the function will return that
result early. Any triangles or points outside of `maxThreshold` are ignored. If no point
is found within the min / max thresholds then `null` is returned and the `target` object
is not modified.

The returned faceIndex can be used with the standalone function `getTriangleHitPointInfo`
to obtain more information like UV coordinates, triangle normal and materialIndex.


## PointsBVH

_extends [`GeometryBVH`](#geometrybvh)_

BVH for `THREE.Points` geometries. Each BVH primitive represents a single point.


### .shapecast

```js
shapecast(
	{
		intersectsBounds: (
			box: Box3,
			isLeaf: boolean,
			score: number | undefined,
			depth: number,
			nodeIndex: number
		) => number,
		intersectsPoint?: (
			point: Vector3,
			index: number,
			contained: boolean,
			depth: number
		) => boolean,
		intersectsRange?: (
			offset: number,
			count: number,
			contained: boolean,
			depth: number,
			nodeIndex: number,
			box: Box3
		) => boolean,
		boundsTraverseOrder?: (
			box: Box3
		) => number,
	}
): boolean
```

Performs a spatial query against the BVH. Extends the base `shapecast` with an
`intersectsPoint` callback that is called once per point primitive in leaf nodes.


## SkinnedMeshBVH

_extends [`GeometryBVH`](#geometrybvh)_

BVH for `SkinnedMesh` objects. Computes primitive bounds using
`SkinnedMesh.getVertexPosition` so the tree reflects the current posed state
of the mesh. Call `refit()` after updating the skeleton to keep bounds accurate.


### .constructor

```js
constructor( mesh: SkinnedMesh, options: Object )
```

### .shapecast

```js
shapecast(
	{
		intersectsBounds: (
			box: Box3,
			isLeaf: boolean,
			score: number | undefined,
			depth: number,
			nodeIndex: number
		) => number,
		intersectsTriangle?: (
			triangle: ExtendedTriangle,
			index: number,
			contained: boolean,
			depth: number
		) => boolean,
		intersectsRange?: (
			offset: number,
			count: number,
			contained: boolean,
			depth: number,
			nodeIndex: number,
			box: Box3
		) => boolean,
		boundsTraverseOrder?: (
			box: Box3
		) => number,
	}
): boolean
```

Performs a spatial query against the BVH. Extends the base `shapecast` with an
`intersectsTriangle` callback that is called once per triangle primitive in leaf nodes.


## ObjectBVH

_extends [`BVH`](#bvh)_

BVH built from a scene hierarchy rather than a single geometry. Each leaf holds
one Object3D (or one instance of an InstancedMesh/BatchedMesh), enabling
accelerated raycasting and spatial queries across many objects at once.


### .constructor

```js
constructor(
	root: Object3D | Array<Object3D>,
	{
		precise = false: boolean,
		includeInstances = true: boolean,
	}
)
```

### .getObjectFromId

```js
getObjectFromId( compositeId: number ): Object3D
```

Returns the `Object3D` associated with a composite id as provided to `intersectsObject`.


### .getInstanceFromId

```js
getInstanceFromId( compositeId: number ): number
```

Returns the instance index associated with a composite id as provided to `intersectsObject`.


### .shapecast

```js
shapecast(
	{
		intersectsBounds: (
			box: Box3,
			isLeaf: boolean,
			score: number | undefined,
			depth: number,
			nodeIndex: number
		) => number,
		intersectsObject?: (
			object: Object3D,
			instanceId: number,
			contained: boolean,
			depth: number
		) => boolean,
		intersectsRange?: (
			offset: number,
			count: number,
			contained: boolean,
			depth: number,
			nodeIndex: number,
			box: Box3
		) => boolean,
		boundsTraverseOrder?: (
			box: Box3
		) => number,
	}
): boolean
```

Performs a spatial query against the BVH. Extends the base `shapecast` with an
`intersectsObject` callback that is called once per object primitive in leaf nodes.


## BVHHelper

_extends `Group`_

A `THREE.Group` that visualizes a BVH as wireframe bounding boxes or solid
face overlays. Attach it as a sibling of the mesh in the scene graph and
call `update()` whenever the mesh's BVH or world transform changes.


### .color

```js
readonly color: Color
```

Shortcut to `edgeMaterial.color`.


### .opacity

```js
opacity: number
```

Opacity applied to both edge and mesh materials.


### .depth

```js
depth: number
```


### .mesh

```js
mesh: Object3D | null
```


### .bvh

```js
bvh: GeometryBVH | null
```


### .displayParents

```js
displayParents: boolean
```


### .displayEdges

```js
displayEdges: boolean
```


### .instanceId

```js
instanceId: number
```


### .edgeMaterial

```js
edgeMaterial: LineBasicMaterial
```

Material used when rendering in wireframe edge mode.


### .meshMaterial

```js
meshMaterial: MeshBasicMaterial
```

Material used when rendering in solid face mode.


### .constructor

```js
constructor( mesh = null: Object3D | GeometryBVH | null, bvh = null: GeometryBVH | number | null, depth = 10: number )
```

### .update

```js
update(): void
```

Rebuilds the helper's display geometry from the current BVH state. Must
be called after changes to the BVH, `depth`, `displayParents`, or
`displayEdges`.


### .dispose

```js
dispose(): void
```

Disposes of the materials and geometries used by the helper.


## ExtendedTriangle

_extends `Triangle`_

An extended version of three.js' Triangle class. A variety of derivative values are cached on
the object to accelerate the intersection functions. `.needsUpdate` must be set to true when
modifying the triangle parameters.


### .needsUpdate

```js
needsUpdate: boolean
```

Indicates that the triangle fields have changed so cached variables to accelerate other
function execution can be updated. Must be set to true after modifying the triangle
`a`, `b`, `c` fields.


### .intersectsSphere

```js
intersectsSphere( sphere: Sphere ): boolean
```

Returns whether the triangle intersects the given sphere.


### .closestPointToSegment

```js
closestPointToSegment(
	segment: Line3,
	target1: Vector3,
	target2: Vector3
): number
```

Returns the distance to the provided line segment. `target1` and `target2` are set to the
closest points on the triangle and segment respectively.


### .intersectsTriangle

```js
intersectsTriangle(
	other: Triangle,
	target: Line3,
	suppressLog = false: boolean
): boolean
```

Returns whether the triangles intersect. `target` is set to the line segment representing
the intersection.


### .distanceToPoint

```js
distanceToPoint( point: Vector3 ): number
```

Returns the distance to the provided point.


### .distanceToTriangle

```js
distanceToTriangle(
	other: Triangle,
	target1: Vector3,
	target2: Vector3
): number
```

Returns the distance to the provided triangle.


## VertexAttributeTexture

Float, Uint, and Int VertexAttributeTexture implementations are designed to simplify the
efficient packing of a three.js BufferAttribute into a texture. An instance can be treated as a
texture and when passing as a uniform to a shader they should be used as a `sampler2d`,
`usampler2d`, and `isampler2d` when using the Float, Uint, and Int texture types respectively.

_extends THREE.DataTexture_


### .overrideItemSize

```js
overrideItemSize: number
```

Treats `BufferAttribute.itemSize` as though it were set to this value when packing the
buffer attribute texture. Throws an error if the value does not divide evenly into the
length of the BufferAttribute buffer (`count * itemSize % overrideItemSize`).

Specifically used to pack geometry indices into an RGB texture rather than an Red texture.


### .updateFrom

```js
updateFrom( attribute: BufferAttribute ): void
```

Updates the texture to have the data contained in the passed BufferAttribute using the
BufferAttribute `itemSize` field, `normalized` field, and TypedArray layout to determine
the appropriate texture layout, format, and type. The texture dimensions will always be
square. Because these are intended to be sampled as 1D arrays the width of the texture must
be taken into account to derive a sampling uv. See `texelFetch1D` in shaderFunctions.


## IntVertexAttributeTexture

_extends [`VertexAttributeTexture`](#vertexattributetexture)_

A VertexAttributeTexture that forces the signed integer texture type.


## UIntVertexAttributeTexture

_extends [`VertexAttributeTexture`](#vertexattributetexture)_

A VertexAttributeTexture that forces the unsigned integer texture type.


## FloatVertexAttributeTexture

_extends [`VertexAttributeTexture`](#vertexattributetexture)_

A VertexAttributeTexture that forces the float texture type.


## GenerateMeshBVHWorker

_extends `WorkerBase`_

Helper class for generating a MeshBVH for a given geometry in asynchronously in a worker. The
geometry position and index buffer attribute `ArrayBuffers` are transferred to the Worker while
the BVH is being generated meaning the geometry will be unavailable to use while the BVH is
being processed unless `SharedArrayBuffers` are used. They will be automatically replaced when
the MeshBVH is finished generating.

_NOTE It's best to reuse a single instance of this class to avoid the overhead of instantiating
a new Worker._


### .running

```js
running: boolean
```

Flag indicating whether or not a BVH is already being generated in the worker.


### .generate

```js
generate(
	geometry: BufferGeometry,
	{
		onProgress?: function,
	}
): Promise<MeshBVH>
```

Generates a `MeshBVH` instance for the given geometry with the given options in a WebWorker.
Returns a Promise that resolves with the generated `MeshBVH`. Throws if already running.


### .dispose

```js
dispose(): void
```

Terminates the worker.


## MeshBVHUniformStruct

A shader uniform object corresponding to the `BVH` shader struct defined in shaderStructs. The
object contains four textures containing information about the BVH and geometry so it can be
queried in a shader using the bvh intersection functions defined in shaderFunctions. This object
is intended to be used as a shader uniform and read in the shader as a `BVH` struct.


### .updateFrom

```js
updateFrom( bvh: MeshBVH ): void
```

Updates the object and associated textures with data from the provided BVH.


### .dispose

```js
dispose(): void
```

Dispose of the associated textures.


## OrientedBox

An oriented version of three.js' Box3 class. A variety of derivative values are cached on the
object to accelerate the intersection functions. `.needsUpdate` must be set to true when
modifying the box parameters.


### .min

```js
min: Vector3
```


### .max

```js
max: Vector3
```


### .matrix

```js
matrix: Matrix4
```

Matrix transformation applied to the box.


### .needsUpdate

```js
needsUpdate: boolean
```

Indicates that the bounding box fields have changed so cached variables to accelerate
other function execution can be updated. Must be set to true after modifying the
oriented box `min`, `max`, `matrix` fields.


### .constructor

```js
constructor( min: Vector3, max: Vector3, matrix: Matrix4 )
```

### .set

```js
set( min: Vector3, max: Vector3, matrix: Matrix4 ): void
```

Sets the oriented box parameters.


### .intersectsBox

```js
intersectsBox( box: Box3 ): boolean
```

Returns true if intersecting with the provided box.


### .intersectsTriangle

```js
intersectsTriangle( triangle: Triangle ): boolean
```

Returns true if intersecting with the provided triangle.


### .closestPointToPoint

```js
closestPointToPoint( point: Vector3, target: Vector3 ): number
```

Returns the distance to the provided point. Sets `target` to the closest point on the surface
of the box if provided.


### .distanceToPoint

```js
distanceToPoint( point: Vector3 ): number
```

Returns the distance to the provided point.


### .distanceToBox

```js
distanceToBox(
	box: Box3,
	threshold = 0: number,
	target1: Vector3,
	target2: Vector3
): number
```

Returns the distance to the provided box. `threshold` is an optional distance to return early
if the distance is found to be within it. `target1` and `target2` are set to the points on the
surface of this box and the `box` argument respectively.


## ParallelMeshBVHWorker

A drop-in replacement for `GenerateMeshBVHWorker` that distributes BVH construction across
multiple Web Workers in parallel for faster builds on large geometry. Requires
`SharedArrayBuffer` support (cross-origin isolated context). Falls back to a single-threaded
`GenerateMeshBVHWorker` automatically if `SharedArrayBuffer` is unavailable.

Exposes the same API as `GenerateMeshBVHWorker`: `generate`, `dispose`, `running`, and
`maxWorkerCount`.


## StaticGeometryGenerator

A utility class for taking a set of SkinnedMeshes or morph target geometry and baking it into
a single, static geometry that a BVH can be generated for.


### .meshes

```js
meshes: Array<Mesh>
```


### .useGroups

```js
useGroups: boolean
```

If true then groups are used to support an array of materials on the mesh.


### .applyWorldTransforms

```js
applyWorldTransforms: boolean
```

Whether to transform the vertices of the geometry by the world transforms of each mesh when generating.


### .attributes

```js
attributes: Array<string>
```

The set of attributes to copy onto the static geometry.


### .constructor

```js
constructor( meshes: Object3D | Array<Object3D> )
```

Takes an array of object hierarchies to bake into a single static geometry.

### .getMaterials

```js
getMaterials(): Array<Material>
```

Returns an array of materials for the meshes to be merged. These can be used alongside the
generated geometry when creating a mesh: `new Mesh( geometry, generator.getMaterials() )`.


### .generate

```js
generate( targetGeometry: BufferGeometry ): BufferGeometry
```

Generates a single, static geometry for the passed meshes. When generating for the first
time an empty target geometry is expected. The same generated geometry can be passed into
the function on subsequent calls to update the geometry in place to save memory. An error
will be thrown if the attributes or geometry on the meshes to bake has been changed and
are incompatible lengths, types, etc.

On subsequent calls the "index" buffer will not be modified so any BVH generated for the
geometry is unaffected. Once the geometry is updated the `MeshBVH.refit` function can be
called to update the BVH.


## HitPointInfo


### .point

```js
point: Vector3
```

The closest point on the mesh surface.

### .distance

```js
distance: number
```

Distance from the query point to the closest point.

### .faceIndex

```js
faceIndex: number
```

Index of the triangle containing the closest point. Can be
  passed to `getTriangleHitPointInfo` to retrieve UV, normal, and material index.

## HitTriangleInfo


### .face

```js
face: Object
```

Triangle vertex indices, material index, and face normal.

### .uv

```js
uv: Vector2 | null
```

UV coordinates at the hit point, or `null` if no UV attribute is present.

### .barycoord

```js
barycoord: Vector3
```

Barycentric coordinates of the hit point within the triangle.

## SerializedBVH

Plain-object representation of a `MeshBVH` produced by [MeshBVH.serialize](MeshBVH.serialize) and
consumed by [MeshBVH.deserialize](MeshBVH.deserialize). Suitable for transfer across WebWorker boundaries
or storage, with optional buffer sharing via `SharedArrayBuffer`.


### .roots

```js
roots: Array<ArrayBuffer>
```

BVH root node buffers.

### .index

```js
index: Int32Array | Uint32Array | Uint16Array | null
```

Serialized geometry index buffer.

### .indirectBuffer

```js
indirectBuffer: Uint32Array | Uint16Array | null
```

Indirect primitive index buffer, or `null`
  if the BVH was not built in indirect mode.

## Extension Utilities

### acceleratedRaycast

```js
acceleratedRaycast(
	raycaster: Raycaster,
	intersects: Array<Intersection>
): void
```

An accelerated raycast function with the same signature as `THREE.Mesh.raycast`. Uses the BVH
for raycasting if it's available otherwise it falls back to the built-in approach. The results
of the function are designed to be identical to the results of the conventional
`THREE.Mesh.raycast` results.

If the raycaster object being used has a property `firstHitOnly` set to `true`, then the
raycasting will terminate as soon as it finds the closest intersection to the ray's origin and
return only that intersection. This is typically several times faster than searching for all
intersections.


### computeBoundsTree

```js
computeBoundsTree( options: Object ): GeometryBVH
```

A pre-made BufferGeometry extension function that builds a new BVH, assigns it to `boundsTree`
for BufferGeometry, and applies the new index buffer to the geometry. Comparable to
`computeBoundingBox` and `computeBoundingSphere`.

```js
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
```


### disposeBoundsTree

```js
disposeBoundsTree(): void
```

A BufferGeometry extension function that disposes of the BVH.

```js
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
```


### computeBatchedBoundsTree

```js
computeBatchedBoundsTree(
	index = -1: number,
	options: Object
): GeometryBVH | Array<GeometryBVH> | null
```

Equivalent of `computeBoundsTree` for `BatchedMesh`. Creates the
`BatchedMesh.boundsTrees` array if it does not exist. If `index` is `-1`
BVHs for all available geometries are generated and the full array is
returned; otherwise only the BVH at that geometry index is generated and
returned.

```js
THREE.BatchedMesh.prototype.computeBoundsTree = computeBatchedBoundsTree;
```


### disposeBatchedBoundsTree

```js
disposeBatchedBoundsTree( index = -1: number ): void
```

Equivalent of `disposeBoundsTree` for `BatchedMesh`. Sets entries in
`BatchedMesh.boundsTrees` to `null`. If `index` is `-1` all BVHs are
disposed; otherwise only the BVH at that geometry index is disposed.

```js
THREE.BatchedMesh.prototype.disposeBoundsTree = disposeBatchedBoundsTree;
```


## Functions

### getTriangleHitPointInfo

```js
getTriangleHitPointInfo(
	point: Vector3,
	geometry: BufferGeometry,
	triangleIndex: number,
	target: HitTriangleInfo
): HitTriangleInfo
```

Computes hit-point information for a point on a triangle within a `BufferGeometry`. Returns
the face vertex indices, face normal, material index, UV coordinates, and barycentric coordinates.
Useful for retrieving detailed hit data after a call to `MeshBVH.closestPointToPoint` or
`MeshBVH.closestPointToGeometry`.


## Debug Functions

### getBVHExtremes

```js
getBVHExtremes( bvh: BVH ): Array<Object>
```

Measures the min and max extremes of the BVH tree structure, including node
depth, leaf primitive count, split axis distribution, and a surface-area
heuristic score. Returns one entry per root group in the BVH.


### estimateMemoryInBytes

```js
estimateMemoryInBytes( bvh: BVH ): number
```

Roughly estimates the amount of memory in bytes used by a BVH by walking
its object graph and summing typed-array byte lengths and primitive sizes.


### validateBounds

```js
validateBounds( bvh: MeshBVH ): boolean
```

Validates that every node's bounding box fully contains its children and,
for leaf nodes, fully contains all of its primitives. Uses `console.assert`
to log failures and returns `false` if any check fails.


### getJSONStructure

```js
getJSONStructure( bvh: BVH ): Object
```

Returns a plain-object tree that mirrors the BVH hierarchy, useful for
inspecting or serialising the structure for debugging. Each node has a
`bounds` (`Box3`) and either `{ count, offset }` (leaf) or `{ left, right }`
(internal) fields.

