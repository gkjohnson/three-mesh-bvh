import { Ray, Matrix4, Mesh, Vector3 } from 'three';
import { convertRaycastIntersect } from './GeometryRayIntersectUtilities.js';
import { MeshBVH } from '../core/MeshBVH.js';

const ray = /* @__PURE__ */ new Ray();
const direction = /* @__PURE__ */ new Vector3();
const tmpInverseMatrix = /* @__PURE__ */ new Matrix4();
const worldScale = /* @__PURE__ */ new Vector3();
const tmpVec3 = /* @__PURE__ */ new Vector3();
const origMeshRaycastFunc = Mesh.prototype.raycast;

export function acceleratedRaycast( raycaster, intersects ) {

	if ( this.geometry.boundsTree ) {

		if ( this.material === undefined ) return;

		tmpInverseMatrix.copy( this.matrixWorld ).invert();
		ray.copy( raycaster.ray ).applyMatrix4( tmpInverseMatrix );

		getWorldScale( this.matrixWorld, worldScale );
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

/** https://github.com/mrdoob/three.js/blob/dev/src/math/Matrix4.js#L732 */
function getWorldScale( matrixWorld, target ) {

	const te = matrixWorld.elements;

	const sx = tmpVec3.set( te[ 0 ], te[ 1 ], te[ 2 ] ).length();
	const sy = tmpVec3.set( te[ 4 ], te[ 5 ], te[ 6 ] ).length();
	const sz = tmpVec3.set( te[ 8 ], te[ 9 ], te[ 10 ] ).length();

	// // if determine is negative, we need to invert one scale
	// const det = matrixWorld.determinant();
	// if ( det < 0 ) sx = - sx;
	// we don't need this.

	target.set( sx, sy, sz );

}
