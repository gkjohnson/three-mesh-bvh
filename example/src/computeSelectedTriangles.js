import * as THREE from "three";
import { CONTAINED, INTERSECTED, NOT_INTERSECTED } from "../..";
import { getConvexHull } from "../utils/math/getConvexHull.js";
import { lineCrossesLine } from "../utils/math/lineCrossesLine.js";
import {
	isPointInsidePolygon,
	pointRayCrossesSegments,
} from "../utils/math/pointRayCrossesSegments.js";

/**
 * Compute selected triangles:
 *
 * 1. Construct a list of screen space line segments that represent the shape drawn by the user.
 * 2. For every triangle in the geometry check if any part is within the shape. If it is then consider the triangle selected.
 *
 * @returns Array of triplets representing indices of vertices of selected triangles
 *
 * @see https://github.com/gkjohnson/three-mesh-bvh/issues/166#issuecomment-752194034
 */
export function computeSelectedTriangles( mesh, camera, selectionTool, params ) {

	// TODO: Possible improvements
	// - Correctly handle the camera near clip
	// - Improve line line intersect performance?

	toScreenSpaceMatrix
		.copy( mesh.matrixWorld )
		.premultiply( camera.matrixWorldInverse )
		.premultiply( camera.projectionMatrix );

	invWorldMatrix.copy( mesh.matrixWorld ).invert();
	camLocalPosition
		.set( 0, 0, 0 )
		.applyMatrix4( camera.matrixWorld )
		.applyMatrix4( invWorldMatrix );

	const lassoSegments = connectPointsWithLines(
		convertTripletsToPoints( selectionTool.points )
	);

	/**
	 * Per-depth cache of lasso segments that were filtered to be to the right of a box for that depth.
	 * @type {Array<Array<THREE.Line3>>}
	 */
	const perBoundsSegmentCache = [];

	/**
	 * Array of triplets representing indices of vertices of selected triangles.
	 * @type {Array<number>}
	 */
	const indices = [];

	// find all the triangles in the mesh that intersect the lasso
	mesh.geometry.boundsTree.shapecast( {
		intersectsBounds: ( box, isLeaf, score, depth ) => {

			// check if bounds intersect or contain the lasso region to narrow down on the triangles

			if ( ! params.useBoundsTree ) {

				return INTERSECTED;

			}

			const projectedBoxPoints = extractBoxVertices( box, boxPoints ).map( ( v ) =>
				v.applyMatrix4( toScreenSpaceMatrix )
			);

			let minY = Infinity;
			let maxY = - Infinity;
			let minX = Infinity;
			for ( const point of projectedBoxPoints ) {

				if ( point.y < minY ) minY = point.y;
				if ( point.y > maxY ) maxY = point.y;
				if ( point.x < minX ) minX = point.x;

			}

			// filter the lasso segments to only leave the ones to the right of the bounding box.
			// we don't need the ones on the left because the point-in-polygon ray casting algorithm casts rays to the right.
			// cache the filtered segments in the above array for subsequent child checks to use.
			const parentSegments = perBoundsSegmentCache[ depth - 1 ] || lassoSegments;
			const segmentsToCheck = parentSegments.filter( ( segment ) =>
				isSegmentToTheRight( segment, minX, minY, maxY )
			);
			perBoundsSegmentCache[ depth ] = segmentsToCheck;

			if ( segmentsToCheck.length === 0 ) {

				return NOT_INTERSECTED;

			}

			const hull = getConvexHull( projectedBoxPoints );
			const hullSegments = connectPointsWithLines( hull, boxLines );

			// If a lasso point is inside the hull then the box cannot be contained inside the lasso, so it must be intersected by the lasso.
			if ( isPointInsidePolygon( segmentsToCheck[ 0 ].start, hullSegments ) ) {

				return INTERSECTED;

			}

			// determine if the box is intersected by the lasso by counting the number of crossings
			// https://en.wikipedia.org/wiki/Point_in_polygon#Ray_casting_algorithm
			const firstPointCrossings = pointRayCrossesSegments(
				hull[ 0 ],
				segmentsToCheck
			);
			if (
				hull.some(
					( point ) =>
						pointRayCrossesSegments( point, segmentsToCheck ) !==
						firstPointCrossings
				)
			) {

				return INTERSECTED;

			}

			// check if there are any intersections between the hull and the lasso segments
			for ( const hullSegment of hullSegments ) {

				for ( const selectionSegment of segmentsToCheck ) {

					if ( lineCrossesLine( hullSegment, selectionSegment ) ) {

						return INTERSECTED;

					}

				}

			}

			return firstPointCrossings % 2 === 0 ? NOT_INTERSECTED : CONTAINED;

		},

		intersectsTriangle: ( tri, index, contained, depth ) => {

			// if the box containing this triangle was intersected or contained, check if the triangle itself should be selected

			const i3 = index * 3;
			const a = i3 + 0;
			const b = i3 + 1;
			const c = i3 + 2;

			// check all the segments if using no bounds tree
			const segmentsToCheck = params.useBoundsTree
				? perBoundsSegmentCache[ depth ]
				: lassoSegments;
			if (
				params.selectionMode === "centroid" ||
				params.selectionMode === "centroid-visible"
			) {

				// get the center of the triangle
				centroid
					.copy( tri.a )
					.add( tri.b )
					.add( tri.c )
					.multiplyScalar( 1 / 3 );
				screenCentroid.copy( centroid ).applyMatrix4( toScreenSpaceMatrix );

				if (
					contained ||
					isPointInsidePolygon( screenCentroid, segmentsToCheck )
				) {

					// if we're only selecting visible faces then perform a ray check to ensure the centroid
					// is visible.
					if ( params.selectionMode === "centroid-visible" ) {

						tri.getNormal( faceNormal );
						tempRay.origin.copy( centroid ).addScaledVector( faceNormal, 1e-6 );
						tempRay.direction.subVectors( camLocalPosition, centroid );

						const res = mesh.geometry.boundsTree.raycastFirst(
							tempRay,
							THREE.DoubleSide
						);
						if ( res ) {

							return false;

						}

					}

					indices.push( a, b, c );
					return params.selectWholeModel;

				}

			} else if ( params.selectionMode === "intersection" ) {

				// if the parent bounds were marked as contained then we contain all the triangles within
				if ( contained ) {

					indices.push( a, b, c );
					return params.selectWholeModel;

				}

				// check if any of the projected vertices are inside the selection and if so then the triangle is selected
				const projectedTriangle = [ tri.a, tri.b, tri.c ].map( ( v ) =>
					v.applyMatrix4( toScreenSpaceMatrix )
				);
				for ( const point of projectedTriangle ) {

					if ( isPointInsidePolygon( point, segmentsToCheck ) ) {

						indices.push( a, b, c );
						return params.selectWholeModel;

					}

				}

				// check for the case where a selection intersects a triangle but does not contain any
				// of the vertices
				const triangleSegments = connectPointsWithLines(
					projectedTriangle,
					boxLines
				);
				for ( const segment of triangleSegments ) {

					for ( const selectionSegment of segmentsToCheck ) {

						if ( lineCrossesLine( segment, selectionSegment ) ) {

							indices.push( a, b, c );
							return params.selectWholeModel;

						}

					}

				}

			}

			return false;

		},
	} );

	return indices;

}

const invWorldMatrix = new THREE.Matrix4();
const camLocalPosition = new THREE.Vector3();
const tempRay = new THREE.Ray();
const centroid = new THREE.Vector3();
const screenCentroid = new THREE.Vector3();
const faceNormal = new THREE.Vector3();
const toScreenSpaceMatrix = new THREE.Matrix4();
const boxPoints = new Array( 8 ).fill().map( () => new THREE.Vector3() );
const boxLines = new Array( 12 ).fill().map( () => new THREE.Line3() );

/**
 * Produce a list of 3D points representing vertices of the box.
 *
 * @param {THREE.Box3} box
 * @param {Array<THREE.Vector3>} target Array of 8 vectors to write to
 * @returns {Array<THREE.Vector3>}
 */
function extractBoxVertices( box, target ) {

	const { min, max } = box;
	let index = 0;

	for ( let x = 0; x <= 1; x ++ ) {

		for ( let y = 0; y <= 1; y ++ ) {

			for ( let z = 0; z <= 1; z ++ ) {

				const v = target[ index ];
				v.x = x === 0 ? min.x : max.x;
				v.y = y === 0 ? min.y : max.y;
				v.z = z === 0 ? min.z : max.z;
				index ++;

			}

		}

	}

	return target;

}

/**
 * Determine if a line segment is to the right of a box.
 *
 * @param {THREE.Line3} segment
 * @param {number} minX The leftmost X coordinate of the box
 * @param {number} minY The bottommost Y coordinate of the box
 * @param {number} maxY The topmost Y coordinate of the box
 * @returns {boolean}
 */
function isSegmentToTheRight( segment, minX, minY, maxY ) {

	const sx = segment.start.x;
	const sy = segment.start.y;
	const ex = segment.end.x;
	const ey = segment.end.y;

	if ( sx < minX && ex < minX ) return false;
	if ( sy > maxY && ey > maxY ) return false;
	if ( sy < minY && ey < minY ) return false;

	return true;

}

/**
 * Given a list of points representing a polygon, produce a list of line segments of that polygon.
 *
 * @param {Array<THREE.Vector3>} points
 * @param {Array<THREE.Line3> | null} target Array of the same length as `points` of lines to write to
 * @returns {Array<THREE.Line3>}
 */
function connectPointsWithLines( points, target = null ) {

	if ( target === null ) {

		target = new Array( points.length ).fill( null ).map( () => new THREE.Line3() );

	}

	return points.map( ( p, i ) => {

		const nextP = points[ ( i + 1 ) % points.length ];
		const line = target[ i ];
		line.start.copy( p );
		line.end.copy( nextP );
		return line;

	} );

}

/**
 * Convert a list of triplets representing coordinates into a list of 3D points.
 * @param {Array<number>} array Array of points in the form [x0, y0, z0, x1, y1, z1, …]
 * @returns {Array<THREE.Vector3>}
 */
function convertTripletsToPoints( array ) {

	const points = [];
	for ( let i = 0; i < array.length; i += 3 ) {

		points.push( new THREE.Vector3( array[ i ], array[ i + 1 ], array[ i + 2 ] ) );

	}

	return points;

}
