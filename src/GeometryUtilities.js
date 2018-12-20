import { checkBufferGeometryIntersection } from './IntersectionUtilities.js';

const xyzFields = [ 'x', 'y', 'z' ];

const getLongestEdgeIndex = ( bb ) => {

	let splitDimIdx = - 1;
	let splitDist = - Infinity;
	for ( let i = 0; i < xyzFields.length; i ++ ) {

		const d = xyzFields[ i ];
		const dist = bb.max[ d ] - bb.min[ d ];
		if ( dist > splitDist ) {

			splitDist = dist;
			splitDimIdx = i;

		}

	}

	return splitDimIdx;

};

// For BVH code specifically. Does not check morph targets
// Copied from mesh raycasting
// Ripped an modified from the THREE.js source in Mesh.CS
const intersectTri = ( mesh, geo, raycaster, ray, tri, intersections ) => {

	const triOffset = tri * 3;
	const a = geo.index ? geo.index.getX( triOffset ) : triOffset;
	const b = geo.index ? geo.index.getX( triOffset + 1 ) : triOffset + 1;
	const c = geo.index ? geo.index.getX( triOffset + 2 ) : triOffset + 2;

	const intersection = checkBufferGeometryIntersection( mesh, raycaster, ray, geo.attributes.position, geo.attributes.uv, a, b, c );

	if ( intersection ) {

		intersection.faceIndex = tri;
		if ( intersections ) intersections.push( intersection );
		return intersection;

	}

	return null;

};

const intersectTris = ( mesh, geo, raycaster, ray, offset, count, intersections ) => {

	for ( let i = offset, end = offset + count; i < end; i ++ ) {

		intersectTri( mesh, geo, raycaster, ray, i, intersections );

	}

};

const intersectClosestTri = ( mesh, geo, raycaster, ray, offset, count ) => {

	let dist = Infinity;
	let res = null;
	for ( let i = offset, end = offset + count; i < end; i ++ ) {

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
