import { Ray, Matrix4, Mesh } from 'three';
import MeshBVH from './MeshBVH.js';
import Visualizer from './MeshBVHVisualizer.js';
import { CENTER, AVERAGE, SAH } from './Constants.js';
import { getBVHExtremes, estimateMemoryInBytes } from './Utils/Debug.js';

const ray = new Ray();
const tmpInverseMatrix = new Matrix4();
const origMeshRaycastFunc = Mesh.prototype.raycast;

function acceleratedRaycast( raycaster, intersects ) {

	if ( this.geometry.boundsTree ) {

		if ( this.material === undefined ) return;

		tmpInverseMatrix.copy( this.matrixWorld ).invert();
		ray.copy( raycaster.ray ).applyMatrix4( tmpInverseMatrix );

		if ( raycaster.firstHitOnly === true ) {

			const res = this.geometry.boundsTree.raycastFirst( this, raycaster, ray );
			if ( res ) intersects.push( res );

		} else {

			this.geometry.boundsTree.raycast( this, raycaster, ray, intersects );

		}

	} else {

		origMeshRaycastFunc.call( this, raycaster, intersects );

	}

}

function computeBoundsTree( options ) {

	this.boundsTree = new MeshBVH( this, options );
	return this.boundsTree;

}

function disposeBoundsTree() {

	this.boundsTree = null;

}

export {
	MeshBVH, Visualizer,
	acceleratedRaycast, computeBoundsTree, disposeBoundsTree,
	CENTER, AVERAGE, SAH,
	estimateMemoryInBytes, getBVHExtremes
};
