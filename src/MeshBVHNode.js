
import * as THREE from 'three';
import { intersectTris, intersectClosestTri } from './GeometryUtilities.js';
import { arrayToBox, sphereIntersectTriangle } from './BoundsUtilities.js';
import { OrientedBox } from './Utils/OrientedBox.js';
import { SeparatingAxisTriangle } from './Utils/SeparatingAxisTriangle.js';

const boundingBox = new THREE.Box3();
const boxIntersection = new THREE.Vector3();
const xyzFields = [ 'x', 'y', 'z' ];

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

MeshBVHNode.prototype.shapecast = ( function () {

	const triangle = new SeparatingAxisTriangle();
	return function shapecast( mesh, intersectsBoundsFunc, intersectsTriangleFunc = null, orderNodesFunc = null ) {

		if ( this.count && intersectsTriangleFunc ) {

			const geometry = mesh.geometry;
			const index = geometry.index;
			const pos = geometry.attributes.position;
			const offset = this.offset;
			const count = this.count;

			for ( let i = offset * 3, l = ( count + offset * 3 ); i < l; i += 3 ) {

				setTriangle( triangle, i, index, pos );
				triangle.update();

				if ( intersectsTriangleFunc( triangle, i, i + 1, i + 2 ) ) {

					return true;

				}

			}

			return false;

		} else {

			const left = this.left;
			const right = this.right;
			let c1 = left;
			let c2 = right;

			if ( orderNodesFunc && orderNodesFunc( c1, c2 ) > 0 ) {

				c1 = right;
				c2 = left;

			}

			arrayToBox( c1.boundingData, boundingBox );
			const c1Intersection =
				intersectsBoundsFunc( boundingBox, ! ! c1.count ) &&
				c1.shapecast( mesh, intersectsBoundsFunc, intersectsTriangleFunc, orderNodesFunc );

			if ( c1Intersection ) return true;


			arrayToBox( c2.boundingData, boundingBox );
			const c2Intersection =
				intersectsBoundsFunc( boundingBox, ! ! c2.count ) &&
				c2.shapecast( mesh, intersectsBoundsFunc, intersectsTriangleFunc, orderNodesFunc );

			if ( c2Intersection ) return true;

			return false;

		}

	};

} )();

MeshBVHNode.prototype.geometrycast = ( function () {

	const triangle = new SeparatingAxisTriangle();
	const triangle2 = new SeparatingAxisTriangle();
	const cachedMesh = new THREE.Mesh();
	const invertedMat = new THREE.Matrix4();

	const obb = new OrientedBox();
	const obb2 = new OrientedBox();

	return function geometrycast( mesh, geometry, geometryToBvh, cachedObb = null ) {

		if ( cachedObb === null ) {

			if ( ! geometry.boundingBox ) {

				geometry.computeBoundingBox();

			}

			obb.set( geometry.boundingBox.min, geometry.boundingBox.max, geometryToBvh );
			obb.update();
			cachedObb = obb;

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

			if ( geometry.boundsTree ) {

				function triangleCallback( tri ) {

					tri.a.applyMatrix4( geometryToBvh );
					tri.b.applyMatrix4( geometryToBvh );
					tri.c.applyMatrix4( geometryToBvh );
					tri.update();

					for ( let i = offset * 3, l = ( count + offset * 3 ); i < l; i += 3 ) {

						// this triangle needs to be transformed into the current BVH coordinate frame
						setTriangle( triangle2, i, thisIndex, thisPos );
						triangle2.update();
						if ( tri.intersectsTriangle( triangle2 ) ) {

							return true;

						}

					}

					return false;

				}

				arrayToBox( this.boundingData, obb2 );
				obb2.matrix.copy( invertedMat );
				obb2.update();

				cachedMesh.geometry = geometry;
				const res = geometry.boundsTree.shapecast( cachedMesh, box => obb2.intersectsBox( box ), triangleCallback );
				cachedMesh.geometry = null;

				return res;

			} else {

				for ( let i = offset * 3, l = ( count + offset * 3 ); i < l; i += 3 ) {

					// this triangle needs to be transformed into the current BVH coordinate frame
					setTriangle( triangle, i, thisIndex, thisPos );
					triangle.a.applyMatrix4( invertedMat );
					triangle.b.applyMatrix4( invertedMat );
					triangle.c.applyMatrix4( invertedMat );
					triangle.update();

					for ( let i2 = 0, l2 = index.count; i2 < l2; i2 += 3 ) {

						setTriangle( triangle2, i2, index, pos );
						triangle2.update();

						if ( triangle.intersectsTriangle( triangle2 ) ) {

							return true;

						}

					}

				}

			}

		} else {

			const left = this.left;
			const right = this.right;

			arrayToBox( left.boundingData, boundingBox );
			const leftIntersection =
				cachedObb.intersectsBox( boundingBox ) &&
				left.geometrycast( mesh, geometry, geometryToBvh, cachedObb );

			if ( leftIntersection ) return true;


			arrayToBox( right.boundingData, boundingBox );
			const rightIntersection =
				cachedObb.intersectsBox( boundingBox ) &&
				right.geometrycast( mesh, geometry, geometryToBvh, cachedObb );

			if ( rightIntersection ) return true;

			return false;

		}

	};

} )();

MeshBVHNode.prototype.boxcast = ( function () {

	const obb = new OrientedBox();

	return function boxcast( mesh, box, boxToBvh ) {

		obb.set( box.min, box.max, boxToBvh );
		obb.update();

		return this.shapecast(
			mesh,
			box => obb.intersectsBox( box ),
			tri => obb.intersectsTriangle( tri )
		);

	};

} )();

MeshBVHNode.prototype.spherecast = ( function () {

	return function spherecast( mesh, sphere ) {

		return this.shapecast(
			mesh,
			box => sphere.intersectsBox( box ),
			tri => sphereIntersectTriangle( sphere, tri )
		);

	};

} )();

MeshBVHNode.prototype.distancecast = ( function () {

	const tri2 = new THREE.Triangle();
	const obb = new OrientedBox();
	return function distancecast( mesh, geometry, geometryToBvh, threshold ) {

		if ( ! geometry.boundingBox ) geometry.computeBoundingBox();
		obb.set( geometry.boundingBox.min, geometry.boundingBox.max, geometryToBvh );
		obb.update();

		const pos = geometry.attributes.position;
		const index = geometry.index;
		return this.shapecast(
			mesh,
			box => obb.distanceToBox( box ) < threshold,
			tri => {

				for ( let i2 = 0, l2 = index.count; i2 < l2; i2 += 3 ) {

					setTriangle( tri2, i2, index, pos );
					tri2.a.applyMatrix4( geometryToBvh );
					tri2.b.applyMatrix4( geometryToBvh );
					tri2.c.applyMatrix4( geometryToBvh );

					const dist = tri.distanceToTriangle( tri2 );
					if ( dist < threshold ) {

						return true;

					}

				}

				return false;

			}

		);

	};

} )();
