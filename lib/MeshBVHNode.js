
import * as THREE from '../node_modules/three/build/three.module.js';
import { intersectTris, intersectClosestTri } from './GeometryUtilities.js';
import { arrayToSphere, arrayToBox } from './BoundsUtilities.js';

const intersectvec = new THREE.Vector3();
const boundingBox = new THREE.Box3();
const boundingSphere = new THREE.Sphere();

export default
class MeshBVHNode {

	constructor() {

		this.boundingData = null;
		this.geometry = null;
		this.tris = null;
		this.children = null;

	}

	intersectsRay( ray ) {

		arrayToSphere( this.boundingData, boundingSphere );

		if ( ! ray.intersectsSphere( boundingSphere ) ) return false;

		arrayToBox( this.boundingData, boundingBox );

		return ray.intersectsBox( boundingBox );

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
			arrayToSphere( c1.boundingData, boundingSphere );
			intersectvec.subVectors( boundingSphere.center, ray.origin );
			const c1dist = intersectvec.length() * intersectvec.dot( ray.direction );

			const c2 = this.children[ 1 ];
			arrayToSphere( c2.boundingData, boundingSphere );
			intersectvec.subVectors( boundingSphere.center, ray.origin );
			const c2dist = intersectvec.length() * intersectvec.dot( ray.direction );

			return c1dist < c2dist
				? c1.raycastFirst( mesh, raycaster, ray ) || c2.raycastFirst( mesh, raycaster, ray )
				: c2.raycastFirst( mesh, raycaster, ray ) || c1.raycastFirst( mesh, raycaster, ray );

		}

	}

}
