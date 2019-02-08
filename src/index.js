import * as THREE from 'three';
import MeshBVH from './MeshBVH.js';
import Visualizer from './MeshBVHVisualizer.js';
import { CENTER, AVERAGE, SAH } from './Constants.js';

const ray = new THREE.Ray();
const tmpInverseMatrix = new THREE.Matrix4();
const origMeshRaycastFunc = THREE.Mesh.prototype.raycast;

function acceleratedRaycast( raycaster, intersects ) {

	if ( this.geometry.boundsTree ) {

		if ( this.material === undefined ) return;

		tmpInverseMatrix.getInverse( this.matrixWorld );
		ray.copy( raycaster.ray ).applyMatrix4( tmpInverseMatrix );

		if ( raycaster.firstHitOnly === true ) {

			const res = this.geometry.boundsTree._roots[0].raycastFirst( this, raycaster, ray );
			if ( res ) intersects.push( res );

		} else {

			this.geometry.boundsTree._roots[0].raycast( this, raycaster, ray, intersects );

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
	CENTER, AVERAGE, SAH
};
