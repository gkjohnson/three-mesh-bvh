import { getLongestEdgeIndex, computeSurfaceArea, copyBounds, unionBounds, expandByPrimitiveBounds } from '../../utils/ArrayBoxUtilities.js';
import { CENTER, AVERAGE, SAH, PRIMITIVE_INTERSECT_COST, TRAVERSAL_COST } from '../Constants.js';

const BIN_COUNT = 32;

// nodes with fewer primitives than this test a split at every primitive center instead of binning
const SWEEP_COUNT = BIN_COUNT / 4;

const sahBins = /* @__PURE__ */ new Array( BIN_COUNT ).fill().map( () => {

	return {

		count: 0,
		bounds: new Float32Array( 6 ),
		rightCacheBounds: new Float32Array( 6 ),
		candidate: 0,

	};

} );
const leftBounds = /* @__PURE__ */ new Float32Array( 6 );
const rightBounds = /* @__PURE__ */ new Float32Array( 6 );

// the primitives of a small node ordered along an axis, and the bounds of the tail from each position
const sweepOrder = /* @__PURE__ */ new Int32Array( SWEEP_COUNT );
const sweepRightBounds = /* @__PURE__ */ new Float32Array( SWEEP_COUNT * 6 );

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

					const bin = sahBins[ i ];
					bin.count = 0;
					bin.candidate = axisLeft + binWidth + i * binWidth;

					const bounds = bin.bounds;
					for ( let d = 0; d < 3; d ++ ) {

						bounds[ d ] = Infinity;
						bounds[ d + 3 ] = - Infinity;

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

					const bin = sahBins[ binIndex ];
					bin.count ++;

					expandByPrimitiveBounds( c, primitiveBounds, bin.bounds );

				}

				// cache the unioned bounds from right to left so we don't have to regenerate them each time
				const lastBin = sahBins[ BIN_COUNT - 1 ];
				copyBounds( lastBin.bounds, lastBin.rightCacheBounds );
				for ( let i = BIN_COUNT - 2; i >= 0; i -- ) {

					const bin = sahBins[ i ];
					const nextBin = sahBins[ i + 1 ];
					unionBounds( bin.bounds, nextBin.rightCacheBounds, bin.rightCacheBounds );

				}

				let leftCount = 0;
				for ( let i = 0; i < BIN_COUNT - 1; i ++ ) {

					const bin = sahBins[ i ];
					const binCount = bin.count;
					const bounds = bin.bounds;

					const nextBin = sahBins[ i + 1 ];
					const rightBounds = nextBin.rightCacheBounds;

					// don't do anything with the bounds if the new bounds have no primitives
					if ( binCount !== 0 ) {

						if ( leftCount === 0 ) {

							copyBounds( bounds, leftBounds );

						} else {

							unionBounds( bounds, leftBounds, leftBounds );

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

						rightProb = computeSurfaceArea( rightBounds ) / rootSurfaceArea;

					}

					const cost = TRAVERSAL_COST + PRIMITIVE_INTERSECT_COST * (
						leftProb * leftCount + rightProb * rightCount
					);

					if ( cost < bestCost ) {

						axis = a;
						bestCost = cost;
						pos = bin.candidate;

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
