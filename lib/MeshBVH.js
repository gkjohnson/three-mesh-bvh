import * as THREE from '../node_modules/three/build/three.module.js';
import MeshBVHNode from './MeshBVHNode.js';

import {
	getBufferGeometryVertexElem, getGeometryVertexElem, getLongestEdgeIndex, getAverage,
	shrinkBoundsTo, shrinkSphereTo } from './GeometryUtilities.js';

// Settings
const maxLeafNodes = 10;
const Strategies = {
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

const xyzFields = [ 'x', 'y', 'z' ];

export default
class MeshBVH extends MeshBVHNode {

	static get Strategy() {

		return Strategies;

	}

	constructor( geo, strategy = 0 ) {

		super();

		strategy = Math.max( 0, Math.min( 2, strategy ) );

		if ( geo.isBufferGeometry || geo.isGeometry ) {

			this._root = this._buildTree( geo, strategy );
			this._geometry = geo;

		} else {

			throw new Error( 'Object is not Geometry or BufferGeometry' );

		}

	}


	raycastFirst( mesh, raycaster, ray ) {

		return MeshBVH.raycastFirst( this, mesh, this._geometry, raycaster, ray );

	}

	raycast( mesh, raycaster, ray, intersects, seenFaces ) {

		return MeshBVH.raycast( this, mesh, this._geometry, raycaster, ray, intersects, seenFaces );

	}

	/* Private Functions */
	_buildTree( geo, strategy ) {

		const vertexElem = geo.isBufferGeometry ? getBufferGeometryVertexElem : getGeometryVertexElem;

		// a list of every available triangle index
		const origTris =
			geo.isBufferGeometry
				? new Array( geo.index ? ( geo.index.count / 3 ) : ( geo.attributes.position.count / 3 ) )
				: Array( geo.faces.length );

		for ( let i = 0; i < origTris.length; i ++ ) origTris[ i ] = i;

		// SAH Initialization
		let sahplanes = null;
		if ( strategy === Strategies.SAH ) {

			sahplanes = [ new Array( origTris.length * 2 ), new Array( origTris.length * 2 ), new Array( origTris.length * 2 ) ];
			for ( let i = 0; i < origTris.length; i ++ ) {

				const tri = origTris[ i ];
				const tri2 = tri * 2;

				for ( let el = 0; el < 3; el ++ ) {

					let min = Infinity;
					let max = - Infinity;
					for ( let v = 0; v < 3; v ++ ) {

						const val = vertexElem( geo, tri, v, el );
						min = Math.min( val, min );
						max = Math.max( val, max );

					}

					sahplanes[ el ][ tri2 + 0 ] = { p: min, minSide: true, tri };
					sahplanes[ el ][ tri2 + 1 ] = { p: max, minSide: false, tri };

				}

			}

		}

		const splitStrategy = ( bounds, sphere, avg, tris, geometry ) => {

			let axis = - 1;
			let pos = 0;

			// Center
			if ( strategy === Strategies.CENTER ) {

				axis = getLongestEdgeIndex( bounds );
				const field = xyzFields[ axis ];
				pos = sphere.center[ field ];

			} else if ( strategy === Strategies.AVERAGE ) {

				axis = getLongestEdgeIndex( bounds );
				pos = avg[ xyzFields[ axis ] ];

			} else if ( strategy === Strategies.SAH ) {

				// Surface Area Heuristic
				// In order to make this code more terse, the x, y, and z
				// variables of various structures have been stuffed into
				// 0, 1, and 2 array indices so they can be easily computed
				// and accessed within array iteration

				// Cost values defineed for operations. We're using bounds for traversal, so
				// the cost of traversing one more layer is more than intersecting a triangle.
				const TRAVERSAL_COST = 3;
				const INTERSECTION_COST = 1;

				// Define the width, height, and depth of the bounds as a box
				const dim = [
					bounds.max.x - bounds.min.x,
					bounds.max.y - bounds.min.y,
					bounds.max.z - bounds.min.z
				];
				const sa = 2 * ( dim[ 0 ] * dim[ 1 ] + dim[ 0 ] * dim[ 2 ] + dim[ 1 ] * dim[ 2 ] );

				// Get the precalculated planes based for the triangles we're
				// testing here
				const filteredLists = [[], [], []];
				tris.forEach( t => {

					const t2 = t * 2;

					for ( let i = 0; i < 3; i ++ ) {

						filteredLists[ i ].push( sahplanes[ i ][ t2 + 0 ] );
						filteredLists[ i ].push( sahplanes[ i ][ t2 + 1 ] );

					}

				} );
				filteredLists.forEach( planes => planes.sort( ( a, b ) => a.p - b.p ) );

				// this bounds surface area, left bound SA, left triangles, right bound SA, right triangles
				const getCost = ( sa, sal, nl, sar, nr ) =>
					TRAVERSAL_COST + INTERSECTION_COST * ( ( sal / sa ) * nl + ( sar / sa ) * nr );

				// the cost of _not_ splitting into smaller bounds
				const noSplitCost = INTERSECTION_COST * tris.length;

				axis = - 1;
				let bestCost = noSplitCost;
				for ( let i = 0; i < 3; i ++ ) {

					// o1 and o2 represent the _other_ two axes in the
					// the space. So if we're checking the x (0) dimension,
					// then o1 and o2 would be y and z (1 and 2)
					const o1 = ( i + 1 ) % 3;
					const o2 = ( i + 2 ) % 3;

					const bmin = bounds.min[ xyzFields[ i ] ];
					const bmax = bounds.max[ xyzFields[ i ] ];
					const planes = filteredLists[ i ];

					// The number of left and right triangles on either side
					// given the current split
					let nl = 0;
					let nr = tris.length;
					for ( let p = 0; p < planes.length; p ++ ) {

						const pinfo = planes[ p ];

						// As the plane moves, we have to increment or decrement the
						// number of triangles on either side of the plane
						nl += pinfo.minSide ? 1 : 0;
						nr -= ! pinfo.minSide ? 1 : 0;

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
						const o1planes = sahplanes[o1];
						const o2planes = sahplanes[o2];
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

		};

		// use a queue to run the node creation functions
		// because otherwise we run the risk of a stackoverflow
		// In the case of buffer geometry it also seems to be
		// faster than recursing
		const avgtemp = new THREE.Vector3();
		const vectemp = new THREE.Vector3();
		const queue = [];
		const createNode = ( tris, bb, newNode ) => {

			const node = newNode || new MeshBVHNode();

			// get the bounds of the triangles
			node.boundingBox = bb;

			// Create the bounding sphere with the minium radius
			// It's possible that the bounds sphere will have a smaller
			// radius because the bounds do not encapsulate full triangles
			// on an edge
			node.boundingSphere = new THREE.Sphere();
			bb.getCenter( node.boundingSphere.center );
			node.boundingSphere.radius = vectemp.subVectors( bb.max, node.boundingSphere.center ).length();
			shrinkSphereTo( tris, node.boundingSphere, geo, vertexElem );

			// early out wif we've met our capacity
			if ( tris.length <= maxLeafNodes ) {

				node.tris = tris;
				return node;

			}

			// Find where to split the volume
			getAverage( tris, avgtemp, geo, vertexElem );
			const split = splitStrategy( node.boundingBox, node.boundingSphere, avgtemp, tris, geo );
			if ( split.axis === - 1 ) {

				node.tris = tris;
				return node;

			}

			// Collect the nodes for either side
			const left = [];
			const right = [];
			let sharedCount = 0;
			for ( let i = 0; i < tris.length; i ++ ) {

				const tri = tris[ i ];

				let inLeft = false;
				let inRight = false;

				for ( let v = 0; v < 3; v ++ ) {

					const val = vertexElem( geo, tri, v, split.axis );

					inLeft = inLeft || val <= split.pos;
					inRight = inRight || val >= split.pos;

				}

				if ( inLeft ) left.push( tri );
				if ( inRight ) right.push( tri );
				if ( inLeft && inRight ) sharedCount ++;

			}

			// create the two new child nodes
			if ( ! left.length || ! right.length || right.length === sharedCount || left.length === sharedCount ) {

				node.tris = tris;

			} else {

				// create the bounds for the left child, keeping it within
				// the bounds of the parent and split plane
				const bl = new THREE.Box3().copy( bb );
				bl.max[ xyzFields[ split.axis ] ] = split.pos;
				shrinkBoundsTo( left, bl, geo, vertexElem );
				queue.push( () => node.children.push( createNode( left, bl ) ) );

				// repeat for right
				const br = new THREE.Box3().copy( bb );
				br.min[ xyzFields[ split.axis ] ] = split.pos;
				shrinkBoundsTo( right, br, geo, vertexElem );
				queue.push( () => node.children.push( createNode( right, br ) ) );

			}

			return node;

		};

		if ( ! geo.boundingBox ) geo.computeBoundingBox();

		const n = createNode( origTris, ( new THREE.Box3() ).copy( geo.boundingBox ), this );
		while ( queue.length ) queue.pop()();
		return n;

	}

}
