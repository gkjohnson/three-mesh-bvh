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

## TSL Structs

### rayStruct

```js
rayStruct: StructTypeNode
```

WGSL struct node representing a ray with an origin and direction.
Used as the input to BVH traversal and intersection functions.

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

> [!NOTE]
> This API is unstable and subject to change in future releases.

> [!NOTE]
> This class requires three.js r185 or higher.

### .constructor

```js
constructor(
	bvh: ObjectBVH | Object3D | BufferGeometry | GeometryBVH | Array,
	{
		// WGSL type map for the interleaved per-vertex attribute
		// buffer. Keys are geometry attribute names; values are WGSL
		// type strings (e.g. `'vec3f'`, `'vec4f'`).
		attributes = { position: 'vec4f' }: Record<string, string>,

		// When true, a [MeshBVH](MeshBVH) is automatically built for any
		// object that does not already have `geometry.boundsTree` set.
		autogenerateBvh = true: boolean,
	}
)
```

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

		// function node controlling left/right child traversal order.
		boundsOrderFn?: function | null,

		// function node testing the shape against a BVH node's bounds.
		intersectsBoundsFn: function,

		// function node testing the shape against a leaf triangle
		// range.
		intersectRangeFn: function,

		// function node that transforms the shape into object local
		// space.
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

Builds a pair of WGSL shapecast functions (BLAS + TLAS traversal) for a custom shape
type. The returned TLAS function signature is:
`fn name( shape: ShapeStruct[, result: ptr<function, ResultStruct>] ) -> bool`


### .update

```js
update(): void
```

Rebuilds all GPU storage buffers from the current scene state. Must be called at least
once before using `this.storage` or `this.fns` in a shader, and again whenever the
scene topology changes (objects added/removed, geometry modified).


### .dispose

```js
dispose(): void
```

Releases GPU resources held by this instance.

