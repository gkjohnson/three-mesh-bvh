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

export function computeBoundsTree( options = {} ) {

	const { type = MeshBVH } = options;
	this.boundsTree = new type( this, options );
	return this.boundsTree;

}

export function disposeBoundsTree() {

	this.boundsTree = null;

}

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

export function disposeBatchedBoundsTree( index = - 1 ) {

	if ( index < 0 ) {

		this.boundsTrees.fill( null );

	} else {

		if ( index < this.boundsTrees.length ) {

			this.boundsTrees[ index ] = null;

		}

	}

}
