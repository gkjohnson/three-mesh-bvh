# three-mesh-bvh

[![npm version](https://img.shields.io/npm/v/three-mesh-bvh.svg?style=flat-square)](https://www.npmjs.com/package/three-mesh-bvh)
[![build](https://img.shields.io/github/actions/workflow/status/gkjohnson/three-mesh-bvh/node.js.yml?style=flat-square&label=build&branch=master)](https://github.com/gkjohnson/three-mesh-bvh/actions)
[![github](https://flat.badgen.net/badge/icon/github?icon=github&label)](https://github.com/gkjohnson/three-mesh-bvh/)
[![twitter](https://flat.badgen.net/badge/twitter/@garrettkjohnson/?icon&label)](https://twitter.com/garrettkjohnson)
[![sponsors](https://img.shields.io/github/sponsors/gkjohnson?style=flat-square&color=1da1f2)](https://github.com/sponsors/gkjohnson/)

A Bounding Volume Hierarchy (BVH) implementation to speed up raycasting and enable spatial queries against three.js meshes. See the associated [Wikipedia article](https://en.wikipedia.org/wiki/Bounding_volume_hierarchy) for more information on bounding volume hierarchies and how they work.

![screenshot](./docs/example-sm.gif)

Casting 500 rays against an 80,000 polygon model at 60fps!

# Examples

[Raycasting](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/raycast.html)

[Skinned geometry](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/skinnedMesh.html)

[Point cloud intersection](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/pointCloudIntersection.html)

[Line intersection](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/lineIntersection.html)

[Shape intersection](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/shapecast.html)

[Geometry edge intersection](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/edgeIntersect.html)

[SDF generation](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/sdfGeneration.html)

[WebWorker generation](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/asyncGenerate.html)

[BVH options inspector](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/inspector.html)

[BatchedMesh Raycasting](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/batchedMesh.html)

**Tools**

[Sculpting](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/sculpt.html)

[Distance comparison](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/distancecast.html)

[Triangle painting](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/collectTriangles.html)

[Lasso selection](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/selection.html)

[Clipped edges](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/clippedEdges.html)

[Geometry voxelization](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/voxelize.html)

**Games**

[Sphere physics collision](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/physics.html)

[Player movement](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/characterMovement.html)

**Path Tracing**

[Simple GPU Path Tracing](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/gpuPathTracingSimple.html)

[Lambert GPU Path Tracing](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/gpuPathTracing.html)

[CPU Path Tracing](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/cpuPathTracing.html)

[Gem Refraction Path Tracing](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/diamond.html)

**Object Hierarchy BVH**

[Accelerated Scene Raycasting](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/objectbvh_sceneRaycast.html)

[Skinned Meshes](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/objectbvh_skinnedMeshes.html)

[Frustum Culling](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/objectbvh_frustumCulling.html)

<!-- [Character Movement](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/objectbvh_characterMovement.html) -->


<!--
**WebGPU Compute Shaders**

[Simple Path Tracing](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/webgpu_gpuPathTracingSimple.html)
-->

**External Projects**

[three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer)

[three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg)

[three-edge-projection](https://github.com/gkjohnson/three-edge-projection/)

# Use

Using pre-made functions

```js
import * as THREE from 'three';
import {
	computeBoundsTree, disposeBoundsTree,
	computeBatchedBoundsTree, disposeBatchedBoundsTree, acceleratedRaycast,
} from 'three-mesh-bvh';

// Add the extension functions
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

THREE.BatchedMesh.prototype.computeBoundsTree = computeBatchedBoundsTree;
THREE.BatchedMesh.prototype.disposeBoundsTree = disposeBatchedBoundsTree;
THREE.BatchedMesh.prototype.raycast = acceleratedRaycast;

// Generate geometry and associated BVH
const geom = new THREE.TorusKnotGeometry( 10, 3, 400, 100 );
const mesh = new THREE.Mesh( geom, material );
geom.computeBoundsTree();

// Or generate BatchedMesh and associated BVHs
const batchedMesh = new THREE.BatchedMesh( ... );
const geomId = batchedMesh.addGeometry( geom );
const instId = batchedMesh.addGeometry( geom );

// Generate bounds tree for sub geometry
batchedMesh.computeBoundsTree( geomId );
```

Or manually building the BVH

```js
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

// Add the raycast function. Assumes the BVH is available on
// the `boundsTree` variable
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// ...

// Generate the BVH and use the newly generated index
geom.boundsTree = new MeshBVH( geom );
```

And then raycasting

```js
// Setting "firstHitOnly" to true means the Mesh.raycast function will use the
// bvh "raycastFirst" function to return a result more quickly.
const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;
raycaster.intersectObjects( [ mesh ] );
```

## Additional Geometry BVHs

In addition to `MeshBVH` for triangle meshes, the library provides specialized BVH implementations for other geometry types:

- **PointsBVH** - For `THREE.Points` geometries
- **LineBVH** - For `THREE.Line` geometries
- **LineLoopBVH** - For `THREE.LineLoop` geometries
- **LineSegmentsBVH** - For `THREE.LineSegments` geometries

These can be used with the extension functions by passing a `type` option into "computeBoundsTree" or constructing them explicitly:

```js
import { PointsBVH } from 'three-mesh-bvh';

// For point clouds
THREE.Points.prototype.raycast = acceleratedRaycast;

const points = new THREE.Points( geometry, material );
geometry.computeBoundsTree( { type: PointsBVH } );

// Or create directly
geometry.boundsTree = new PointsBVH( geometry );
```

Each BVH type implements a core API including shapecast & raycastObject3D for its specific primitive type. See the [point cloud intersection](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/pointCloudIntersection.html) & [line intersection](https://gkjohnson.github.io/three-mesh-bvh/example/bundle/lineIntersection.html) examples for a working demonstration. Some features like webworker-generation and serialization are not supported at the moment.

## Additional BVHs

A `SkinnedMeshBVH` for SkinnedMeshes and `ObjectBVH` for constructing scene-wide BVH to query a hierarchy of objects. These are recently added so the APIs may change over time.

## Querying the BVH Directly

```js
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

let mesh, geometry;
const invMat = new THREE.Matrix4();

// instantiate the geometry

// ...

const bvh = new MeshBVH( geometry );
invMat.copy( mesh.matrixWorld ).invert();

// raycasting
// ensure the ray is in the local space of the geometry being cast against
raycaster.ray.applyMatrix4( invMat );
const hit = bvh.raycastFirst( raycaster.ray );

// results are returned in local spac, as well, so they must be transformed into
// world space if needed.
hit.point.applyMatrixWorld( mesh.matrixWorld );

// spherecasting
// ensure the sphere is in the local space of the geometry being cast against
sphere.applyMatrix4( invMat );
const intersects = bvh.intersectsSphere( sphere );
```

## Serialization and Deserialization

```js
const geometry = new KnotGeometry( 1, 0.5, 40, 10 );
const bvh = new MeshBVH( geometry );
const serialized = MeshBVH.serialize( bvh );

// ...

const deserializedBVH = MeshBVH.deserialize( serialized, geometry );
geometry.boundsTree = deserializedBVH;
```

## Asynchronous Generation

_NOTE WebWorker syntax is inconsistently supported across bundlers and sometimes not supported at all so the GenerateMeshBVHWorker class is exported separately via `three-mesh-bvh/worker` subpath. If needed the code from `src/worker` can be copied and modified to accommodate a particular build process._

```js
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/worker';

// ...

const geometry = new KnotGeometry( 1, 0.5, 40, 10 );
const worker = new GenerateMeshBVHWorker();
worker.generate( geometry ).then( bvh => {

    geometry.boundsTree = bvh;

} );
```

_Parallel BVH generation is also supported using "ParallelMeshBVHWorker", which requires support for SharedArrayBuffer. If SharedArrayBuffer is not available it falls back to "GenerateMeshBVHWorker". It is recommended that geometry passed to this function have `position` and `index` with SharedArrayBuffer arrays, otherwise buffer copies must be made._

```js
import { ParallelMeshBVHWorker } from 'three-mesh-bvh/worker';

// ...

const geometry = new KnotGeometry( 1, 0.5, 40, 10 );
const worker = new ParallelMeshBVHWorker();
worker.generate( geometry ).then( bvh => {

    geometry.boundsTree = bvh;

} );
```

## BVH Queries in a Shader

See the shader implementation in the [simple GPU Path Tracing example](https://github.com/gkjohnson/three-mesh-bvh/blob/master/example/gpuPathTracingSimple.js) for an example on how to perform BVH ray queries in a shader. Or the [GPU SDF Generation example](https://github.com/gkjohnson/three-mesh-bvh/blob/master/example/sdfGeneration.js) for how to perform distance and closest point to point queries in a shader.

# API

See [API.md](./API.md) for full API documentation.

## Gotchas

- When querying the MeshBVH directly all shapes and geometry are expected to be specified in the local frame of the BVH. When using three.js' built in raycasting system all results are implicitly transformed into world coordinates.
- A bounds tree can be generated for either an indexed or non-indexed `BufferGeometry`, but an index will
  be produced and retained as a side effect of the construction unless the "indirect" option is used.
- The bounds hierarchy is _not_ dynamic, so geometry that uses morph targets or skinning cannot be used. Though if vertex positions are modified directly the [refit](#refit) function can be used to adjust the bounds tree.
- If the geometry is changed then a new bounds tree will need to be generated or refit.
- [InterleavedBufferAttributes](https://threejs.org/docs/#api/en/core/InterleavedBufferAttribute) are not supported with the geometry index buffer attribute.
- A separate bounds tree root is generated for each [geometry group](https://threejs.org/docs/#api/en/objects/Group), which could result in less than optimal raycast performance on geometry with lots of groups. Triangles excluded from these groups are not included in the BVH.
- Due to errors related to floating point precision it is recommended that geometry be centered using `BufferGeometry.center()` before creating the BVH if the geometry is sufficiently large or off center so bounds tightly contain the geometry as much as possible.

# Running Examples Locally

To run the examples locally:
- Run `npm start`
- Then visit `localhost:5173/<demo-name>.html`

Where `<demo-name>` is the name of the HTML file from `example` folder.


# Used and Supported by

<a href="https://www.threekit.com/" title="threekit"><img src="https://user-images.githubusercontent.com/734200/162633617-aad48fd1-931e-4e5e-8811-c29e799ee95a.png" width="20%"/></a><a href="https://matterport.com/" title="matterport"><img src="https://user-images.githubusercontent.com/734200/162633614-27f7f1e5-7f3c-4c55-99da-de0e7636dbcf.png" width="20%"/></a><a href="https://www.flux.ai/" title="flux"><img src="https://user-images.githubusercontent.com/734200/162633622-ed1e80b2-ee3b-4998-872c-a690d7b86eaf.png" width="20%"/></a><a href="https://www.resonai.com/" title="resonai"><img src="https://user-images.githubusercontent.com/734200/162694304-57be0ef3-a2d4-4af7-b3e0-6626cbef97a0.png" width="20%"/></a><a href="https://www.sitescape.ai/" title="sitescape"><img src="https://user-images.githubusercontent.com/734200/162633616-2649b441-dca8-490c-891f-f433aad24172.png" width="20%"/></a><a href="https://ifcjs.github.io/info/" title="ifc.js"><img src="https://user-images.githubusercontent.com/734200/162633613-1fa05098-0610-4e93-936a-ea12bcdc62e3.png" width="20%"/></a><a href="https://utsubo.co/" title="utsubo"><img src="https://user-images.githubusercontent.com/734200/162633619-fb6404c0-3a7d-40b2-8e9a-2014d904146c.png" width="20%"/></a><a href="https://github.com/phoenixbf/aton" title="aton"><img src="https://user-images.githubusercontent.com/734200/162633621-d0b49f47-5520-48da-a1fd-1d1fa88459a6.png" width="20%"/></a><a href="https://polygonjs.com/" title="polygonjs"><img src="https://user-images.githubusercontent.com/734200/162633615-b6d136e1-1580-4230-a3e9-2dfbcf8923d1.png" width="20%"/></a><a href="https://vartiste.xyz/" title="vartiste"><img src="https://user-images.githubusercontent.com/734200/162633620-e95f446f-af5d-4579-8ab5-2eeaf00b37ad.png" width="20%"/></a>

...and more!
