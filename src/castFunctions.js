
import * as THREE from 'three';
import { intersectTris, intersectClosestTri } from './Utils/RayIntersectTriUtlities.js';
import { arrayToBox } from './Utils/ArrayBoxUtilities.js';
import { OrientedBox } from './Utils/OrientedBox.js';
import { SeparatingAxisTriangle } from './Utils/SeparatingAxisTriangle.js';
import { sphereIntersectTriangle } from './Utils/MathUtilities.js';

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

function intersectRay( node, ray, target ) {

	arrayToBox( node.boundingData, boundingBox );

	return ray.intersectBox( boundingBox, target );

}

export function raycast( node, mesh, raycaster, ray, intersects ) {

	if ( node.continueGeneration ) {

		node.continueGeneration();

	}

	if ( node.count ) {

		intersectTris( mesh, mesh.geometry, raycaster, ray, node.offset, node.count, intersects );

	} else {

		if ( intersectRay( node.left, ray, boxIntersection ) ) {

			raycast( node.left, mesh, raycaster, ray, intersects );

		}

		if ( intersectRay( node.right, ray, boxIntersection ) ) {

			raycast( node.right, mesh, raycaster, ray, intersects );

		}

	}

}

export function raycastFirst( node, mesh, raycaster, ray ) {

	if ( node.continueGeneration ) {

		node.continueGeneration();

	}

	if ( node.count ) {

		return intersectClosestTri( mesh, mesh.geometry, raycaster, ray, node.offset, node.count );

	} else {


		// consider the position of the split plane with respect to the oncoming ray; whichever direction
		// the ray is coming from, look for an intersection among that side of the tree first
		const splitAxis = node.splitAxis;
		const xyzAxis = xyzFields[ splitAxis ];
		const rayDir = ray.direction[ xyzAxis ];
		const leftToRight = rayDir >= 0;

		// c1 is the child to check first
		let c1, c2;
		if ( leftToRight ) {

			c1 = node.left;
			c2 = node.right;

		} else {

			c1 = node.right;
			c2 = node.left;

		}

		const c1Intersection = intersectRay( c1, ray, boxIntersection );
		const c1Result = c1Intersection ? raycastFirst( c1, mesh, raycaster, ray ) : null;

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
		const c2Intersection = intersectRay( c2, ray, boxIntersection );
		const c2Result = c2Intersection ? raycastFirst( c2, mesh, raycaster, ray ) : null;

		if ( c1Result && c2Result ) {

			return c1Result.distance <= c2Result.distance ? c1Result : c2Result;

		} else {

			return c1Result || c2Result || null;

		}

	}

}

export const shapecast = ( function () {

	const triangle = new SeparatingAxisTriangle();
	const cachedBox1 = new THREE.Box3();
	const cachedBox2 = new THREE.Box3();
	return function shapecast( node, mesh, intersectsBoundsFunc, intersectsTriangleFunc = null, nodeScoreFunc = null ) {

		if ( node.continueGeneration ) {

			node.continueGeneration();

		}

		if ( node.count && intersectsTriangleFunc ) {

			const geometry = mesh.geometry;
			const index = geometry.index;
			const pos = geometry.attributes.position;
			const offset = node.offset;
			const count = node.count;

			for ( let i = offset * 3, l = ( count + offset ) * 3; i < l; i += 3 ) {

				setTriangle( triangle, i, index, pos );
				triangle.update();

				if ( intersectsTriangleFunc( triangle, i, i + 1, i + 2 ) ) {

					return true;

				}

			}

			return false;

		} else {

			const left = node.left;
			const right = node.right;
			let c1 = left;
			let c2 = right;

			let score1, score2;
			let box1, box2;
			if ( nodeScoreFunc ) {

				box1 = cachedBox1;
				box2 = cachedBox2;

				arrayToBox( c1.boundingData, box1 );
				arrayToBox( c2.boundingData, box2 );

				score1 = nodeScoreFunc( box1 );
				score2 = nodeScoreFunc( box2 );

				if ( score2 < score1 ) {

					c1 = right;
					c2 = left;

					const temp = score1;
					score1 = score2;
					score2 = temp;

					const tempBox = box1;
					box1 = box2;
					box2 = tempBox;

				}

			}

			if ( ! box1 ) {

				box1 = cachedBox1;
				arrayToBox( c1.boundingData, box1 );

			}

			const isC1Leaf = ! ! c1.count;
			const c1Intersection =
				intersectsBoundsFunc( box1, isC1Leaf, score1, c1 ) &&
				shapecast( c1, mesh, intersectsBoundsFunc, intersectsTriangleFunc, nodeScoreFunc );

			if ( c1Intersection ) return true;


			if ( ! box2 ) {

				box2 = cachedBox2;
				arrayToBox( c2.boundingData, box2 );

			}

			const isC2Leaf = ! ! c2.count;
			const c2Intersection =
				intersectsBoundsFunc( box2, isC2Leaf, score2, c2 ) &&
				shapecast( c2, mesh, intersectsBoundsFunc, intersectsTriangleFunc, nodeScoreFunc );

			if ( c2Intersection ) return true;

			return false;

		}

	};

} )();

export const intersectsGeometry = ( function () {

	const triangle = new SeparatingAxisTriangle();
	const triangle2 = new SeparatingAxisTriangle();
	const cachedMesh = new THREE.Mesh();
	const invertedMat = new THREE.Matrix4();

	const obb = new OrientedBox();
	const obb2 = new OrientedBox();

	return function intersectsGeometry( node, mesh, geometry, geometryToBvh, cachedObb = null ) {

		if ( node.continueGeneration ) {

			node.continueGeneration();

		}

		if ( cachedObb === null ) {

			if ( ! geometry.boundingBox ) {

				geometry.computeBoundingBox();

			}

			obb.set( geometry.boundingBox.min, geometry.boundingBox.max, geometryToBvh );
			obb.update();
			cachedObb = obb;

		}

		if ( node.count ) {

			const thisGeometry = mesh.geometry;
			const thisIndex = thisGeometry.index;
			const thisPos = thisGeometry.attributes.position;

			const index = geometry.index;
			const pos = geometry.attributes.position;

			const offset = node.offset;
			const count = node.count;

			// get the inverse of the geometry matrix so we can transform our triangles into the
			// geometry space we're trying to test. We assume there are fewer triangles being checked
			// here.
			invertedMat.getInverse( geometryToBvh );

			if ( geometry.boundsTree ) {

				arrayToBox( node.boundingData, obb2 );
				obb2.matrix.copy( invertedMat );
				obb2.update();

				cachedMesh.geometry = geometry;
				const res = geometry.boundsTree.shapecast( cachedMesh, box => obb2.intersectsBox( box ), function ( tri ) {

					tri.a.applyMatrix4( geometryToBvh );
					tri.b.applyMatrix4( geometryToBvh );
					tri.c.applyMatrix4( geometryToBvh );
					tri.update();

					for ( let i = offset * 3, l = ( count + offset ) * 3; i < l; i += 3 ) {

						// this triangle needs to be transformed into the current BVH coordinate frame
						setTriangle( triangle2, i, thisIndex, thisPos );
						triangle2.update();
						if ( tri.intersectsTriangle( triangle2 ) ) {

							return true;

						}

					}

					return false;

				} );
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

			const left = node.left;
			const right = node.right;

			arrayToBox( left.boundingData, boundingBox );
			const leftIntersection =
				cachedObb.intersectsBox( boundingBox ) &&
				intersectsGeometry( left, mesh, geometry, geometryToBvh, cachedObb );

			if ( leftIntersection ) return true;


			arrayToBox( right.boundingData, boundingBox );
			const rightIntersection =
				cachedObb.intersectsBox( boundingBox ) &&
				intersectsGeometry( right, mesh, geometry, geometryToBvh, cachedObb );

			if ( rightIntersection ) return true;

			return false;

		}

	};

} )();

export const intersectsBox = ( function () {

	const obb = new OrientedBox();

	return function intersectsBox( node, mesh, box, boxToBvh ) {

		obb.set( box.min, box.max, boxToBvh );
		obb.update();

		return shapecast(
			node,
			mesh,
			box => obb.intersectsBox( box ),
			tri => obb.intersectsTriangle( tri )
		);

	};

} )();

export const intersectsSphere = ( function () {

	return function intersectsSphere( node, mesh, sphere ) {

		return shapecast(
			node,
			mesh,
			box => sphere.intersectsBox( box ),
			tri => sphereIntersectTriangle( sphere, tri )
		);

	};

} )();

export const closestPointToPoint = ( function () {

	// early out if under minThreshold
	// skip checking if over maxThreshold
	// set minThreshold = maxThreshold to quickly check if a point is within a threshold
	// returns Infinity if no value found

	const temp = new THREE.Vector3();
	return function closestPointToPoint( node, mesh, point, target = null, minThreshold = 0, maxThreshold = Infinity ) {

		let closestDistance = Infinity;
		shapecast(

			node,
			mesh,
			( box, isLeaf, score ) => score < closestDistance && score < maxThreshold,
			tri => {

				tri.closestPointToPoint( point, temp );
				const dist = point.distanceTo( temp );
				if ( dist < closestDistance ) {

					if ( target ) target.copy( temp );
					closestDistance = dist;

				}
				if ( dist < minThreshold ) return true;
				return false;

			},
			box => box.distanceToPoint( point )

		);

		return closestDistance;

	};

} )();

export const closestPointToGeometry = ( function () {

	// early out if under minThreshold
	// skip checking if over maxThreshold
	// set minThreshold = maxThreshold to quickly check if a point is within a threshold
	// returns Infinity if no value found

	const tri2 = new SeparatingAxisTriangle();
	const obb = new OrientedBox();

	const temp1 = new THREE.Vector3();
	const temp2 = new THREE.Vector3();
	return function closestPointToGeometry( node, mesh, geometry, geometryToBvh, target1 = null, target2 = null, minThreshold = 0, maxThreshold = Infinity ) {

		if ( ! geometry.boundingBox ) geometry.computeBoundingBox();
		obb.set( geometry.boundingBox.min, geometry.boundingBox.max, geometryToBvh );
		obb.update();

		const pos = geometry.attributes.position;
		const index = geometry.index;

		let tempTarget1, tempTarget2;
		if ( target1 ) tempTarget1 = temp1;
		if ( target2 ) tempTarget2 = temp2;

		let closestDistance = Infinity;
		shapecast(
			node,
			mesh,
			( box, isLeaf, score ) => score < closestDistance && score < maxThreshold,
			tri => {

				const sphere1 = tri.sphere;
				for ( let i2 = 0, l2 = index.count; i2 < l2; i2 += 3 ) {

					setTriangle( tri2, i2, index, pos );
					tri2.a.applyMatrix4( geometryToBvh );
					tri2.b.applyMatrix4( geometryToBvh );
					tri2.c.applyMatrix4( geometryToBvh );
					tri2.sphere.setFromPoints( tri2.points );

					const sphere2 = tri2.sphere;
					const sphereDist = sphere2.center.distanceTo( sphere1.center ) - sphere2.radius - sphere1.radius;
					if ( sphereDist > closestDistance ) continue;

					tri2.update();

					const dist = tri.distanceToTriangle( tri2, tempTarget1, tempTarget2 );
					if ( dist < closestDistance ) {

						if ( target1 ) target1.copy( tempTarget1 );
						if ( target2 ) target2.copy( tempTarget2 );
						closestDistance = dist;

					}
					if ( dist < minThreshold ) return true;

				}

				return false;

			},
			box => obb.distanceToBox( box, Math.min( closestDistance, maxThreshold ) )

		);

		return closestDistance;

	};

} )();
