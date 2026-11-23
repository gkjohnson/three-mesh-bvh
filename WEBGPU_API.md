<!-- This file is generated automatically. Do not edit it directly. -->
# three-mesh-bvh/webgpu

## TSL Functions

### closestPointToTriangle

```js
closestPointToTriangle: FunctionNode
```

WGSL function node that finds the closest point on a triangle to `p` and returns the barycoord.

### intersectRayTriangle

```js
intersectRayTriangle: FunctionNode
```

WGSL function node that tests a ray against a single triangle and returns an
[rayIntersectionResultStruct](rayIntersectionResultStruct) result. Useful when writing a custom `intersectRangeFn`
for [BVHComputeData#getShapecastFn](BVHComputeData#getShapecastFn).

### ndcToCameraRay

```js
ndcToCameraRay: FunctionNode
```

WGSL function node that builds a camera ray (origin + direction) from an NDC coordinate,
the camera's world matrix, and its inverse projection matrix. Works for both
perspective and orthographic projections. The origin sits on the near plane, the returned
direction is normalized, and "maxDist" is the world-space distance to the far plane so
traversal clips there.

## TSL Structs

### rayStruct

```js
rayStruct: StructTypeNode
```

WGSL struct node representing a ray with an origin, direction, and maximum trace distance.
Used as the input to BVH traversal and intersection functions. Traversal ignores hits at or
beyond "maxDist", and a value of 0 (the zero-initialized default) means unbounded.

### rayIntersectionResultStruct

```js
rayIntersectionResultStruct: StructTypeNode
```

WGSL struct node describing a ray–triangle intersection result, including barycentric
coordinates, world-space normal, hit distance, face side, triangle indices, and the
object index within the TLAS.

### pointQueryResultStruct

```js
pointQueryResultStruct: StructTypeNode
```

WGSL struct node describing a closest-point query result, including the world-space
closest point, squared distance, barycentric coordinates, face normal, side, triangle
indices, and the object index within the TLAS.

Barycoord convention matches [rayIntersectionResultStruct](rayIntersectionResultStruct): `(bary_a, bary_b, bary_c)`
where each component is the weight for the corresponding vertex in `faceIndices.xyz`.

## BVHComputeData

Packs one or more scene objects into GPU-accessible BVH buffers (TLAS + BLAS) for use
in WebGPU compute shaders via the Three.js TSL node system. After construction, call
[BVHComputeData#update](BVHComputeData#update) to populate the storage buffers, then reference
`this.storage` and `this.fns` in your compute shader nodes.

`this.fns` provides the following WGSL functions:
- `raycastFirstHit( ray, &hit ) -> bool`: finds the closest ray / triangle intersection.
- `raycastAnyHit( ray ) -> bool`: occlusion query that returns as soon as any triangle is hit.
- `closestPointToPoint`: finds the closest point on the scene's triangles to a point.
- `getTriangleIndices( triIndex, indexOffset ) -> vec3u`: reads the vertex indices of a triangle.
- `getVertex( index, attributesOffset ) -> bvh_GeometryStruct`: reads the attributes of a vertex. The index and
  attribute data share one internal buffer whose packing may change, so read them through these.
- `getVertexPosition( index, attributesOffset ) -> vec3f`: reads only the position of a vertex, for custom traversal.
- `sampleTrianglePoint( barycoord, indices, attributesOffset ) -> bvh_GeometryStruct`: interpolates a triangle's attributes.

Triangle and vertex indices, including those of a hit, are relative to the geometry of the object
they belong to. The offsets to read them with are the `indexOffset` and `attributesOffset` of the
object's record in `storage.objects`, eg `objects[ hit.objectIndex ].attributesOffset`.

`this.attributeLayout` describes how a vertex is packed in `storage.geometry` once `update` has run: the
vertex `stride` and the `offset` and `size` of each attribute, in 32-bit words.

Ray queries expect a normalized, scene-space `ray.direction` and treat triangles as two-sided.
A positive `ray.maxDist` excludes hits at or beyond that distance; zero means unbounded.
No alpha or material tests are applied.

> [!NOTE]
> This API is unstable and subject to change in future releases.

> [!NOTE]
> This class requires three.js r185 or higher.

### .constructor

```js
constructor(
	objects: Object3D | BufferGeometry | GeometryBVH | Array,
	{
		// Type map for the interleaved per-vertex attribute buffer.
		// Keys are geometry attribute names; values are `'f32'`,
		// `'vec2f'`, `'vec3f'` or `'vec4f'`, or one of the packed
		// types: `'oct16'` stores a direction and the sign of w in one
		// word (normals, tangents) and always unpacks to a `vec4f`
		// unit vector with w = ±1, `'2x16float'` stores two half
		// floats in one word (uvs) and unpacks to a `vec2f`, and
		// `'4x16float'` stores four half floats in two words (colors)
		// and unpacks to a `vec4f`.
		attributes = { position: 'vec4f' }: Record<string, string>,

		// When true, a [MeshBVH](MeshBVH) is automatically built for any
		// object that does not already have `geometry.boundsTree` set,
		// using the `SAH` split strategy for faster GPU traversal.
		autogenerateBvh = true: boolean,
	}
)
```

### .getRootObject

```js
getRootObject(): Object3D
```

Returns the representative root object for the scene to be constructed.


### .getShapecastFn

```js
getShapecastFn(
	{
		// Function name. Defaults to a random identifier.
		name?: string,

		// TSL struct or definition describing the query shape.
		shapeStruct: StructTypeNode,

		// TSL struct for the accumulated result, or null.
		resultStruct?: StructTypeNode | null,

		// function node that runs before the bvh traversal - useful
		// for resetting or initializing necessary module variables.
		prefixFn?: function | null,

		// function node controlling left/right child traversal order.
		boundsOrderFn?: function | null,

		// function node testing the shape against a BVH node's bounds.
		intersectsBoundsFn: function,

		// function node testing a leaf triangle range, called with the
		// shape, the range's triangle offset and count, the
		// "indexOffset" and "attributesOffset" of the geometry being
		// traversed to pass to `fns.getTriangleIndices` and
		// `fns.getVertexPosition`, and the result. Returns
		// `NOT_INTERSECTED` (0), `INTERSECTED` (1), or
		// `STOP_TRAVERSAL` (3, a hit that ends the entire traversal
		// after running `transformResultFn` and `resetShapeFn`).
		// Boolean returns remain supported: false misses and true hits
		// without stopping.
		intersectRangeFn: function,

		// function node that transforms the shape into object local
		// space. Returns whether to traverse the object. When
		// returning false the shape and any per-object state must be
		// left untouched, since `resetShapeFn` is not called for a
		// skipped object.
		transformShapeFn?: function | null,

		// function node that transforms a hit result back to world
		// space.
		transformResultFn?: function | null,

		// function node called after each BLAS traversal to reset any
		// per-object state set by `transformShapeFn`.
		resetShapeFn?: function | null,
	}
): function
```

Builds a WGSL shapecast function that traverses the TLAS and per-cluster BLAS in a single
merged stack/loop for a custom shape type. The returned function signature is:
`fn name( shape: ShapeStruct[, result: ptr<function, ResultStruct>] ) -> bool`


### .update

```js
async update(): Promise<void>
```

Rebuilds all GPU storage buffers from the current scene state. Must be called at least
once before using `this.storage` or `this.fns` in a shader, and again whenever the
scene topology changes (objects added/removed, geometry modified). Awaits
[BVHComputeData#getBVH](BVHComputeData#getBVH) for every object and instance first, so an override may build
the BVHs asynchronously as long as it returns the built BVH synchronously afterward. The BVHs
are all requested at once.

> [!NOTE]
> When "update" is called again before an earlier call finishes, only the latest call writes the
> buffers. The earlier ones resolve without changing them.

### .updateTransforms

```js
updateTransforms(): void
```

Refits the clustered BVH and rewrites every record in `storage.objects` from the objects'
current world matrices. Call this when object transforms or visibility change but the scene
topology does not. The object indices are derived from the clustered BVH's primitive buffer,
so they match those written by [BVHComputeData#update](BVHComputeData#update).


### .writeObjectRecord

```js
writeObjectRecord(
	info: Object,
	premultiplyMatrix: Matrix4,
	writeOffset: number,
	targetBuffer: ArrayBuffer
): void
```

Writes one object record into a raw ArrayBuffer: the world/inverse-world matrices, the
visibility flag, and where the object's geometry starts in `storage.geometry`. Override this
in a subclass to write additional per-object data (e.g. material index) into members added
after the base record's.


### .getBVH

```js
getBVH(
	object: Object3D,
	instanceId: number,
	rangeTarget: Object
): MeshBVH | SkinnedMeshBVH | null | Promise<(MeshBVH|SkinnedMeshBVH|null)>
```

Returns the BVH for a given object/instance, populating `rangeTarget` with the
corresponding index and vertex ranges within the packed geometry buffers. Override
to support custom BVH types or caching strategies. An override may return a promise while
the BVH is being built, and the BVH itself once it is.

> [!NOTE]
> It may be called multiple times for the same object during an update and must be monotonic
> over that period: the same promise while the BVH builds, then the built BVH.

### .getObjectInfo

```js
getObjectInfo(
	object: Object3D,
	instanceId = 0: number,
	group = 0: number
): ObjectInfo | null
```

Returns where an object was packed by the last [BVHComputeData#update](BVHComputeData#update), or null if it was not.


### .getAllObjectInfo

```js
getAllObjectInfo(): Array<ObjectInfo>
```

Returns where every object was packed by the last [BVHComputeData#update](BVHComputeData#update), in object index order.


### .getDefaultAttributeValue

```js
getDefaultAttributeValue( key: string, target: Vector4 ): Vector4
```

Returns the default vec4 value written to the attribute buffer for vertices that lack
a given attribute. Override to change per-attribute defaults.


### .dispose

```js
dispose(): void
```

Releases GPU resources held by this instance.


## AttributeLayout

The tightly packed per-vertex attribute layout, as in `BVHComputeData.attributeLayout`.


### .members

```js
members: Array<AttributeLayoutMember>
```

Attributes in declaration order.

### .stride

```js
stride: number
```

Vertex stride in 32-bit words.

## AttributeLayoutMember

An attribute in the packed per-vertex layout.


### .name

```js
name: string
```

Geometry attribute name.

### .type

```js
type: string
```

Attribute type, eg "vec3f" or "oct16".

### .structType

```js
structType: string
```

WGSL type of the unpacked value in the attribute struct.

### .offset

```js
offset: number
```

Offset within the vertex in 32-bit words.

### .size

```js
size: number
```

Size in 32-bit words.

## ObjectInfo

Where an object is packed in the storage buffers, as returned by `BVHComputeData.getObjectInfo` and
`BVHComputeData.getAllObjectInfo`.


### .object

```js
object: Object3D
```

The mesh.

### .instanceId

```js
instanceId: number
```

Instance index (relevant for InstancedMesh / BatchedMesh).

### .group

```js
group: number
```

Index of the BVH root, one per geometry group and each packed as its own object.
  Always 0 for an indirect BVH, which has a single root.

### .objectIndex

```js
objectIndex: number
```

Index of the object's record in `storage.objects`. Hits report it as `objectIndex`.

### .indexOffset

```js
indexOffset: number
```

Where the index data of the object's geometry starts in `storage.geometry`,
  in 32-bit words. Shared by the objects of a geometry's groups.

### .attributesOffset

```js
attributesOffset: number
```

Where the vertex attributes of the object's geometry start in
  `storage.geometry`, in 32-bit words.

### .primitiveOffset

```js
primitiveOffset: number
```

The object's first primitive, counted from the start of its geometry's
  index data. Non-zero for a geometry group after the first.

### .primitiveCount

```js
primitiveCount: number
```

The number of primitives in the object.
