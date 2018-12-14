import * as THREE from '../node_modules/three/build/three.module.js';
import { getLongestEdgeIndex } from './GeometryUtilities.js';

const abcFields = [ 'a', 'b', 'c' ];
const xyzFields = [ 'x', 'y', 'z' ];

// TODO: This could probably be optimizied to not dig so deeply into an object
// and reust some of the fetch values in some cases
const getBufferGeometryVertexElem = ( geo, tri, vert, elem ) => {

	return geo.attributes.position.array[ ( geo.index ? geo.index.array[ 3 * tri + vert ] : ( 3 * tri + vert ) ) * 3 + elem ];

};

// TODO: This function seems significantly slower than
// before when we were had custom bounds functions
const getGeometryVertexElem = ( geo, tri, vert, elem ) => {

	return geo.vertices[ geo.faces[ tri ][ abcFields[ vert ] ] ][ xyzFields[ elem ] ];

};

const SplitStrategy = {
	get CENTER() {

		return 0;

	},
	get AVERAGE() {

		return 1;

	},
	get SAH() {

		return 2;

	}
};

const avgtemp = new THREE.Vector3();
const centertemp = new THREE.Vector3();

export default class BVHConstructionContext {


	constructor( geo, options ) {

		this.options = options;
		this.vertexElem = geo.isBufferGeometry ? getBufferGeometryVertexElem : getGeometryVertexElem;

		// a list of every available triangle index
		this.tris =
			geo.isBufferGeometry
				? new Array( geo.index ? ( geo.index.count / 3 ) : ( geo.attributes.position.count / 3 ) )
				: Array( geo.faces.length );

		for ( let i = 0; i < this.tris.length; i ++ ) this.tris[ i ] = i;

		this.geo = geo;
		this.centroids = this.computeCentroids();
		this.bounds = this.computeBounds();

		// SAH Initialization
		this.sahplanes = null;
		if ( options.strategy === SplitStrategy.SAH ) {

			this.sahplanes = [ new Array( this.tris.length ), new Array( this.tris.length ), new Array( this.tris.length ) ];
			for ( let i = 0; i < this.tris.length; i ++ ) {

				const tri = this.tris[ i ];

				for ( let el = 0; el < 3; el ++ ) {

					this.sahplanes[ el ][ tri ] = { p: this.centroids[ tri * 3 + el ], tri };

				}

			}

		}

	}

	// returns an array of size tris.length * 6 where triangle i maps to a
	// [x_min, x_max, y_min, y_max, z_min, z_max] tuple starting at index i * 6,
	// representing the minimum and maximum extent in each dimension of triangle i
	computeBounds() {

		const geo = this.geo;
		const tris = this.tris;
		const result = new Array( tris.length * 6 );

		for ( let i = 0, l = tris.length; i < l; i ++ ) {

			const tri = tris[ i ];

			for ( let el = 0; el < 3; el ++ ) {

				const a = this.vertexElem( geo, tri, 0, el );
				const b = this.vertexElem( geo, tri, 1, el );
				const c = this.vertexElem( geo, tri, 2, el );
				result[ i * 6 + el * 2 ] = Math.min( a, b, c );
				result[ i * 6 + el * 2 + 1 ] = Math.max( a, b, c );

			}

		}

		return result;

	}

	// returns an array of size tris.length * 3 where triangle i maps to an [x, y, z] triplet
	// starting at index i * 3, representing the centroid of triangle i
	computeCentroids() {

		const geo = this.geo;
		const tris = this.tris;
		const result = new Array( tris.length * 3 );

		for ( let i = 0, l = tris.length; i < l; i ++ ) {

			const tri = tris[ i ];

			for ( let el = 0; el < 3; el ++ ) {

				const a = this.vertexElem( geo, tri, 0, el );
				const b = this.vertexElem( geo, tri, 1, el );
				const c = this.vertexElem( geo, tri, 2, el );
				result[ i * 3 + el ] = ( a + b + c ) / 3;

			}

		}

		return result;

	}

	// returns the average point of the all the provided
	// triangles in the geometry
	getAverage( offset, count, avg ) {

		let avgx = 0;
		let avgy = 0;
		let avgz = 0;
		const centroids = this.centroids;
		const tris = this.tris;

		for ( let i = offset; i < offset + count; i ++ ) {

			const tri = tris[ i ];

			avgx += centroids[ tri * 3 + 0 ];
			avgy += centroids[ tri * 3 + 1 ];
			avgz += centroids[ tri * 3 + 2 ];

		}

		avg.x = avgx / ( count * 3 );
		avg.y = avgy / ( count * 3 );
		avg.z = avgz / ( count * 3 );

	}

	// shrinks the provided bounds on any dimensions to fit
	// the provided triangles
	shrinkBoundsTo( offset, count, target ) {

		let minx = Infinity;
		let miny = Infinity;
		let minz = Infinity;
		let maxx = - Infinity;
		let maxy = - Infinity;
		let maxz = - Infinity;
		const bounds = this.bounds;
		const tris = this.tris;

		for ( let i = offset; i < offset + count; i ++ ) {

			const tri = tris[ i ];

			minx = Math.min( minx, bounds[ tri * 6 + 0 ] );
			maxx = Math.max( maxx, bounds[ tri * 6 + 1 ] );
			miny = Math.min( miny, bounds[ tri * 6 + 2 ] );
			maxy = Math.max( maxy, bounds[ tri * 6 + 3 ] );
			minz = Math.min( minz, bounds[ tri * 6 + 4 ] );
			maxz = Math.max( maxz, bounds[ tri * 6 + 5 ] );

		}

		target.min.x = Math.max( minx, target.min.x );
		target.min.y = Math.max( miny, target.min.y );
		target.min.z = Math.max( minz, target.min.z );

		target.max.x = Math.min( maxx, target.max.x );
		target.max.y = Math.min( maxy, target.max.y );
		target.max.z = Math.min( maxz, target.max.z );

	}

	// writes entries into a new geometry index (target) with the vertices of triangles from
	// offset through count
	writeReorderedIndices ( offset, count, target ) {

		const tris = this.tris;
		const oldIndices = this.geo.index ? this.geo.index.array : null;

		for (let i = offset; i < offset + count; i++) {

			const oldTri = tris[i];
			target[ 3 * i + 0 ] = oldIndices ? oldIndices[3 * oldTri + 0] : 3 * oldTri + 0;
			target[ 3 * i + 1 ] = oldIndices ? oldIndices[3 * oldTri + 1] : 3 * oldTri + 1;
			target[ 3 * i + 2 ] = oldIndices ? oldIndices[3 * oldTri + 2] : 3 * oldTri + 1;

		}

	}

	// reorders `tris` such that for `count` elements after `offset`, elements on the left side of the split
	// will be on the left and elements on the right side of the split will be on the right. returns the index
	// of the first element on the right side, or offset + count if there are no elements on the right side.
	partition ( offset, count, split ) {

		let left = offset;
		let right = offset + count - 1;
		const pos = split.pos;
		const axis = split.axis;
		const tris = this.tris;

		// hoare partitioning, see e.g. https://en.wikipedia.org/wiki/Quicksort#Hoare_partition_scheme
		while ( left <= right ) {

			while ( this.centroids[ tris[left] * 3 + axis ] < pos ) {

				left++;

			}

			while ( this.centroids[ tris[right] * 3 + axis ] >= pos ) {

				right--;

			}

			if ( left <= right ) {

				let tmp = tris[left];
				tris[left] = tris[right];
				tris[right] = tmp;
				left++;
				right--;

			}

		}

		return left;

	}

	getOptimalSplit( bb, offset, count, strategy ) {

		let axis = - 1;
		let pos = 0;

		// Center
		if ( strategy === SplitStrategy.CENTER ) {

			axis = getLongestEdgeIndex( bb );
			bb.getCenter( centertemp );
			pos = centertemp[ xyzFields[ axis ] ];

		} else if ( strategy === SplitStrategy.AVERAGE ) {

			axis = getLongestEdgeIndex( bb );
			this.getAverage( offset, count, avgtemp );
			pos = avgtemp[ xyzFields[ axis ] ];

		} else if ( strategy === SplitStrategy.SAH ) {

			// Surface Area Heuristic
			// In order to make this code more terse, the x, y, and z
			// variables of various structures have been stuffed into
			// 0, 1, and 2 array indices so they can be easily computed
			// and accessed within array iteration

			// Cost values defineed for operations. We're using bounds for traversal, so
			// the cost of traversing one more layer is more than intersecting a triangle.
			const TRAVERSAL_COST = 3;
			const INTERSECTION_COST = 1;
			const tris = this.tris;

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
			for ( let i = offset; i < offset + count; i ++ ) {

				let t = tris[ i ];
				for ( let v = 0; v < 3; v ++ ) {

					filteredLists[ v ].push( this.sahplanes[ v ][ t ] );

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
