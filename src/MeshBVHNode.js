
import * as THREE from 'three';
import { intersectTris, intersectClosestTri } from './GeometryUtilities.js';
import { arrayToBox } from './BoundsUtilities.js';

const boundingBox = new THREE.Box3();
const boxIntersection = new THREE.Vector3();
const xyzFields = [ 'x', 'y', 'z' ];

function boundsArrayIntersectRay( boundingData, ray ) {

	arrayToBox( boundingData, boundingBox );

	return ray.intersectBox( boundingBox, boxIntersection );

}

export default
class MeshBVHNode {

	constructor() {

		// internal nodes have boundingData, children, and splitAxis
		// leaf nodes have offset and count (referring to primitives in the mesh geometry)

	}

	raycast( mesh, raycaster, ray, intersects ) {

		if ( this.count ) intersectTris( mesh, mesh.geometry, raycaster, ray, this.offset, this.count, intersects );
		else this.children.forEach( c => {

			if ( boundsArrayIntersectRay( c.boundingData, ray ) )
				c.raycast( mesh, raycaster, ray, intersects );

		} );

	}

	raycastFirst( mesh, raycaster, ray ) {

		if ( this.count ) {

			return intersectClosestTri( mesh, mesh.geometry, raycaster, ray, this.offset, this.count );

		} else {


			// consider the position of the split plane with respect to the oncoming ray; whichever direction
			// the ray is coming from, look for an intersection among that side of the tree first
			const children = this.children;
			const splitAxis = this.splitAxis;
			const xyzAxis = xyzFields[ splitAxis ];
			const rayDir = ray.direction[ xyzAxis ];
			const leftToRight = rayDir >= 0;

			// c1 is the child to check first
			let c1, c2;
			if ( leftToRight ) {

				c1 = children[ 0 ];
				c2 = children[ 1 ];

			} else {

				c1 = children[ 1 ];
				c2 = children[ 0 ];

			}

			const c1Intersection = boundsArrayIntersectRay( c1.boundingData, ray );
			const c1Result = c1Intersection ? c1.raycastFirst( mesh, raycaster, ray ) : null;

			// if we got an intersection in the first node and it's closer than the second node's bounding
			// box, we don't need to consider the second node because it couldn't possibly be a better result
			if ( c1Result ) {

				// check only along the split axis
				const rayOrig = ray.origin[ xyzAxis ];
				const toPoint = rayOrig - c1Result.point[ xyzAxis ];
				const toChild1 = rayOrig - c2.boundingData[ splitAxis ];
				const toChild2 = rayOrig - c2.boundingData[ splitAxis + 3 ];

				const toPointSq = toPoint * toPoint;
				if ( toPointSq <= toChild1 * toChild1 && toPointSq <= toChild2 * toChild2 ) {

					return c1Result;

				}

			}

			// either there was no intersection in the first node, or there could still be a closer
			// intersection in the second, so check the second node and then take the better of the two
			const c2Intersection = boundsArrayIntersectRay( c2.boundingData, ray );
			const c2Result = c2Intersection ? c2.raycastFirst( mesh, raycaster, ray ) : null;

			if ( c1Result && c2Result ) {

				return c1Result.distance <= c2Result.distance ? c1Result : c2Result;

			} else {

				return c1Result || c2Result || null;

			}

		}

	}

}
