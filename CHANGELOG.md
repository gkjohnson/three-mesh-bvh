# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

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
