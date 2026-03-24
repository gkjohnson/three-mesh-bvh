/** @import { Raycaster, Intersection } from 'three' */
/** @import { GeometryBVH } from '../core/GeometryBVH.js' */
import { Mesh, Points, Line, LineLoop, LineSegments, Sphere, BatchedMesh, REVISION } from 'three';
import { MeshBVH } from '../core/MeshBVH.js';

const IS_REVISION_166 = parseInt( REVISION ) >= 166;

// TODO: how can we expand these raycast functions?
const _raycastFunctions = {
	'Mesh': Mesh.prototype.raycast,
	'Line': Line.prototype.raycast,
	'LineSegments': LineSegments.prototype.raycast,
	'LineLoop': LineLoop.prototype.raycast,
	'Points': Points.prototype.raycast,
	'BatchedMesh': BatchedMesh.prototype.raycast,
};

const _mesh = /* @__PURE__ */ new Mesh();
const _batchIntersects = [];

/**
 * If the `Raycaster` member `firstHitOnly` is set to true then the `.acceleratedRaycast` function
 * will call the `.raycastFirst` function to retrieve hits which is generally faster.
 *
 * @name firstHitOnly
 * @memberof Raycaster
 * @instance
 * @type {boolean}
 * @default false
 * @group Extension Utilities
 */

/**
 * An accelerated raycast function with the same signature as `THREE.Mesh.raycast`. Uses the BVH
 * for raycasting if it's available otherwise it falls back to the built-in approach. The results
 * of the function are designed to be identical to the results of the conventional
 * `THREE.Mesh.raycast` results.
 *
 * If the raycaster object being used has a property `firstHitOnly` set to `true`, then the
 * raycasting will terminate as soon as it finds the closest intersection to the ray's origin and
 * return only that intersection. This is typically several times faster than searching for all
 * intersections.
 *
 * @group Extension Utilities
 * @param {Raycaster} raycaster
 * @param {Array<Intersection>} intersects
 * @returns {void}
 */
export function acceleratedRaycast( raycaster, intersects ) {

	if ( this.isBatchedMesh ) {

		acceleratedBatchedMeshRaycast.call( this, raycaster, intersects );

	} else {

		const { geometry } = this;
		if ( geometry.boundsTree ) {

			geometry.boundsTree.raycastObject3D( this, raycaster, intersects );

		} else {

			let raycastFunction;
			if ( this instanceof Mesh ) {

				raycastFunction = _raycastFunctions.Mesh;

			} else if ( this instanceof LineSegments ) {

				raycastFunction = _raycastFunctions.LineSegments;

			} else if ( this instanceof LineLoop ) {

				raycastFunction = _raycastFunctions.LineLoop;

			} else if ( this instanceof Line ) {

				raycastFunction = _raycastFunctions.Line;

			} else if ( this instanceof Points ) {

				raycastFunction = _raycastFunctions.Points;

			} else {

				throw new Error( 'BVH: Fallback raycast function not found.' );

			}

			raycastFunction.call( this, raycaster, intersects );

		}

	}

}

function acceleratedBatchedMeshRaycast( raycaster, intersects ) {

	if ( this.boundsTrees ) {

		// TODO: remove use of geometry info, instance info when r170 is minimum version
		const boundsTrees = this.boundsTrees;
		const drawInfo = this._drawInfo || this._instanceInfo;
		const drawRanges = this._drawRanges || this._geometryInfo;
		const matrixWorld = this.matrixWorld;

		_mesh.material = this.material;
		_mesh.geometry = this.geometry;

		const oldBoundsTree = _mesh.geometry.boundsTree;
		const oldDrawRange = _mesh.geometry.drawRange;

		if ( _mesh.geometry.boundingSphere === null ) {

			_mesh.geometry.boundingSphere = new Sphere();

		}

		// TODO: provide new method to get instances count instead of 'drawInfo.length'
		for ( let i = 0, l = drawInfo.length; i < l; i ++ ) {

			if ( ! this.getVisibleAt( i ) ) {

				continue;

			}

			// TODO: use getGeometryIndex
			const geometryId = drawInfo[ i ].geometryIndex;

			_mesh.geometry.boundsTree = boundsTrees[ geometryId ];

			this.getMatrixAt( i, _mesh.matrixWorld ).premultiply( matrixWorld );

			if ( ! _mesh.geometry.boundsTree ) {

				this.getBoundingBoxAt( geometryId, _mesh.geometry.boundingBox );
				this.getBoundingSphereAt( geometryId, _mesh.geometry.boundingSphere );

				const drawRange = drawRanges[ geometryId ];
				_mesh.geometry.setDrawRange( drawRange.start, drawRange.count );

			}

			_mesh.raycast( raycaster, _batchIntersects );

			for ( let j = 0, l = _batchIntersects.length; j < l; j ++ ) {

				const intersect = _batchIntersects[ j ];
				intersect.object = this;
				intersect.batchId = i;
				intersects.push( intersect );

			}

			_batchIntersects.length = 0;

		}

		_mesh.geometry.boundsTree = oldBoundsTree;
		_mesh.geometry.drawRange = oldDrawRange;
		_mesh.material = null;
		_mesh.geometry = null;

	} else {

		_raycastFunctions.BatchedMesh.call( this, raycaster, intersects );

	}

}

/**
 * A pre-made BufferGeometry extension function that builds a new BVH, assigns it to `boundsTree`
 * for BufferGeometry, and applies the new index buffer to the geometry. Comparable to
 * `computeBoundingBox` and `computeBoundingSphere`.
 *
 * ```js
 * THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
 * ```
 *
 * @group Extension Utilities
 * @param {Object} [options]
 * @returns {GeometryBVH}
 */
export function computeBoundsTree( options = {} ) {

	const { type = MeshBVH } = options;
	this.boundsTree = new type( this, options );
	return this.boundsTree;

}

/**
 * A BufferGeometry extension function that disposes of the BVH.
 *
 * ```js
 * THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
 * ```
 *
 * @group Extension Utilities
 * @returns {void}
 */
export function disposeBoundsTree() {

	this.boundsTree = null;

}

/**
 * Equivalent of `computeBoundsTree` for `BatchedMesh`. Creates the
 * `BatchedMesh.boundsTrees` array if it does not exist. If `index` is `-1`
 * BVHs for all available geometries are generated and the full array is
 * returned; otherwise only the BVH at that geometry index is generated and
 * returned.
 *
 * ```js
 * THREE.BatchedMesh.prototype.computeBoundsTree = computeBatchedBoundsTree;
 * ```
 *
 * @group Extension Utilities
 * @param {number} [index=-1]
 * @param {Object} [options]
 * @returns {GeometryBVH | Array<GeometryBVH> | null}
 */
export function computeBatchedBoundsTree( index = - 1, options = {} ) {

	if ( ! IS_REVISION_166 ) {

		throw new Error( 'BatchedMesh: Three r166+ is required to compute bounds trees.' );

	}

	options = {
		...options,
		range: null
	};

	const drawRanges = this._drawRanges || this._geometryInfo;
	const geometryCount = this._geometryCount;
	if ( ! this.boundsTrees ) {

		this.boundsTrees = new Array( geometryCount ).fill( null );

	}

	const boundsTrees = this.boundsTrees;
	while ( boundsTrees.length < geometryCount ) {

		boundsTrees.push( null );

	}

	if ( index < 0 ) {

		for ( let i = 0; i < geometryCount; i ++ ) {

			options.range = drawRanges[ i ];
			boundsTrees[ i ] = new MeshBVH( this.geometry, options );

		}

		return boundsTrees;

	} else {

		if ( index < drawRanges.length ) {

			options.range = drawRanges[ index ];
			boundsTrees[ index ] = new MeshBVH( this.geometry, options );

		}

		return boundsTrees[ index ] || null;

	}

}

/**
 * Equivalent of `disposeBoundsTree` for `BatchedMesh`. Sets entries in
 * `BatchedMesh.boundsTrees` to `null`. If `index` is `-1` all BVHs are
 * disposed; otherwise only the BVH at that geometry index is disposed.
 *
 * ```js
 * THREE.BatchedMesh.prototype.disposeBoundsTree = disposeBatchedBoundsTree;
 * ```
 *
 * @group Extension Utilities
 * @param {number} [index=-1]
 * @returns {void}
 */
export function disposeBatchedBoundsTree( index = - 1 ) {

	if ( index < 0 ) {

		this.boundsTrees.fill( null );

	} else {

		if ( index < this.boundsTrees.length ) {

			this.boundsTrees[ index ] = null;

		}

	}

}
