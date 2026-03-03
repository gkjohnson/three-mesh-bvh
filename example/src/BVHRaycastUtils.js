import { SkinnedMesh } from 'three';

const _raycast = SkinnedMesh.prototype.raycast;
export const skinnedMeshAcceleratedRaycast = function ( raycaster, intersects ) {

	if ( this.boundsTree ) {

		this.boundsTree.raycastObject3D( this, raycaster, intersects );

	} else {

		_raycast.call( this, raycaster, intersects );

	}

};

// TODO: account for a "custom" object? Not necessary here? Create a more abstract foundation for this case?
export function objectAcceleratedRaycast( raycaster, intersects ) {

	if ( this.boundsTree ) {

		this.boundsTree.raycast( raycaster, intersects );
		return false;

	}

}
