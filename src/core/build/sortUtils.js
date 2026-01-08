// reorders the partition buffer such that for `count` elements after `offset`, elements on the left side of the split
// will be on the left and elements on the right side of the split will be on the right. returns the index
// of the first element on the right side, or offset + count if there are no elements on the right side.
export function partition( buffer, stride, primitiveBounds, offset, count, split ) {

	let left = offset;
	let right = offset + count - 1;
	const pos = split.pos;
	const axisOffset = split.axis * 2;
	const boundsOffset = primitiveBounds.offset || 0;

	// hoare partitioning, see e.g. https://en.wikipedia.org/wiki/Quicksort#Hoare_partition_scheme
	while ( true ) {

		while ( left <= right && primitiveBounds[ ( left - boundsOffset ) * 6 + axisOffset ] < pos ) {

			left ++;

		}

		// if a primitive center lies on the partition plane it is considered to be on the right side
		while ( left <= right && primitiveBounds[ ( right - boundsOffset ) * 6 + axisOffset ] >= pos ) {

			right --;

		}

		if ( left < right ) {

			// we need to swap all of the information associated with the primitives at index
			// left and right; that's the elements in the partition buffer and the bounds
			for ( let i = 0; i < stride; i ++ ) {

				let t0 = buffer[ left * stride + i ];
				buffer[ left * stride + i ] = buffer[ right * stride + i ];
				buffer[ right * stride + i ] = t0;

			}

			// swap bounds
			for ( let i = 0; i < 6; i ++ ) {

				const l = left - boundsOffset;
				const r = right - boundsOffset;
				const tb = primitiveBounds[ l * 6 + i ];
				primitiveBounds[ l * 6 + i ] = primitiveBounds[ r * 6 + i ];
				primitiveBounds[ r * 6 + i ] = tb;

			}

			left ++;
			right --;

		} else {

			return left;

		}

	}

}
