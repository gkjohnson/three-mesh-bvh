import { getLongestEdgeIndex, computeSurfaceArea, expandByPrimitiveBounds } from '../../utils/ArrayBoxUtilities.js';
import { CENTER, AVERAGE, SAH, PRIMITIVE_INTERSECT_COST, TRAVERSAL_COST } from '../Constants.js';

const BIN_COUNT = 8;

// nodes with fewer primitives than this test a split at every primitive center instead of binning
const SWEEP_COUNT = 8;

// per bin primitive count and bounds, and the union of the bounds from each bin to the last
const binCounts = /* @__PURE__ */ new Int32Array( BIN_COUNT );
const binBounds = /* @__PURE__ */ new Float32Array( BIN_COUNT * 6 );
const binRightBounds = /* @__PURE__ */ new Float32Array( BIN_COUNT * 6 );
const leftBounds = /* @__PURE__ */ new Float32Array( 6 );
const rightBounds = /* @__PURE__ */ new Float32Array( 6 );

// the primitives of a small node ordered along an axis, and the bounds of the tail from each position
const sweepOrder = /* @__PURE__ */ new Int32Array( SWEEP_COUNT );
const sweepRightBounds = /* @__PURE__ */ new Float32Array( SWEEP_COUNT * 6 );

// expands the bounds stored at "offset" in "bounds" by the primitive at "startIndex"
function expandBoundsAt( startIndex, primitiveBounds, bounds, offset ) {

	for ( let d = 0; d < 3; d ++ ) {

		const center = primitiveBounds[ startIndex + 2 * d ];
		const half = primitiveBounds[ startIndex + 2 * d + 1 ];
		const min = center - half;
		const max = center + half;
		if ( min < bounds[ offset + d ] ) bounds[ offset + d ] = min;
		if ( max > bounds[ offset + d + 3 ] ) bounds[ offset + d + 3 ] = max;

	}

}

function computeSurfaceAreaAt( array, offset ) {

	const d0 = array[ offset + 3 ] - array[ offset ];
	const d1 = array[ offset + 4 ] - array[ offset + 1 ];
	const d2 = array[ offset + 5 ] - array[ offset + 2 ];

	return 2 * ( d0 * d1 + d1 * d2 + d2 * d0 );

}

export function getOptimalSplit( nodeBoundingData, centroidBoundingData, primitiveBounds, offset, count, strategy ) {

	let axis = - 1;
	let pos = 0;

	// Center
	if ( strategy === CENTER ) {

		axis = getLongestEdgeIndex( centroidBoundingData );
		if ( axis !== - 1 ) {

			pos = ( centroidBoundingData[ axis ] + centroidBoundingData[ axis + 3 ] ) / 2;

		}

	} else if ( strategy === AVERAGE ) {

		axis = getLongestEdgeIndex( nodeBoundingData );
		if ( axis !== - 1 ) {

			pos = getAverage( primitiveBounds, offset, count, axis );

		}

	} else if ( strategy === SAH ) {

		const rootSurfaceArea = computeSurfaceArea( nodeBoundingData );
		let bestCost = PRIMITIVE_INTERSECT_COST * count;

		// iterate over all axes
		const boundsOffset = primitiveBounds.offset || 0;
		const cStart = ( offset - boundsOffset ) * 6;
		const cEnd = ( offset + count - boundsOffset ) * 6;
		for ( let a = 0; a < 3; a ++ ) {

			const axisLeft = centroidBoundingData[ a ];
			const axisRight = centroidBoundingData[ a + 3 ];
			const axisLength = axisRight - axisLeft;
			const binWidth = axisLength / BIN_COUNT;

			// If we have fewer primitives than we're planning to split then just check all
			// the primitive positions because it will be faster.
			if ( count < SWEEP_COUNT ) {

				// order the primitives by center along the axis
				for ( let i = 0; i < count; i ++ ) {

					const c = cStart + i * 6;
					const center = primitiveBounds[ c + 2 * a ];
					let j = i;
					while ( j > 0 && primitiveBounds[ sweepOrder[ j - 1 ] + 2 * a ] > center ) {

						sweepOrder[ j ] = sweepOrder[ j - 1 ];
						j --;

					}

					sweepOrder[ j ] = c;

				}

				// the bounds of the primitives from each position to the end
				for ( let d = 0; d < 3; d ++ ) {

					leftBounds[ d ] = Infinity;
					leftBounds[ d + 3 ] = - Infinity;
					rightBounds[ d ] = Infinity;
					rightBounds[ d + 3 ] = - Infinity;

				}

				for ( let i = count - 1; i >= 0; i -- ) {

					expandByPrimitiveBounds( sweepOrder[ i ], primitiveBounds, rightBounds );
					sweepRightBounds.set( rightBounds, i * 6 );

				}

				// sweep the splits between consecutive centers, growing the left bounds as we go
				for ( let i = 0; i < count - 1; i ++ ) {

					expandByPrimitiveBounds( sweepOrder[ i ], primitiveBounds, leftBounds );

					// a primitive whose center lies on the split plane is considered to be on the right
					// side, so equal centers cannot be split apart
					const candidate = primitiveBounds[ sweepOrder[ i + 1 ] + 2 * a ];
					if ( primitiveBounds[ sweepOrder[ i ] + 2 * a ] === candidate ) {

						continue;

					}

					// check the cost of this split
					const leftCount = i + 1;
					const rightCount = count - leftCount;
					const leftProb = computeSurfaceArea( leftBounds ) / rootSurfaceArea;
					const rightProb = computeSurfaceAreaAt( sweepRightBounds, leftCount * 6 ) / rootSurfaceArea;
					const cost = TRAVERSAL_COST + PRIMITIVE_INTERSECT_COST * (
						leftProb * leftCount + rightProb * rightCount
					);

					if ( cost < bestCost ) {

						axis = a;
						bestCost = cost;
						pos = candidate;

					}

				}

			} else {

				// reset the bins
				for ( let i = 0; i < BIN_COUNT; i ++ ) {

					binCounts[ i ] = 0;
					for ( let d = 0; d < 3; d ++ ) {

						binBounds[ i * 6 + d ] = Infinity;
						binBounds[ i * 6 + d + 3 ] = - Infinity;

					}

				}

				// iterate over all center positions
				for ( let c = cStart; c < cEnd; c += 6 ) {

					const triCenter = primitiveBounds[ c + 2 * a ];
					const relativeCenter = triCenter - axisLeft;

					// in the partition function if the centroid lies on the split plane then it is
					// considered to be on the right side of the split
					let binIndex = ~ ~ ( relativeCenter / binWidth );
					if ( binIndex >= BIN_COUNT ) binIndex = BIN_COUNT - 1;

					binCounts[ binIndex ] ++;
					expandBoundsAt( c, primitiveBounds, binBounds, binIndex * 6 );

				}

				// cache the unioned bounds from right to left so we don't have to regenerate them each time
				const last = ( BIN_COUNT - 1 ) * 6;
				for ( let d = 0; d < 6; d ++ ) {

					binRightBounds[ last + d ] = binBounds[ last + d ];

				}

				for ( let i = BIN_COUNT - 2; i >= 0; i -- ) {

					const o = i * 6;
					const next = o + 6;
					for ( let d = 0; d < 3; d ++ ) {

						binRightBounds[ o + d ] = Math.min( binBounds[ o + d ], binRightBounds[ next + d ] );
						binRightBounds[ o + d + 3 ] = Math.max( binBounds[ o + d + 3 ], binRightBounds[ next + d + 3 ] );

					}

				}

				let leftCount = 0;
				for ( let i = 0; i < BIN_COUNT - 1; i ++ ) {

					const o = i * 6;
					const binCount = binCounts[ i ];

					// don't do anything with the bounds if the new bounds have no primitives
					if ( binCount !== 0 ) {

						for ( let d = 0; d < 3; d ++ ) {

							if ( leftCount === 0 ) {

								leftBounds[ d ] = binBounds[ o + d ];
								leftBounds[ d + 3 ] = binBounds[ o + d + 3 ];

							} else {

								leftBounds[ d ] = Math.min( leftBounds[ d ], binBounds[ o + d ] );
								leftBounds[ d + 3 ] = Math.max( leftBounds[ d + 3 ], binBounds[ o + d + 3 ] );

							}

						}

					}

					leftCount += binCount;

					// check the cost of this split
					let leftProb = 0;
					let rightProb = 0;

					if ( leftCount !== 0 ) {

						leftProb = computeSurfaceArea( leftBounds ) / rootSurfaceArea;

					}

					const rightCount = count - leftCount;
					if ( rightCount !== 0 ) {

						rightProb = computeSurfaceAreaAt( binRightBounds, o + 6 ) / rootSurfaceArea;

					}

					const cost = TRAVERSAL_COST + PRIMITIVE_INTERSECT_COST * (
						leftProb * leftCount + rightProb * rightCount
					);

					if ( cost < bestCost ) {

						axis = a;
						bestCost = cost;
						pos = axisLeft + binWidth + i * binWidth;

					}

				}

			}

		}

	} else {

		console.warn( `BVH: Invalid build strategy value ${ strategy } used.` );

	}

	return { axis, pos };

}

// returns the average coordinate on the specified axis of all the provided primitives
function getAverage( primitiveBounds, offset, count, axis ) {

	let avg = 0;
	const boundsOffset = primitiveBounds.offset;
	for ( let i = offset, end = offset + count; i < end; i ++ ) {

		avg += primitiveBounds[ ( i - boundsOffset ) * 6 + axis * 2 ];

	}

	return avg / count;

}
