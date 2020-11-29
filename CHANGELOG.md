# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## Unreleased
### Added
- `generateAsync` function in the `/src/worker` folder to help generate BVHs asynchronously with WebWorkers.

### Changed
- three.js version to use v0.123.0, change `Matrix4.getInverse` to `Matrix4.invert`.

## [0.2.0] - 2020-02-07
### Added
- MeshBVH.serialize and deserialize functions so the bvh can be computed and transferred from a webworker.
- `lazyGeneration` (defaults to true) option for faster tree initialization.
- Support for a buffer-packed tree if `lazyGeneration` is false or a tree has been deserialized for a more smaller memory footprint.

### Changed
- CENTER tree computation to improve raycast performance and create more balanced trees.

## [0.1.5] - 2020-01-03
### Fixed
- Uglify warning for inline defined functions.

## [0.1.4] - 2019-08-31
### Changed
- Changed three.js peer dependency version from ^ to >= to prevent warnings.

## [0.1.3] - 2019-05-24
### Added
- Use the BufferGeometry bounding box if it exists and set it if it does not.

### Changed
- Use the center of the triangles bounding box instead of the average of the vertices as the triangles center when binning the polygons.

## [0.1.2] - 2019-03-17
### Fixed
- Bug where `closestPointToGeometry` would throw an error when target vectors were provided because a function name was misspelled.

## [0.1.1] - 2019-03-16
### Added
- API for performing intersecting boxes, spheres, and geometry.
- API for checking the distance to geometry and points.

### Fixed
- Fixed issue where an index buffer of the incorrect type was created if there were more than 2^16 vertices.
- Fixed MeshBVHVisualizer not visualizing all the groups in the bvh.

## [0.1.0] - 2019-02-28
### Added
- Error conditions when using `InterleavedAttributeBuffers` for both index and position geometry attributes.
- The geometry index attribute is modified when building the `MeshBVH`. And index attribute is created on geometry if it does not exist.

### Fixed
- Fix the bounds tree not respecting groups

## [0.0.2] - 2019-01-05
### Added
- Add included files array to package.json.
