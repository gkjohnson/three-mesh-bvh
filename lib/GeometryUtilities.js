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

// returns the average point of the all the provided
// triangles in the geometry
const getAverage = ( tris, avg, geo, getValFunc ) => {

	let avgx = 0;
	let avgy = 0;
	let avgz = 0;

	for ( let i = 0, l = tris.length; i < l; i ++ ) {

		const tri = tris[ i ];

		for ( let v = 0; v < 3; v ++ ) {

			avgx += getValFunc( geo, tri, v, 0 );
			avgy += getValFunc( geo, tri, v, 1 );
			avgz += getValFunc( geo, tri, v, 2 );

		}

	}

	avg.x = avgx / ( tris.length * 3 );
	avg.y = avgy / ( tris.length * 3 );
	avg.z = avgz / ( tris.length * 3 );

};

// shrinks the provided bounds on any dimensions to fit
// the provided triangles
const shrinkBoundsTo = ( tris, bounds, geo, getValFunc ) => {

	let minx = Infinity;
	let miny = Infinity;
	let minz = Infinity;

	let maxx = - Infinity;
	let maxy = - Infinity;
	let maxz = - Infinity;

	let x, y, z;

	for ( let i = 0, l = tris.length; i < l; i ++ ) {

		const tri = tris[ i ];

		for ( let v = 0; v < 3; v ++ ) {

			x = getValFunc( geo, tri, v, 0 );
			minx = Math.min( minx, x );
			maxx = Math.max( maxx, x );
			y = getValFunc( geo, tri, v, 1 );
			miny = Math.min( miny, y );
			maxy = Math.max( maxy, y );
			z = getValFunc( geo, tri, v, 2 );
			minz = Math.min( minz, z );
			maxz = Math.max( maxz, z );

		}

	}

	bounds.min.x = Math.max( minx, bounds.min.x );
	bounds.min.y = Math.max( miny, bounds.min.y );
	bounds.min.z = Math.max( minz, bounds.min.z );

	bounds.max.x = Math.min( maxx, bounds.max.x );
	bounds.max.y = Math.min( maxy, bounds.max.y );
	bounds.max.z = Math.min( maxz, bounds.max.z );

};

// shrinks the provided sphere to fit the provided triangles
const shrinkSphereTo = ( tris, sphere, geo, getValFunc ) => {

	const center = sphere.center;
	let maxRadiusSq = 0;

	for ( let i = 0, l = tris.length; i < l; i ++ ) {

		const tri = tris[ i ];

		for ( let v = 0; v < 3; v ++ ) {

			const x = getValFunc( geo, tri, v, 0 );
			const dx = center.x - x;
			const y = getValFunc( geo, tri, v, 1 );
			const dy = center.y - y;
			const z = getValFunc( geo, tri, v, 2 );
			const dz = center.z - z;

			maxRadiusSq = Math.max( maxRadiusSq, dx * dx + dy * dy + dz * dz );

		}

	}

	sphere.radius = Math.min( sphere.radius, Math.sqrt( maxRadiusSq ) );

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
	shrinkBoundsTo, shrinkSphereTo, intersectTri, intersectTris, intersectClosestTri
};
