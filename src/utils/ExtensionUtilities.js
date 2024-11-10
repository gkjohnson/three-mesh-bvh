import { Ray, Matrix4, Mesh, Vector3, Sphere, BatchedMesh, REVISION } from 'three';
import { convertRaycastIntersect } from './GeometryRayIntersectUtilities.js';
import { MeshBVH } from '../core/MeshBVH.js';

const IS_REVISION_166 = parseInt( REVISION ) >= 166;
const IS_REVISION_170 = parseInt( REVISION ) >= 170;
const ray = /* @__PURE__ */ new Ray();
const direction = /* @__PURE__ */ new Vector3();
const tmpInverseMatrix = /* @__PURE__ */ new Matrix4();
const origMeshRaycastFunc = Mesh.prototype.raycast;
const origBatchedRaycastFunc = BatchedMesh.prototype.raycast;
const _worldScale = /* @__PURE__ */ new Vector3();
const _mesh = /* @__PURE__ */ new Mesh();
const _batchIntersects = [];
const _drawRangeInfo = {};

function getGeometryIndex( batchedMesh, index ) {

	if ( IS_REVISION_170 ) {

		return batchedMesh.getGeometryIdAt( index );

	} else {

		return batchedMesh.drawInfo[ index ].geometryIndex;

	}

}

function getInstanceCount( batchedMesh ) {

	if ( IS_REVISION_170 ) {

		return batchedMesh.instanceCount;

	} else {

		return batchedMesh._drawInfo.length;

	}

}

function getDrawRange( batchedMesh, index, target ) {

	if ( IS_REVISION_170 ) {

		try {

			Object.assign( target, batchedMesh.getGeometryRangeAt( index, target ) );

		} catch {

			return null;

		}

	} else if ( index < batchedMesh._drawRanges.length ) {

		Object.assign( target, batchedMesh._drawRanges[ index ] );

	}

}

export function acceleratedRaycast( raycaster, intersects ) {

	if ( this.isBatchedMesh ) {

		acceleratedBatchedMeshRaycast.call( this, raycaster, intersects );

	} else {

		acceleratedMeshRaycast.call( this, raycaster, intersects );

	}

}

function acceleratedBatchedMeshRaycast( raycaster, intersects ) {

	if ( this.boundsTrees ) {

		const boundsTrees = this.boundsTrees;
		const matrixWorld = this.matrixWorld;

		_mesh.material = this.material;
		_mesh.geometry = this.geometry;

		const oldBoundsTree = _mesh.geometry.boundsTree;
		const oldDrawRange = _mesh.geometry.drawRange;

		if ( _mesh.geometry.boundingSphere === null ) {

			_mesh.geometry.boundingSphere = new Sphere();

		}

		for ( let i = 0, l = getInstanceCount( this ); i < l; i ++ ) {

			// check instance visibility
			let isVisible = false;
			try {

				isVisible = this.getVisibleAt( i );

			} catch {

				isVisible = false;

			}

			if ( ! isVisible ) {

				continue;

			}

			const geometryId = getGeometryIndex( i );
			_mesh.geometry.boundsTree = boundsTrees[ geometryId ];

			this.getMatrixAt( i, _mesh.matrixWorld ).premultiply( matrixWorld );

			if ( ! _mesh.geometry.boundsTree ) {

				this.getBoundingBoxAt( geometryId, _mesh.geometry.boundingBox );
				this.getBoundingSphereAt( geometryId, _mesh.geometry.boundingSphere );

				const drawRange = getDrawRange( this, geometryId, _drawRangeInfo );
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

		origBatchedRaycastFunc.call( this, raycaster, intersects );

	}

}

function acceleratedMeshRaycast( raycaster, intersects ) {

	if ( this.geometry.boundsTree ) {

		if ( this.material === undefined ) return;

		tmpInverseMatrix.copy( this.matrixWorld ).invert();
		ray.copy( raycaster.ray ).applyMatrix4( tmpInverseMatrix );

		_worldScale.setFromMatrixScale( this.matrixWorld );
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

export function computeBoundsTree( options = {} ) {

	this.boundsTree = new MeshBVH( this, options );
	return this.boundsTree;

}

export function disposeBoundsTree() {

	this.boundsTree = null;

}

export function computeBatchedBoundsTree( index = - 1, options = {} ) {

	if ( ! IS_REVISION_166 ) {

		throw new Error( 'BatchedMesh: Three r166+ is required to compute bounds trees.' );

	}

	if ( options.indirect ) {

		console.warn( '"Indirect" is set to false because it is not supported for BatchedMesh.' );

	}

	options = {
		...options,
		indirect: false,
		range: null
	};

	const drawRanges = this._drawRanges;
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

			options.range = getDrawRange( this, i, _drawRangeInfo );
			if ( options.range !== null ) {

				boundsTrees[ i ] = new MeshBVH( this.geometry, options );

			} else {

				boundsTrees[ i ] = null;

			}

		}

		return boundsTrees;

	} else {

		options.range = getDrawRange( this, index, _drawRangeInfo );
		if ( options.range !== null ) {

			boundsTrees[ index ] = new MeshBVH( this.geometry, options );

		} else {

			boundsTrees[ index ] = null;

		}

		return boundsTrees[ index ] || null;

	}

}

export function disposeBatchedBoundsTree( index = - 1 ) {

	if ( index < 0 ) {

		this.boundsTrees.fill( null );

	} else {

		if ( index < this.boundsTree.length ) {

			this.boundsTrees[ index ] = null;

		}

	}

}
