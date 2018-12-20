# threejs-fast-raycast

[![lgtm code quality](https://img.shields.io/lgtm/grade/javascript/g/gkjohnson/threejs-fast-raycast.svg?style=flat-square&label=code-quality)](https://lgtm.com/projects/g/gkjohnson/threejs-fast-raycast/)
[![travis build](https://img.shields.io/travis/gkjohnson/threejs-fast-raycast.svg?style=flat-square)](https://travis-ci.org/gkjohnson/threejs-fast-raycast)

A THREEjs utility for providing more efficient raycasts against sufficiently complex meshes.

[Demo Here!](https://gkjohnson.github.io/threejs-fast-raycast/example/bundle/boundsTree.html)

![screenshot](./docs/example-sm.gif)

Casting 500 rays against an 80,000 polygon model at 60fps!

## Use

```js
import * as THREE from '.../three.js'
import '.../threejs-fast-raycasting.js'

// 80,000 polygon mesh
const geom = new THREE.TorusKnotBufferGeometry(10, 3, 400, 100);
const mesh = new THREE.Mesh(geom, material);
geom.computeBoundsTree();

// Fast raycasts!
```

### THREE API Extensions
#### BufferGeometry
##### computeBoundsTree()

Computes a bounds hierarchy for the geometry which is used to for raycasts. Comparable to `computeBoundingBox` and `computeBoundingSphere`.

##### disposeBoundsTree()

Removes the previously caculated bounds tree

##### boundsTree

A direct handle to the calculated bounds tree.

#### Raycaster
##### firstHitOnly

The `intersectObject` and `intersectObjects` functions use a `firstHitOnly` field on the raycaster indicating that only the first hit should be pushed onto the `intersects` array for every piece of geometry. Setting `firstHitOnly` to true makes bounds tree-enabled intersections much faster.

```js
raycaster.firstHitOnly = true;
raycaster.intersectObjects( objects );
```

## Gotchas

- This is intended to be used with complicated, high-poly meshes. With less complex meshes, the benefits are negligible.
- A bounds tree can be generated for either an indexed or non-indexed `BufferGeometry`, but an index will
  be produced and retained as a side effect of the construction.
- The bounds hierarchy is _not_ dynamic, so geometry that uses morph targets cannot be used.
- If the geometry is changed, then a call to `computedBoundsTree()` is required to update the bounds tree.
