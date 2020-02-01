import * as THREE from 'three';
import { arrayToBox, getLongestEdgeIndex } from './Utils/ArrayBoxUtilities.js';
import { CENTER, AVERAGE, SAH } from './Constants.js';
import { computeBounds, getAverage } from './buildFunctions.js';

const xyzFields = [ 'x', 'y', 'z' ];

const boxtemp = new THREE.Box3();

export default class BVHConstructionContext {

	constructor( geo, options ) {

		this.geo = geo;
		this.options = options;
		this.bounds = computeBounds( geo );

		// SAH Initialization
		this.sahplanes = null;
		if ( options.strategy === SAH ) {

			const triCount = geo.index.count / 3;
			this.sahplanes = [ new Array( triCount ), new Array( triCount ), new Array( triCount ) ];
			for ( let tri = 0; tri < triCount; tri ++ ) {

				for ( let el = 0; el < 3; el ++ ) {

					this.sahplanes[ el ][ tri ] = { p: this.bounds[ tri * 6 + el * 2 ], tri };

				}

			}

		}

	}

	// reorders `tris` such that for `count` elements after `offset`, elements on the left side of the split
	// will be on the left and elements on the right side of the split will be on the right. returns the index
	// of the first element on the right side, or offset + count if there are no elements on the right side.
	partition( offset, count, split ) {

		let left = offset;
		let right = offset + count - 1;
		const pos = split.pos;
		const axisOffset = split.axis * 2;
		const index = this.geo.index.array;
		const bounds = this.bounds;
		const sahplanes = this.sahplanes;

		// hoare partitioning, see e.g. https://en.wikipedia.org/wiki/Quicksort#Hoare_partition_scheme
		while ( true ) {

			while ( left <= right && bounds[ left * 6 + axisOffset ] < pos ) {

				left ++;

			}

			while ( left <= right && bounds[ right * 6 + axisOffset ] >= pos ) {

				right --;

			}

			if ( left < right ) {

				// we need to swap all of the information associated with the triangles at index
				// left and right; that's the verts in the geometry index, the bounds,
				// and perhaps the SAH planes

				for ( let i = 0; i < 3; i ++ ) {

					let t0 = index[ left * 3 + i ];
					index[ left * 3 + i ] = index[ right * 3 + i ];
					index[ right * 3 + i ] = t0;
					let t1 = bounds[ left * 6 + i * 2 + 0 ];
					bounds[ left * 6 + i * 2 + 0 ] = bounds[ right * 6 + i * 2 + 0 ];
					bounds[ right * 6 + i * 2 + 0 ] = t1;
					let t2 = bounds[ left * 6 + i * 2 + 1 ];
					bounds[ left * 6 + i * 2 + 1 ] = bounds[ right * 6 + i * 2 + 1 ];
					bounds[ right * 6 + i * 2 + 1 ] = t2;

				}

				if ( sahplanes ) {

					for ( let i = 0; i < 3; i ++ ) {

						let t = sahplanes[ i ][ left ];
						sahplanes[ i ][ left ] = sahplanes[ i ][ right ];
						sahplanes[ i ][ right ] = t;

					}

				}

				left ++;
				right --;

			} else {

				return left;

			}

		}

	}

	getOptimalSplit( bounds, centroidBounds, offset, count, strategy ) {

		let axis = - 1;
		let pos = 0;

		// Center
		if ( strategy === CENTER ) {

			axis = getLongestEdgeIndex( centroidBounds );
			if ( axis !== - 1 ) {

				pos = ( centroidBounds[ axis ] + centroidBounds[ axis + 3 ] ) / 2;

			}

		} else if ( strategy === AVERAGE ) {

			axis = getLongestEdgeIndex( bounds );
			if ( axis !== - 1 ) {

				pos = getAverage( this.bounds, offset, count, axis );

			}

		} else if ( strategy === SAH ) {

			// Surface Area Heuristic
			// In order to make this code more terse, the x, y, and z
			// variables of various structures have been stuffed into
			// 0, 1, and 2 array indices so they can be easily computed
			// and accessed within array iteration

			// Cost values defineed for operations. We're using bounds for traversal, so
			// the cost of traversing one more layer is more than intersecting a triangle.
			const TRAVERSAL_COST = 3;
			const INTERSECTION_COST = 1;
			const bb = arrayToBox( bounds, boxtemp );

			// Define the width, height, and depth of the bounds as a box
			const dim = [
				bb.max.x - bb.min.x,
				bb.max.y - bb.min.y,
				bb.max.z - bb.min.z
			];
			const sa = 2 * ( dim[ 0 ] * dim[ 1 ] + dim[ 0 ] * dim[ 2 ] + dim[ 1 ] * dim[ 2 ] );

			// Get the precalculated planes based for the triangles we're
			// testing here
			const filteredLists = [[], [], []];
			for ( let i = offset, end = offset + count; i < end; i ++ ) {

				for ( let v = 0; v < 3; v ++ ) {

					filteredLists[ v ].push( this.sahplanes[ v ][ i ] );

				}

			}
			filteredLists.forEach( planes => planes.sort( ( a, b ) => a.p - b.p ) );

			// this bounds surface area, left bound SA, left triangles, right bound SA, right triangles
			const getCost = ( sa, sal, nl, sar, nr ) =>
				  TRAVERSAL_COST + INTERSECTION_COST * ( ( sal / sa ) * nl + ( sar / sa ) * nr );

			// the cost of _not_ splitting into smaller bounds
			const noSplitCost = INTERSECTION_COST * count;

			axis = - 1;
			let bestCost = noSplitCost;
			for ( let i = 0; i < 3; i ++ ) {

				// o1 and o2 represent the _other_ two axes in the
				// the space. So if we're checking the x (0) dimension,
				// then o1 and o2 would be y and z (1 and 2)
				const o1 = ( i + 1 ) % 3;
				const o2 = ( i + 2 ) % 3;

				const bmin = bb.min[ xyzFields[ i ] ];
				const bmax = bb.max[ xyzFields[ i ] ];
				const planes = filteredLists[ i ];

				// The number of left and right triangles on either side
				// given the current split
				let nl = 0;
				let nr = count;
				for ( let p = 0; p < planes.length; p ++ ) {

					const pinfo = planes[ p ];

					// As the plane moves, we have to increment or decrement the
					// number of triangles on either side of the plane
					nl ++;
					nr --;

					// the distance from the plane to the edge of the broader bounds
					const ldim = pinfo.p - bmin;
					const rdim = bmax - pinfo.p;

					// same for the other two dimensions
					let ldimo1 = dim[ o1 ], rdimo1 = dim[ o1 ];
					let ldimo2 = dim[ o2 ], rdimo2 = dim[ o2 ];

					/*
					// compute the other bounding planes for the box
					// if only the current triangles are considered to
					// be in the box
					// This is really slow and probably not really worth it
					const o1planes = this.sahplanes[o1];
					const o2planes = this.sahplanes[o2];
					let lmin = Infinity, lmax = -Infinity;
					let rmin = Infinity, rmax = -Infinity;
					planes.forEach((p, i) => {
					const tri2 = p.tri * 2;
					const inf1 = o1planes[tri2 + 0];
					const inf2 = o1planes[tri2 + 1];
					if (i <= nl) {
					lmin = Math.min(inf1.p, inf2.p, lmin);
					lmax = Math.max(inf1.p, inf2.p, lmax);
					}
					if (i >= nr) {
					rmin = Math.min(inf1.p, inf2.p, rmin);
					rmax = Math.max(inf1.p, inf2.p, rmax);
					}
					})
					ldimo1 = Math.min(lmax - lmin, ldimo1);
					rdimo1 = Math.min(rmax - rmin, rdimo1);

					planes.forEach((p, i) => {
					const tri2 = p.tri * 2;
					const inf1 = o2planes[tri2 + 0];
					const inf2 = o2planes[tri2 + 1];
					if (i <= nl) {
					lmin = Math.min(inf1.p, inf2.p, lmin);
					lmax = Math.max(inf1.p, inf2.p, lmax);
					}
					if (i >= nr) {
					rmin = Math.min(inf1.p, inf2.p, rmin);
					rmax = Math.max(inf1.p, inf2.p, rmax);
					}
					})
					ldimo2 = Math.min(lmax - lmin, ldimo2);
					rdimo2 = Math.min(rmax - rmin, rdimo2);
					*/

					// surface areas and cost
					const sal = 2 * ( ldimo1 * ldimo2 + ldimo1 * ldim + ldimo2 * ldim );
					const sar = 2 * ( rdimo1 * rdimo2 + rdimo1 * rdim + rdimo2 * rdim );
					const cost = getCost( sa, sal, nl, sar, nr );

					if ( cost < bestCost ) {

						axis = i;
						pos = pinfo.p;
						bestCost = cost;

					}

				}

			}

		}

		return { axis, pos };

	}

}
