import * as THREE from '../node_modules/three/build/three.module.js';
import { checkBufferGeometryIntersection, uvIntersection } from './IntersectionUtilities.js';

const abcFields = [ 'a', 'b', 'c' ];
const xyzFields = [ 'x', 'y', 'z' ];

const getLongestEdgeIndex = ( bb ) => {

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

// For BVH code specifically. Does not check morph targets
// Copied from mesh raycasting
// Ripped an modified from the THREE.js source in Mesh.CS
const intersectionPoint = new THREE.Vector3();
const intersectTri = ( mesh, geo, raycaster, ray, tri, intersections, seenFaces ) => {

	const faceIndex = tri;
	if ( seenFaces != null && seenFaces[ faceIndex ] ) {

		return null;

	}

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

	return null;

};

const intersectTris = ( mesh, geo, raycaster, ray, offset, count, intersections, seenFaces ) => {

	for ( let i = offset; i < offset + count; i ++ ) {

		intersectTri( mesh, geo, raycaster, ray, i, intersections, seenFaces );

	}

};

const intersectClosestTri = ( mesh, geo, raycaster, ray, offset, count ) => {

	let dist = Infinity;
	let res = null;
	for ( let i = offset; i < offset + count; i ++ ) {

		const intersection = intersectTri( mesh, geo, raycaster, ray, i );
		if ( intersection && intersection.distance < dist ) {

			res = intersection;
			dist = intersection.distance;

		}

	}

	return res;

};

export {
	getLongestEdgeIndex, intersectTri, intersectTris, intersectClosestTri
};
