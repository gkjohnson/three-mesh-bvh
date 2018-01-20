# threejs-raycast-updates

A modification to threejs mesh raycasting that builds a bounds tree from the triangles to make raycasting against high-polygon meshes faster.

![screenshot](./docs/screenshot.png)

## Use

TODO

## Options

TODO

## TODO
- Add option to basically devolve to an oct tree to speed up generation of tree
- Consider progressive generation of the tree, splitting nodes only when necessary
- Add option to take only the first hit to speed things up
- Add options for depth / leaf node count
- Add faster methods for box updates
- Use in conjunction with THREE Octtree for faster queries? Or do something similar
- Build demo page
