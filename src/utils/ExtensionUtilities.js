import { Ray, Matrix4, Mesh, Vector3, BatchedMesh } from 'three';
import { convertRaycastIntersect } from './GeometryRayIntersectUtilities.js';
import { MeshBVH } from '../core/MeshBVH.js';

const ray = /* @__PURE__ */ new Ray();
const direction = /* @__PURE__ */ new Vector3();
const tmpInverseMatrix = /* @__PURE__ */ new Matrix4();
const origMeshRaycastFunc = Mesh.prototype.raycast;
const origBatchedRaycastFunc = BatchedMesh.prototype.raycast;
const _worldScale = /* @__PURE__ */ new Vector3();
const _mesh = /* @__PURE__ */ new Mesh();
const _batchIntersects = [];

export function acceleratedRaycast( raycaster, intersects ) {

	if ( this.isBatchedMesh ) {

		acceleratedBatchedMeshRaycast.call( this, raycaster, intersects );

	} else {

		acceleratedMeshRaycast.call( this, raycaster, intersects );

	}

}

function acceleratedBatchedMeshRaycast( raycaster, intersects ) {

	if ( this.batchedBoundsTree ) {

		const batchedBoundsTree = this.batchedBoundsTree;
		const drawInfo = this._drawInfo;
		const drawRanges = this._drawRanges;
		const matrixWorld = this.matrixWorld;

		_mesh.material = this.material;
		_mesh.geometry = this.geometry;

		const oldBoundsTree = _mesh.geometry.boundsTree;
		const oldDrawRange = _mesh.geometry.drawRange;

		for ( let i = 0, l = drawInfo.length; i < l; i ++ ) {

			if ( ! drawInfo[ i ].visible || ! drawInfo[ i ].active ) {

				continue;

			}

			const geometryId = drawInfo[ i ].geometryIndex;

			_mesh.geometry.boundsTree = batchedBoundsTree[ geometryId ];

			this.getMatrixAt( i, _mesh.matrixWorld ).premultiply( matrixWorld );

			if ( ! _mesh.geometry.boundsTree ) {

				this.getBoundingBoxAt( geometryId, _mesh.geometry.boundingBox ); // I'm curios, do we actually need this?
				this.getBoundingSphereAt( geometryId, _mesh.geometry.boundingSphere );

				const drawRange = drawRanges[ geometryId ];
				_mesh.geometry.setDrawRange( drawRange.start, drawRange.count );

			}

			_mesh.raycast( raycaster, _batchIntersects );
			// acceleratedMeshRaycast.call( mesh, raycaster, _batchIntersects ); OR

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

		origBatchedRaycastFunc.call( this, raycaster, intersects );

	}

}

function acceleratedMeshRaycast( raycaster, intersects ) {

	if ( this.geometry.boundsTree ) {

		if ( this.material === undefined ) return;

		tmpInverseMatrix.copy( this.matrixWorld ).invert();
		ray.copy( raycaster.ray ).applyMatrix4( tmpInverseMatrix );

		extractMatrixScale( this.matrixWorld, _worldScale );
		direction.copy( ray.direction ).multiply( _worldScale );

		const scaleFactor = direction.length();
		const near = raycaster.near / scaleFactor;
		const far = raycaster.far / scaleFactor;

		const bvh = this.geometry.boundsTree;
		if ( raycaster.firstHitOnly === true ) {

			const hit = convertRaycastIntersect( bvh.raycastFirst( ray, this.material, near, far ), this, raycaster );
			if ( hit ) {

				intersects.push( hit );

			}

		} else {

			const hits = bvh.raycast( ray, this.material, near, far );
			for ( let i = 0, l = hits.length; i < l; i ++ ) {

				const hit = convertRaycastIntersect( hits[ i ], this, raycaster );
				if ( hit ) {

					intersects.push( hit );

				}

			}

		}

	} else {

		origMeshRaycastFunc.call( this, raycaster, intersects );

	}

}

export function computeBoundsTree( options ) {

	this.boundsTree = new MeshBVH( this, options );
	return this.boundsTree;

}

export function computeBatchedBoundsTree( options ) {

	if ( ! this.geometry ) throw new Error( "geometry is missing" ); // TODO better mesage

	if ( ! options ) options = {};

	// ignore 'indirect' and 'range' from options?
	// add offset when recostruction
	// this may change if BatchedMesh.deleteGeometry will be implemented

	options.indirect = false;

	// three r166+

	const drawRanges = this._drawRanges;
	const geometryCount = this._geometryCount;
	const boundsTrees = [];

	for ( let i = 0; i < geometryCount; i ++ ) {

		options.range = drawRanges[ i ];
		boundsTrees[ i ] = new MeshBVH( this.geometry, options );

	}

	this.batchedBoundsTree = boundsTrees;
	return this.batchedBoundsTree;

}

export function disposeBoundsTree() {

	this.boundsTree = null;

}

export function disposeBatchedBoundsTree() {

	this.batchedBoundsTree = null;

}

// https://github.com/mrdoob/three.js/blob/dev/src/math/Matrix4.js#L732
// extracting the scale directly is ~3x faster than using "decompose"
function extractMatrixScale( matrix, target ) {

	const te = matrix.elements;
	const sx = target.set( te[ 0 ], te[ 1 ], te[ 2 ] ).length();
	const sy = target.set( te[ 4 ], te[ 5 ], te[ 6 ] ).length();
	const sz = target.set( te[ 8 ], te[ 9 ], te[ 10 ] ).length();
	return target.set( sx, sy, sz );

}
