# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## Unreleased
### Added
- API for performing intersecting boxes, spheres, and geometry.
- API for checking the distance to geometry and points.

## [0.1.0] - 2019-02-28
### Added
- Error conditions when using `InterleavedAttributeBuffers` for both index and position geometry attributes.
- The geometry index attribute is modified when building the `MeshBVH`. And index attribute is created on geometry if it does not exist.

### Fixed
- Fix the bounds tree not respecting groups

## [0.0.2] - 2019-01-05
### Added
- Add included files array to package.json.
