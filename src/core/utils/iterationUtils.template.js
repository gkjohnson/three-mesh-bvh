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


export function iterateOverTriangles/* @echo INDIRECT_STRING */(
	offset,
	count,
	bvh,
	intersectsTriangleFunc,
	contained,
	depth,
	triangle
) {

	const { geometry } = bvh;
	const { index } = geometry;
	const pos = geometry.attributes.position;
	for ( let i = offset, l = count + offset; i < l; i ++ ) {

		/* @if INDIRECT */

		const tri = bvh.resolveTriangleIndex( i );
		setTriangle( triangle, tri * 3, index, pos );

		/* @else */

		setTriangle( triangle, i * 3, index, pos );

		/* @endif */
		triangle.needsUpdate = true;

		if ( intersectsTriangleFunc( triangle, tri, contained, depth ) ) {

			return true;

		}

	}

	return false;

}
