# three-mesh-bvh

[![npm version](https://img.shields.io/npm/v/three-mesh-bvh.svg?style=flat-square)](https://www.npmjs.com/package/three-mesh-bvh)
[![lgtm code quality](https://img.shields.io/lgtm/grade/javascript/g/gkjohnson/three-mesh-bvh.svg?style=flat-square&label=code-quality)](https://lgtm.com/projects/g/gkjohnson/three-mesh-bvh/)
[![travis build](https://img.shields.io/travis/gkjohnson/three-mesh-bvh/master.svg?style=flat-square)](https://travis-ci.com/gkjohnson/three-mesh-bvh)

A BVH implementation to speed up raycasting against three.js meshes.

![screenshot](./docs/example-sm.gif)

Casting 500 rays against an 80,000 polygon model at 60fps!

[Raycasting demo](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/raycast.html)

[Shape intersection demo](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/shapecast.html)

[Triangle painting demo](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/collectTriangles.html)

# Use

Using pre-made functions

```js
// Import via ES6 modules
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// Or UMD
const { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } = window.MeshBVHLib;


// Add the extension functions
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// Generate geometry and associated BVH
const geom = new THREE.TorusKnotBufferGeometry(10, 3, 400, 100);
const mesh = new THREE.Mesh(geom, material);
geom.computeBoundsTree();
```

Or manually building the BVH

```js
// Import via ES6 modules
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } 'three-mesh-bvh';

// Or UMD
const { MeshBVH, acceleratedRaycast } = window.MeshBVHLib;


// Add the raycast function. Assumes the BVH is available on
// the `boundsTree` variable
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// ...

// Generate the BVH and use the newly generated index
geom.boundsTree = new MeshBVH(geom);
```

And then raycasting

```js
// Setting "firstHitOnly" to true means the Mesh.raycast function will use the
// bvh "raycastFirst" function to return a result more quickly.
const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;
raycaster.intersectObjects( [ mesh ] );
```

# Exports

## Split Strategy Constants

### CENTER

Option for splitting each BVH node down the center of the longest axis of the bounds.

This is the fastest construction option but will yield a less optimal hierarchy.

### AVERAGE

Option for splitting each BVH node at the average point along the longest axis for all triangle centroids in the bounds.

### SAH

Option to use a Surface Area Heuristic to split the bounds optimally.

This is the slowest construction option.

## MeshBVH

The MeshBVH generation process modifies the geometry's index bufferAttribute in place to save memory. The BVH construction will use the geometry's boundingBox if it exists or set it if it does not. The BVH will no longer work correctly if the index buffer is modified.

### .constructor

```js
constructor( geometry : BufferGeometry, options : Object )
```

Constructs the bounds tree for the given geometry and produces a new index attribute buffer. The available options are

```js
{
    // Which split strategy to use when constructing the BVH
    strategy: CENTER,

    // The maximum depth to allow the tree to build to
    // Setting this to a smaller trades raycast speed for better construction
    // time and less memory allocation
    maxDepth: 40,

    // The number of triangles to aim for in a leaf node
    maxLeafTris: 10,

    // Whether to generate the tree nodes progressively during casts
    lazyGeneration: false,

    // Print out warnings encountered during tree construction
    verbose: true,

}
```

*NOTE: The geometry's index attribute array is modified in order to build the bounds tree. If the geometry has no index then one is added.*

### .raycast

```js
raycast( mesh : Mesh, raycaster : Raycaster, ray : Ray, intersects : Array) : Array<RaycastHit>
```

Adds all raycast triangle hits in unsorted order to the `intersects` array. It is expected that `ray` is in the frame of the mesh being raycast against and that the geometry on `mesh` is the same as the one used to generate the bvh.

### .raycastFirst

```js
raycastFirst( mesh : Mesh, raycaster : Raycaster, ray : Ray) : RaycastHit
```

Returns the first raycast hit in the model. This is typically much faster than returning all hits.

### .intersectsSphere

```js
intersectsSphere( mesh : Mesh, sphere : Sphere ) : Boolean
```

Returns whether or not the mesh instersects the given sphere.

### .intersectsBox

```js
intersectsBox( mesh : Mesh, box : Box3, boxToBvh : Matrix4 ) : Boolean
```

Returns whether or not the mesh intersects the given box.

The `boxToBvh` parameter is the transform of the box in the meshs frame.

### .intersectsGeometry

```js
intersectsGeometry( mesh : Mesh, geometry : BufferGeometry, geometryToBvh : Matrix4 ) : Boolean
```

Returns whether or not the mesh intersects the given geometry.

The `geometryToBvh` parameter is the transform of the geometry in the mesh's frame.

Performance improves considerably if the provided geometry _also_ has a `boundsTree`.

### .closestPointToPoint

```js
closestPointToPoint( mesh : Mesh, point : Vector3, target : Vector3 ) : Number
```

Returns the closest distance from the point to the mesh and puts the closest point on the mesh in `target`.

### .closestPointToGeometry

```js
closestPointToGeometry(
	mesh : Mesh,
	geometry : BufferGeometry,
	geometryToBvh : Matrix4,
	target1 : Vector3,
	target2 : Vector3
) : Number
```

Returns the closest distance from the geometry to the mesh and puts the closest point on the mesh in `target1` and the closest point on the other geometry in `target2` in the frame of the BVH.

The `geometryToBvh` parameter is the transform of the geometry in the mesh's frame.

## MeshBVHVisualizer

Displays a view of the bounds tree up to the given depth of the tree.

_Note: The visualizer is expected to be a sibling of the mesh being visualized._

### .depth

```js
depth : Number
```

The depth to traverse and visualize the tree to.

### .constructor

```js
constructor( mesh: THREE.Mesh, depth = 10 : Number )
```

Instantiates the helper with a depth and mesh to visualize.

### .update

```js
update() : void
```

Updates the display of the bounds tree in the case that the bounds tree has changed or the depth parameter has changed.

## Extensions

### Raycaster.firstHitOnly

```js
firstHitOnly = false : Boolean
```

The the `Raycaster` member `firstHitOnly` is set to true then the [.acceleratedRaycast](#acceleratedRaycast) function will call the [.raycastFirst](#raycastFirst) function to retrieve hits which is generally faster.

### .computeBoundsTree

```js
computeBoundsTree( options : Object ) : void
```

A pre-made BufferGeometry extension function that builds a new BVH, assigns it to `boundsTree`, and applies the new index buffer to the geometry. Comparable to `computeBoundingBox` and `computeBoundingSphere`.

```js
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
```

### .disposeBoundsTree

```js
disposeBoundsTree() : void
```

A BufferGeometry extension function that disposes of the BVH.

```js
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
```

### .acceleratedRaycast

```js
acceleratedRaycast( ... )
```

An accelerated raycast function with the same signature as `THREE.Mesh.raycast`. Uses the BVH for raycasting if it's available otherwise it falls back to the built-in approach.

If the raycaster object being used has a property `firstHitOnly` set to `true`, then the raycasting will terminate as soon as it finds the closest intersection to the ray's origin and return only that intersection. This is typically several times faster than searching for all intersections.

```js
THREE.Mesh.prototype.raycast = acceleratedRaycast;
```

## Debug Functions

### .estimateMemoryInBytes

```js
estimateMemoryInBytes( bvh : MeshBVH ) : Number
```

Roughly estimates the amount of memory in bytes a BVH is using.

### .getBVHExtremes

```js
getBVHExtremes( bvh : MeshBVH ) : Array< Object >
```

Measures the min and max extremes of the tree including node depth, leaf triangle count, and number of splits on different axes to show how well a tree is structured. Returns an array of extremes for each group root for the bvh. The objects are structured like so:

```js
{
	depth: { min: Number, max: Number },
	tris: { min: Number, max: Number },
	splits: [ Number, Number, Number ]
}
```

## Gotchas

- This is intended to be used with complicated, high-poly meshes. With less complex meshes, the benefits are negligible.
- A bounds tree can be generated for either an indexed or non-indexed `BufferGeometry`, but an index will
  be produced and retained as a side effect of the construction.
- The bounds hierarchy is _not_ dynamic, so geometry that uses morph targets cannot be used.
- If the geometry is changed then a new bounds tree will need to be generated.
- Only BufferGeometry (not [Geometry](https://threejs.org/docs/#api/en/core/Geometry)) is supported when building a bounds tree.
- [InterleavedBufferAttributes](https://threejs.org/docs/#api/en/core/InterleavedBufferAttribute) are not supported on the geometry index or position attributes.
- A separate bounds tree is generated for each [geometry group](https://threejs.org/docs/#api/en/objects/Group), which could result in poorer raycast performance on geometry with lots of groups.
- Due to errors related to floating point precision it is recommended that geometry be centered using `BufferGeometry.center()` before creating the BVH if the geometry is sufficiently large or off center.
- Geometry with a lot of particularly long triangles on one axis can lead to a less than optimal bounds tree (see [#121](https://github.com/gkjohnson/three-mesh-bvh/issues/121)).
