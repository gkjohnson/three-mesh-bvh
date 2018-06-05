# threejs-fast-raycast

A THREEjs utility for providing more efficient raycasts against sufficiently complex meshes.

[Demo Here!](https://gkjohnson.github.io/threejs-fast-raycast/example/index.bundle.html)

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
#### BufferGeometry & Geometry
##### computeBoundsTree()

Computes a bounds hierarchy for the geometry which is used to for raycasts. Comparable to `computeBoundingBox` and `computeBoundingSphere`.

##### disposeBoundsTree()

Removes the previously caculated bounds tree

##### boundsTree

A direct handle to the calculated bounds tree.

#### Raycaster
##### instersectObject(object, recursive, optionalTarget, firstHitOnly = false)
##### instersectObjects(objects, recursive, optionalTarget, firstHitOnly = false)

The `intersectObject` and `intersectObjects` functions have an added `firstHitOnly` parameter indicating that only the first hit should be pushed onto the `intersects` array for every piece of geometry. Setting `firstHitOnly` to true makes bounds tree-enabled intersections much faster.

## Gotchas

- This is intended to be used with complicated, high-poly meshes. With less complex meshes, the benefits are negligible.
- Computing the bounds hierarchy is faster for `THREE.BufferGeometry` than it is for `THREE.Geometry`.
- The bounds hierarchy is _not_ dynamic, so geometry that uses morph targets cannot be used.
- If the geometry is changed, then a call to `computedBoundsTree()` is required to update the bounds tree.

## Approach

TODO

## TODO
- Add option to basically devolve to an oct tree to speed up generation of tree
- Consider progressive generation of the tree, splitting nodes only when necessary
- Add option to take only the first hit to speed things up
- Use in conjunction with THREE Octtree for faster queries? Or do something similar
