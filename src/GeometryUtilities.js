import { intersectTri } from './IntersectionUtilities.js';

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

export { intersectTris, intersectClosestTri };
