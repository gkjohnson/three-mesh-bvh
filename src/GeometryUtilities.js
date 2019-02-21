import { checkBufferGeometryIntersection } from './IntersectionUtilities.js';

// For BVH code specifically. Does not check morph targets
// Copied from mesh raycasting
// Ripped an modified from the THREE.js source in Mesh.CS
const intersectTri = ( mesh, geo, raycaster, ray, tri, index, intersections = null ) => {

	const triOffset = tri * 3;
	const a = index.getX( triOffset );
	const b = index.getX( triOffset + 1 );
	const c = index.getX( triOffset + 2 );

	const intersection = checkBufferGeometryIntersection( mesh, raycaster, ray, geo.attributes.position, geo.attributes.uv, a, b, c );

	if ( intersection ) {

		intersection.faceIndex = tri;
		if ( intersections ) intersections.push( intersection );
		return intersection;

	}

	return null;

};

const intersectTris = ( mesh, geo, raycaster, ray, offset, count, index, intersections ) => {

	for ( let i = offset, end = offset + count; i < end; i ++ ) {

		intersectTri( mesh, geo, raycaster, ray, i, index, intersections );

	}

};

const intersectClosestTri = ( mesh, geo, raycaster, ray, offset, count, index ) => {

	let dist = Infinity;
	let res = null;
	for ( let i = offset, end = offset + count; i < end; i ++ ) {

		const intersection = intersectTri( mesh, geo, raycaster, ray, i, index );
		if ( intersection && intersection.distance < dist ) {

			res = intersection;
			dist = intersection.distance;

		}

	}

	return res;

};

export {
	intersectTri, intersectTris, intersectClosestTri
};
