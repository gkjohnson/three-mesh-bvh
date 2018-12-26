
import * as THREE from 'three';
import { intersectTris, intersectClosestTri } from './GeometryUtilities.js';
import { arrayToBox, sphereItersectTriangle, boxToObbPlanes, boxToObbPoints, boxIntersectsObb } from './BoundsUtilities.js';

const triangle = new THREE.Triangle();
const pointsCache = new Array( 8 ).fill().map( () => new THREE.Vector3() );
const planesCache = new Array( 6 ).fill().map( () => new THREE.Plane() );
const inverseCache = new THREE.Matrix4();
const boundingBox = new THREE.Box3();
const boxIntersection = new THREE.Vector3();
const xyzFields = [ 'x', 'y', 'z' ];

function setTriangle(tri, i, index, pos) {

	const ta = tri.a;
	const tb = tri.b;
	const tc = tri.c;

	let i3 = index.getX( i );
	ta.x = pos.getX( i3 );
	ta.y = pos.getY( i3 );
	ta.z = pos.getZ( i3 );

	i3 = index.getX( i + 1 );
	tb.x = pos.getX( i3 );
	tb.y = pos.getY( i3 );
	tb.z = pos.getZ( i3 );

	i3 = index.getX( i + 2 );
	tc.x = pos.getX( i3 );
	tc.y = pos.getY( i3 );
	tc.z = pos.getZ( i3 );

}

function boundsArrayIntersectRay( boundingData, ray ) {

	arrayToBox( boundingData, boundingBox );
	return ray.intersectBox( boundingBox, boxIntersection );

}

function boundsArrayIntersectSphere( boundingData, sphere ) {

	arrayToBox( boundingData, boundingBox );
	return boundingBox.intersectsSphere( sphere );

}

function boundsArrayIntersectBox( boundingData, obbPlanes, obbPoints ) {

	arrayToBox( boundingData, boundingBox );
	return boxIntersectsObb( boundingBox, obbPlanes, obbPoints );

}

export default
class MeshBVHNode {

	constructor() {

		// internal nodes have boundingData, children, and splitAxis
		// leaf nodes have offset and count (referring to primitives in the mesh geometry)

	}

	spherecast( mesh, sphere ) {

		if ( boundsArrayIntersectSphere( this.boundingData, sphere ) ) return false;

		if ( this.count ) {

			const index = mesh.index;
			const pos = mesh.attributes.position;

			for ( let i = 0, l = this.count; i < l; i += 3 ) {

				setTriangle(triangle, i, index, pos);

				if ( sphereItersectTriangle( sphere, triangle ) ) {

					return true;

				}

			}

			return false;


		} else {

			const c1 = this.children[ 0 ];
			const c2 = this.children[ 1 ];

			return c1.spherecast( mesh, sphere ) || c2.spherecast( mesh, sphere );

		}

	}

	boxcast( mesh, box, boxToLocal ) {

		if ( boxToLocal ) {

			boxToObbPlanes( box, boxToLocal, planesCache );
			boxToObbPoints( box, boxToLocal, pointsCache );
			inverseCache.getInverse( boxToLocal );

		}

		if ( boundsArrayIntersectBox( this.boundingData, planesCache, pointsCache ) ) return false;

		if ( this.count ) {

			const index = mesh.index;
			const pos = mesh.attributes.position;

			for ( let i = 0, l = this.count; i < l; i += 3 ) {

				setTriangle(triangle, i, index, pos);
				triangle.a.applyMatrix4( inverseCache );
				triangle.b.applyMatrix4( inverseCache );
				triangle.c.applyMatrix4( inverseCache );

				if ( box.intersectTriangle( triangle ) ) {

					return true;

				}

			}

			return false;


		} else {

			const c1 = this.children[ 0 ];
			const c2 = this.children[ 1 ];

			return c1.boxcast( mesh, box ) || c2.boxcast( mesh, box );

		}

	}

	meshcast( mesh, otherMesh, meshToLocal ) {

		// cache intersection of each bvh node to avoid recomputing the planes and points
		// drill down both bvh trees

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
