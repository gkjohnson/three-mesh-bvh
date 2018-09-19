
import * as THREE from '../node_modules/three/build/three.module.js';
import { intersectTris, intersectClosestTri } from './GeometryUtilities.js';

const intersectvec = new THREE.Vector3();

export default
class MeshBVHNode {

	constructor() {

		this.boundingBox = null;
		this.boundingSphere = null;
		this.tris = null;
		this.children = [];

	}

	static intersectsRay( node, ray ) {

		return ray.intersectsSphere( node.boundingSphere ) && ray.intersectsBox( node.boundingBox );

	}

	static raycast( node, mesh, geometry, raycaster, ray, intersects, seenFaces ) {

		if ( ! this.intersectsRay( node, ray ) ) return;

		if ( node.tris ) intersectTris( mesh, geometry, raycaster, ray, node.tris, intersects, seenFaces );
		else node.children.forEach( c => this.raycast( c, mesh, geometry, raycaster, ray, intersects, seenFaces ) );

	}

	static raycastFirst( node, mesh, geometry, raycaster, ray ) {

		if ( ! this.intersectsRay( node, ray ) ) return null;

		if ( node.tris ) {

			return intersectClosestTri( mesh, geometry, raycaster, ray, node.tris );

		} else {

			const c1 = node.children[ 0 ];
			intersectvec.subVectors( c1.boundingSphere.center, ray.origin );
			const c1dist = intersectvec.length() * intersectvec.dot( ray.direction );

			const c2 = node.children[ 1 ];
			intersectvec.subVectors( c2.boundingSphere.center, ray.origin );
			const c2dist = intersectvec.length() * intersectvec.dot( ray.direction );

			return c1dist < c2dist
				? this.raycastFirst( c1, mesh, geometry, raycaster, ray ) || this.raycastFirst( c2, mesh, geometry, raycaster, ray )
				: this.raycastFirst( c2, mesh, geometry, raycaster, ray ) || this.raycastFirst( c1, mesh, geometry, raycaster, ray );

		}

	}

}
