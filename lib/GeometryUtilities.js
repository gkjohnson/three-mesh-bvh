import * as THREE from '../node_modules/three/build/three.module.js';
import { checkIntersection, checkBufferGeometryIntersection, uvIntersection } from './IntersectionUtilities.js';

const abcFields = [ 'a', 'b', 'c' ];
const xyzFields = [ 'x', 'y', 'z' ];

// TODO: This could probably be optimizied to not dig so deeply into an object
// and reust some of the fetch values in some cases
const getBufferGeometryVertexElem = ( geo, tri, vert, elem ) => {

	return geo.attributes.position.array[ ( geo.index ? geo.index.array[ 3 * tri + vert ] : ( 3 * tri + vert ) ) * 3 + elem ];

};

// TODO: This function seems significantly slower than
// before when we were had custom bounds functions
const getGeometryVertexElem = ( geo, tri, vert, elem ) => {

	return geo.vertices[ geo.faces[ tri ][ abcFields[ vert ] ] ][ xyzFields[ elem ] ];

};

const getLongestEdgeIndex = bb => {

	let splitDimIdx = - 1;
	let splitDist = - Infinity;
	xyzFields.forEach( ( d, i ) => {

		const dist = bb.max[ d ] - bb.min[ d ];
		if ( dist > splitDist ) {

			splitDist = dist;
			splitDimIdx = i;

		}

	} );
	return splitDimIdx;

};

// returns an array of size tris.length * 6 where triangle i maps to a
// [x_min, x_max, y_min, y_max, z_min, z_max] tuple starting at index i * 6,
// representing the minimum and maximum extent in each dimension of triangle i
const getBounds = ( tris, geo, getValFunc ) => {

	const result = new Array( tris.length * 6 );

	for ( let i = 0, l = tris.length; i < l; i ++ ) {

		const tri = tris[ i ];

		for ( let el = 0; el < 3; el ++ ) {

			const a = getValFunc( geo, tri, 0, el );
			const b = getValFunc( geo, tri, 1, el );
			const c = getValFunc( geo, tri, 2, el );
			result[ i * 6 + el * 2 ] = Math.min( a, b, c );
			result[ i * 6 + el * 2 + 1 ] = Math.max( a, b, c );

		}

	}

	return result;

};

// returns an array of size tris.length * 3 where triangle i maps to an [x, y, z] triplet
// starting at index i * 3, representing the centroid of triangle i
const getCentroids = ( tris, geo, getValFunc ) => {

	const result = new Array( tris.length * 3 );

	for ( let i = 0, l = tris.length; i < l; i ++ ) {

		const tri = tris[ i ];

		for ( let el = 0; el < 3; el ++ ) {

			const a = getValFunc( geo, tri, 0, el );
			const b = getValFunc( geo, tri, 1, el );
			const c = getValFunc( geo, tri, 2, el );
			result[ i * 3 + el ] = ( a + b + c ) / 3;

		}

	}

	return result;

};

// returns the average point of the all the provided
// triangles in the geometry
const getAverage = ( tris, centroids, avg ) => {

	let avgx = 0;
	let avgy = 0;
	let avgz = 0;

	for ( let i = 0, l = tris.length; i < l; i ++ ) {

		const tri = tris[ i ];

		avgx += centroids[ tri * 3 + 0 ];
		avgy += centroids[ tri * 3 + 1 ];
		avgz += centroids[ tri * 3 + 2 ];

	}

	avg.x = avgx / ( tris.length * 3 );
	avg.y = avgy / ( tris.length * 3 );
	avg.z = avgz / ( tris.length * 3 );

};

// shrinks the provided bounds on any dimensions to fit
// the provided triangles
const shrinkBoundsTo = ( tris, bounds, target ) => {

	let minx = Infinity;
	let miny = Infinity;
	let minz = Infinity;

	let maxx = - Infinity;
	let maxy = - Infinity;
	let maxz = - Infinity;

	for ( let i = 0, l = tris.length; i < l; i ++ ) {

		const tri = tris[ i ];

		minx = Math.min( minx, bounds[ tri * 6 + 0 ] );
		maxx = Math.max( maxx, bounds[ tri * 6 + 1 ] );
		miny = Math.min( miny, bounds[ tri * 6 + 2 ] );
		maxy = Math.max( maxy, bounds[ tri * 6 + 3 ] );
		minz = Math.min( minz, bounds[ tri * 6 + 4 ] );
		maxz = Math.max( maxz, bounds[ tri * 6 + 5 ] );

	}

	target.min.x = Math.max( minx, target.min.x );
	target.min.y = Math.max( miny, target.min.y );
	target.min.z = Math.max( minz, target.min.z );

	target.max.x = Math.min( maxx, target.max.x );
	target.max.y = Math.min( maxy, target.max.y );
	target.max.z = Math.min( maxz, target.max.z );

};

// For BVH code specifically. Does not check morph targets
// Copied from mesh raycasting
// Ripped an modified from the THREE.js source in Mesh.CS
const intersectionPoint = new THREE.Vector3();
const intersectTri = ( mesh, geo, raycaster, ray, tri, intersections, seenFaces ) => {

	const faceIndex = tri;
	if ( seenFaces != null && seenFaces[ faceIndex ] ) {

		return null;

	}
	if ( geo.isBufferGeometry ) {

		tri = tri * 3;
		const a = geo.index ? geo.index.getX( tri ) : tri;
		const b = geo.index ? geo.index.getX( tri + 1 ) : tri + 1;
		const c = geo.index ? geo.index.getX( tri + 2 ) : tri + 2;

		const intersection = checkBufferGeometryIntersection( mesh, raycaster, ray, geo.attributes.position, geo.attributes.uv, a, b, c );

		if ( intersection ) {

			if ( seenFaces != null ) {

				seenFaces[ faceIndex ] = true;

			}
			intersection.faceIndex = faceIndex; // triangle number
			if ( intersections ) intersections.push( intersection );
			return intersection;

		}

	} else if ( geo.isGeometry ) {

		const faces = geo.faces;
		const vertices = geo.vertices;
		const uvs = geo.uvs;
		const face = faces[ tri ];
		const isMultiMaterial = Array.isArray( mesh.material );
		const faceMaterial = isMultiMaterial ? mesh.material[ face.materialIndex ] : mesh.material;

		const uvA = new THREE.Vector2();
		const uvB = new THREE.Vector2();
		const uvC = new THREE.Vector2();

		if ( faceMaterial !== undefined ) {

			const fvA = vertices[ face.a ];
			const fvB = vertices[ face.b ];
			const fvC = vertices[ face.c ];

			const intersection = checkIntersection( mesh, faceMaterial, raycaster, ray, fvA, fvB, fvC, intersectionPoint );

			if ( intersection ) {

				if ( seenFaces != null ) {

					seenFaces[ faceIndex ] = true;

				}

				if ( uvs && uvs[ faceIndex ] ) {

					const uvsf = uvs[ faceIndex ];
					uvA.copy( uvsf[ 0 ] );
					uvB.copy( uvsf[ 1 ] );
					uvC.copy( uvsf[ 2 ] );

					intersection.uv = uvIntersection( intersectionPoint, fvA, fvB, fvC, uvA, uvB, uvC );

				}

				intersection.face = face;
				intersection.faceIndex = tri;
				if ( intersections ) intersections.push( intersection );
				return intersection;

			}

		}

	}
	return null;

};

const intersectTris = ( mesh, geo, raycaster, ray, tris, intersections, seenFaces ) => {

	for ( let i = 0, l = tris.length; i < l; i ++ ) {

		intersectTri( mesh, geo, raycaster, ray, tris[ i ], intersections, seenFaces );

	}

};

const intersectClosestTri = ( mesh, geo, raycaster, ray, tris ) => {

	let dist = Infinity;
	let res = null;
	for ( let i = 0, l = tris.length; i < l; i ++ ) {

		const intersection = intersectTri( mesh, geo, raycaster, ray, tris[ i ] );
		if ( intersection && intersection.distance < dist ) {

			res = intersection;
			dist = intersection.distance;

		}

	}

	return res;

};

export {
	getBufferGeometryVertexElem, getGeometryVertexElem, getLongestEdgeIndex, getAverage,
	getBounds, getCentroids, shrinkBoundsTo, intersectTri, intersectTris, intersectClosestTri
};
