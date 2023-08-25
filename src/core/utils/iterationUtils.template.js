import { intersectTri } from '../../utils/ThreeRayIntersectUtilities.js';
export function intersectTris/* @echo INDIRECT_STRING */( bvh, side, ray, offset, count, intersections ) {

	const { geometry, _indirectBuffer } = bvh;
	for ( let i = offset, end = offset + count; i < end; i ++ ) {

		/* @if INDIRECT */

		let vi = _indirectBuffer ? _indirectBuffer[ i ] : i;
		intersectTri( geometry, side, ray, vi, intersections );

		/* @else */

		intersectTri( geometry, side, ray, i, intersections );

		/* @endif */

	}

}

export function intersectClosestTri/* @echo INDIRECT_STRING */( bvh, side, ray, offset, count ) {

	const { geometry, _indirectBuffer } = bvh;
	let dist = Infinity;
	let res = null;
	for ( let i = offset, end = offset + count; i < end; i ++ ) {

		/* @if INDIRECT */

		let vi = _indirectBuffer ? _indirectBuffer[ i ] : i;
		const intersection = intersectTri( geometry, side, ray, vi );

		/* @else */

		const intersection = intersectTri( geometry, side, ray, i );

		/* @endif */

		if ( intersection && intersection.distance < dist ) {

			res = intersection;
			dist = intersection.distance;

		}

	}

	return res;

}
