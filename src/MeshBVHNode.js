
import * as THREE from 'three';
import { intersectTris, intersectClosestTri } from './GeometryUtilities.js';
import { arrayToBox, sphereIntersectTriangle, boxIntersectsTriangle, boxToObbPoints, boxToObbPlanes, boxIntersectsObb, triangleIntersectsTriangle } from './BoundsUtilities.js';

const triangle = new THREE.Triangle();
const triangle2 = new THREE.Triangle();
const pointsCache = new Array( 8 ).fill().map( () => new THREE.Vector3() );
const planesCache = new Array( 6 ).fill().map( () => new THREE.Plane() );
const boundingBox = new THREE.Box3();
const boxIntersection = new THREE.Vector3();
const xyzFields = [ 'x', 'y', 'z' ];
const invertedMat = new THREE.Matrix4();

function setTriangle( tri, i, index, pos ) {

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

		// internal nodes have boundingData, left, right, and splitAxis
		// leaf nodes have offset and count (referring to primitives in the mesh geometry)

	}

	intersectRay( ray, target ) {

		arrayToBox( this.boundingData, boundingBox );

		return ray.intersectBox( boundingBox, target );

	}

	geometrycast( mesh, geometry, geometryToBvh, cachedObbPoints = null, cachedObbPlanes = null ) {

		if ( cachedObbPlanes === null ) {

			if ( ! geometry.boundingBox ) {

				geometry.computeBoundingBox();

			}

			cachedObbPoints = cachedObbPoints || boxToObbPoints( geometry.boundingBox, geometryToBvh, pointsCache );
			cachedObbPlanes = cachedObbPlanes || boxToObbPlanes( geometry.boundingBox, geometryToBvh, planesCache );

		}

		if ( this.count ) {

			const thisGeometry = mesh.geometry;
			const thisIndex = thisGeometry.index;
			const thisPos = thisGeometry.attributes.position;

			const index = geometry.index;
			const pos = geometry.attributes.position;

			const offset = this.offset;
			const count = this.count;

			// get the inverse of the geometry matrix so we can transform our triangles into the
			// geometry space we're trying to test. We assume there are fewer triangles being checked
			// here.
			invertedMat.getInverse( geometryToBvh );

			// TODO: if the geometry has a BVH here we can possibly just perform a box cast here
			// with this bounding data to do an early out / collect candidate triangles before checking
			if (
				geometry.boundsTree &&
				! geometry.boundsTree.boxcast( new THREE.Mesh( geometry ), arrayToBox( this.boundingData, new THREE.Box3() ), invertedMat ) ) {

				return false;

			}

			for ( let i = offset * 3, l = ( count + offset * 3 ); i < l; i += 3 ) {

				// this triangle needs to be transformed into the current BVH coordinate frame
				setTriangle( triangle, i, thisIndex, thisPos );
				triangle.a.applyMatrix4( invertedMat );
				triangle.b.applyMatrix4( invertedMat );
				triangle.c.applyMatrix4( invertedMat );

				for ( let i2 = 0, l2 = index.count; i2 < l2; i2 ++ ) {

					setTriangle( triangle2, i2, index, pos );

					if ( triangleIntersectsTriangle( triangle, triangle2 ) ) {

						return true;

					}

				}

			}

		} else {

			const left = this.left;
			const right = this.right;

			const leftIntersection =
				boundsArrayIntersectBox( left.boundingData, cachedObbPlanes, cachedObbPoints ) &&
				left.geometrycast( mesh, geometry, geometryToBvh, cachedObbPoints, cachedObbPlanes );

			if ( leftIntersection ) return true;

			const rightIntersection =
				boundsArrayIntersectBox( right.boundingData, cachedObbPlanes, cachedObbPoints ) &&
				right.geometrycast( mesh, geometry, geometryToBvh, cachedObbPoints, cachedObbPlanes );

			if ( rightIntersection ) return true;

			return false;

		}

	}

	boxcast( mesh, box, boxToBvh, cachedObbPoints = null, cachedObbPlanes = null ) {

		if ( cachedObbPlanes === null ) {

			cachedObbPoints = cachedObbPoints || boxToObbPoints( box, boxToBvh, pointsCache );
			cachedObbPlanes = cachedObbPlanes || boxToObbPlanes( box, boxToBvh, planesCache );

		}

		if ( this.count ) {

			const geometry = mesh.geometry;
			const index = geometry.index;
			const pos = geometry.attributes.position;
			const offset = this.offset;
			const count = this.count;

			for ( let i = offset * 3, l = ( count + offset * 3 ); i < l; i += 3 ) {

				setTriangle( triangle, i, index, pos );

				if ( boxIntersectsTriangle( cachedObbPlanes, cachedObbPoints, triangle ) ) {

					return true;

				}

			}

		} else {

			const left = this.left;
			const right = this.right;

			const leftIntersection =
				boundsArrayIntersectBox( left.boundingData, cachedObbPlanes, cachedObbPoints ) &&
				left.boxcast( mesh, box, boxToBvh, cachedObbPoints, cachedObbPlanes );

			if ( leftIntersection ) return true;

			const rightIntersection =
				boundsArrayIntersectBox( right.boundingData, cachedObbPlanes, cachedObbPoints ) &&
				right.boxcast( mesh, box, boxToBvh, cachedObbPoints, cachedObbPlanes );

			if ( rightIntersection ) return true;

			return false;

		}

	}

	spherecast( mesh, sphere ) {

		if ( this.count ) {

			const geometry = mesh.geometry;
			const index = geometry.index;
			const pos = geometry.attributes.position;
			const offset = this.offset;
			const count = this.count;

			for ( let i = offset * 3, l = ( count + offset * 3 ); i < l; i += 3 ) {

				setTriangle( triangle, i, index, pos );

				if ( sphereIntersectTriangle( sphere, triangle ) ) {

					return true;

				}

			}

			return false;


		} else {

			// TODO: consider an option to return all the intersected triangles
			const left = this.left;
			const right = this.right;

			const leftIntersection = boundsArrayIntersectSphere( left.boundingData, sphere ) && left.spherecast( mesh, sphere );
			if ( leftIntersection ) return true;

			const rightIntersection = boundsArrayIntersectSphere( right.boundingData, sphere ) && right.spherecast( mesh, sphere );
			if ( rightIntersection ) return true;

			return false;

		}

	}

	raycast( mesh, raycaster, ray, intersects ) {

		if ( this.count ) intersectTris( mesh, mesh.geometry, raycaster, ray, this.offset, this.count, intersects );
		else {

			if ( this.left.intersectRay( ray, boxIntersection ) )
				this.left.raycast( mesh, raycaster, ray, intersects );
			if ( this.right.intersectRay( ray, boxIntersection ) )
				this.right.raycast( mesh, raycaster, ray, intersects );

		}

	}

	raycastFirst( mesh, raycaster, ray ) {

		if ( this.count ) {

			return intersectClosestTri( mesh, mesh.geometry, raycaster, ray, this.offset, this.count );

		} else {


			// consider the position of the split plane with respect to the oncoming ray; whichever direction
			// the ray is coming from, look for an intersection among that side of the tree first
			const splitAxis = this.splitAxis;
			const xyzAxis = xyzFields[ splitAxis ];
			const rayDir = ray.direction[ xyzAxis ];
			const leftToRight = rayDir >= 0;

			// c1 is the child to check first
			let c1, c2;
			if ( leftToRight ) {

				c1 = this.left;
				c2 = this.right;

			} else {

				c1 = this.right;
				c2 = this.left;

			}

			const c1Intersection = c1.intersectRay( ray, boxIntersection );
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
			const c2Intersection = c2.intersectRay( ray, boxIntersection );
			const c2Result = c2Intersection ? c2.raycastFirst( mesh, raycaster, ray ) : null;

			if ( c1Result && c2Result ) {

				return c1Result.distance <= c2Result.distance ? c1Result : c2Result;

			} else {

				return c1Result || c2Result || null;

			}

		}

	}

}
