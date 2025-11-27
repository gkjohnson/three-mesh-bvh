// reorders `tris` such that for `count` elements after `offset`, elements on the left side of the split
// will be on the left and elements on the right side of the split will be on the right. returns the index
// of the first element on the right side, or offset + count if there are no elements on the right side.
export function partition/* @echo INDIRECT_STRING */( indirectBuffer, index, triangleBounds, offset, count, split ) {

	let left = offset;
	let right = offset + count - 1;
	const pos = split.pos;
	const axisOffset = split.axis * 2;
	const boundsOffset = triangleBounds.offset || 0;

	// hoare partitioning, see e.g. https://en.wikipedia.org/wiki/Quicksort#Hoare_partition_scheme
	while ( true ) {

		while ( left <= right && triangleBounds[ ( left - boundsOffset ) * 6 + axisOffset ] < pos ) {

			left ++;

		}

		// if a triangle center lies on the partition plane it is considered to be on the right side
		while ( left <= right && triangleBounds[ ( right - boundsOffset ) * 6 + axisOffset ] >= pos ) {

			right --;

		}

		if ( left < right ) {

			// we need to swap all of the information associated with the triangles at index
			// left and right; that's the verts in the geometry index, the bounds,
			// and perhaps the SAH planes
			/* @if INDIRECT */

			let t = indirectBuffer[ left ];
			indirectBuffer[ left ] = indirectBuffer[ right ];
			indirectBuffer[ right ] = t;

			/* @else */

			for ( let i = 0; i < 3; i ++ ) {

				let t0 = index[ left * 3 + i ];
				index[ left * 3 + i ] = index[ right * 3 + i ];
				index[ right * 3 + i ] = t0;

			}

			/* @endif */

			// swap bounds
			for ( let i = 0; i < 6; i ++ ) {

				const l = left - boundsOffset;
				const r = right - boundsOffset;
				const tb = triangleBounds[ l * 6 + i ];
				triangleBounds[ l * 6 + i ] = triangleBounds[ r * 6 + i ];
				triangleBounds[ r * 6 + i ] = tb;

			}

			left ++;
			right --;

		} else {

			return left;

		}

	}

}
