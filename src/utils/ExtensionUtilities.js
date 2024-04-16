import { Ray, Matrix4, Mesh, Vector3 } from 'three';
import { convertRaycastIntersect } from './GeometryRayIntersectUtilities.js';
import { MeshBVH } from '../core/MeshBVH.js';

const ray = /* @__PURE__ */ new Ray();
const direction = /* @__PURE__ */ new Vector3();
const tmpInverseMatrix = /* @__PURE__ */ new Matrix4();
const worldScale = /* @__PURE__ */ new Vector3();
const origMeshRaycastFunc = Mesh.prototype.raycast;

export function acceleratedRaycast( raycaster, intersects ) {

	if ( this.geometry.boundsTree ) {

		if ( this.material === undefined ) return;

		tmpInverseMatrix.copy( this.matrixWorld ).invert();
		ray.copy( raycaster.ray ).applyMatrix4( tmpInverseMatrix );

		this.getWorldScale( worldScale );
		direction.copy( ray.direction ).multiply( worldScale );

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

export function disposeBoundsTree() {

	this.boundsTree = null;

}
