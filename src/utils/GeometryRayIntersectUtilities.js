import { intersectTri } from './ThreeRayIntersectUtilities.js';

export function intersectTris( geo, side, ray, offset, count, indirectBuffer, intersections ) {

	for ( let i = offset, end = offset + count; i < end; i ++ ) {

		const tri = i;
		if ( indirectBuffer ) {

			tri = indirectBuffer[ tri ];

		}

		intersectTri( geo, side, ray, tri, intersections );

	}

}

export function intersectClosestTri( geo, side, ray, offset, count, indirectBuffer ) {

	let dist = Infinity;
	let res = null;
	for ( let i = offset, end = offset + count; i < end; i ++ ) {

		const tri = i;
		if ( indirectBuffer ) {

			tri = indirectBuffer[ tri ];

		}

		const intersection = intersectTri( geo, side, ray, tri );
		if ( intersection && intersection.distance < dist ) {

			res = intersection;
			dist = intersection.distance;

		}

	}

	return res;

}

// converts the given BVH raycast intersection to align with the three.js raycast
// structure (include object, world space distance and point).
export function convertRaycastIntersect( hit, object, raycaster ) {

	if ( hit === null ) {

		return null;

	}

	hit.point.applyMatrix4( object.matrixWorld );
	hit.distance = hit.point.distanceTo( raycaster.ray.origin );
	hit.object = object;

	if ( hit.distance < raycaster.near || hit.distance > raycaster.far ) {

		return null;

	} else {

		return hit;

	}

}
