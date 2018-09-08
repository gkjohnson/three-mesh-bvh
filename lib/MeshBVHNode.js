
import * as THREE from '../node_modules/three/build/three.module.js';
import { intersectTris, intersectClosestTri } from './GeometryUtilities.js';

const intersectvec = new THREE.Vector3();

export default
class MeshBVHNode {

	constructor() {

		this.boundingBox = null;
		this.boundingSphere = null;
		this.geometry = null;
		this.tris = null;
		this.children = [];

	}

	intersectsRay( ray ) {

		return ( ray.intersectsSphere( this.boundingSphere ) || this.boundingSphere.containsPoint( ray.origin ) ) &&
			( ray.intersectsBox( this.boundingBox ) || this.boundingBox.containsPoint( ray.origin ) );

	}

	raycast( mesh, raycaster, ray, intersects, seenFaces ) {

		if ( ! this.intersectsRay( ray ) ) return;

		if ( this.tris ) intersectTris( mesh, this.geometry, raycaster, ray, this.tris, intersects, seenFaces );
		else this.children.forEach( c => c.raycast( mesh, raycaster, ray, intersects, seenFaces ) );

	}

	raycastFirst( mesh, raycaster, ray ) {

		if ( ! this.intersectsRay( ray ) ) return null;

		if ( this.tris ) {

			return intersectClosestTri( mesh, this.geometry, raycaster, ray, this.tris );

		} else {

			const c1 = this.children[ 0 ];
			intersectvec.subVectors( c1.boundingSphere.center, ray.origin );
			const c1dist = intersectvec.length() * intersectvec.dot( ray.direction );

			const c2 = this.children[ 1 ];
			intersectvec.subVectors( c2.boundingSphere.center, ray.origin );
			const c2dist = intersectvec.length() * intersectvec.dot( ray.direction );

			return c1dist < c2dist
				? c1.raycastFirst( mesh, raycaster, ray ) || c2.raycastFirst( mesh, raycaster, ray )
				: c2.raycastFirst( mesh, raycaster, ray ) || c1.raycastFirst( mesh, raycaster, ray );

		}

	}

}
