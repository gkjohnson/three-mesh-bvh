import * as THREE from 'three';
import MeshBVHNode from './MeshBVHNode.js';
import BVHConstructionContext from './BVHConstructionContext.js';
import { arrayToBox, boxToArray } from './Utils/ArrayBoxUtilities.js';

function ensureIndex( geo ) {

	if ( ! geo.index ) {

		const vertexCount = geo.attributes.position.count;
		const index = new ( vertexCount > 65535 ? Uint32Array : Uint16Array )( vertexCount );
		geo.setIndex( new THREE.BufferAttribute( index, 1 ) );

		for ( let i = 0; i < vertexCount; i ++ ) {

			index[ i ] = i;

		}

	}

}

// Computes the set of { offset, count } ranges which need independent BVH roots. Each
// region in the geometry index that belongs to a different set of material groups requires
// a separate BVH root, so that triangles indices belonging to one group never get swapped
// with triangle indices belongs to another group. For example, if the groups were like this:
//
// [-------------------------------------------------------------]
// |__________________|
//   g0 = [0, 20]  |______________________||_____________________|
//                      g1 = [16, 40]           g2 = [41, 60]
//
// we would need four BVH roots: [0, 15], [16, 20], [21, 40], [41, 60].
//
function getRootIndexRanges( geo ) {

	if ( ! geo.groups || ! geo.groups.length ) {

		return [ { offset: 0, count: geo.index.count / 3 } ];

	}

	const ranges = [];
	const rangeBoundaries = new Set();
	for ( const group of geo.groups ) {

		rangeBoundaries.add( group.start );
		rangeBoundaries.add( group.start + group.count );

	}

	// note that if you don't pass in a comparator, it sorts them lexicographically as strings :-(
	const sortedBoundaries = Array.from( rangeBoundaries.values() ).sort( ( a, b ) => a - b );
	for ( let i = 0; i < sortedBoundaries.length - 1; i ++ ) {

		const start = sortedBoundaries[ i ], end = sortedBoundaries[ i + 1 ];
		ranges.push( { offset: ( start / 3 ), count: ( end - start ) / 3 } );

	}
	return ranges;

}


// computes the union of the bounds of all of the given triangles and puts the resulting box in target. If
// centroidTarget is provided then a bounding box is computed for the centroids of the triangles, as well.
// These are computed together to avoid redundant accesses to bounds array.
function getBounds( triangleBounds, offset, count, target, centroidTarget = null ) {

	let minx = Infinity;
	let miny = Infinity;
	let minz = Infinity;
	let maxx = - Infinity;
	let maxy = - Infinity;
	let maxz = - Infinity;

	let cminx = Infinity;
	let cminy = Infinity;
	let cminz = Infinity;
	let cmaxx = - Infinity;
	let cmaxy = - Infinity;
	let cmaxz = - Infinity;

	const includeCentroid = centroidTarget !== null;
	for ( let i = offset * 6, end = ( offset + count ) * 6; i < end; i += 6 ) {

		const cx = triangleBounds[ i + 0 ];
		const hx = triangleBounds[ i + 1 ];
		const lx = cx - hx;
		const rx = cx + hx;
		if ( lx < minx ) minx = lx;
		if ( rx > maxx ) maxx = rx;
		if ( includeCentroid && cx < cminx ) cminx = cx;
		if ( includeCentroid && cx > cmaxx ) cmaxx = cx;

		const cy = triangleBounds[ i + 2 ];
		const hy = triangleBounds[ i + 3 ];
		const ly = cy - hy;
		const ry = cy + hy;
		if ( ly < miny ) miny = ly;
		if ( ry > maxy ) maxy = ry;
		if ( includeCentroid && cy < cminy ) cminy = cy;
		if ( includeCentroid && cy > cmaxy ) cmaxy = cy;

		const cz = triangleBounds[ i + 4 ];
		const hz = triangleBounds[ i + 5 ];
		const lz = cz - hz;
		const rz = cz + hz;
		if ( lz < minz ) minz = lz;
		if ( rz > maxz ) maxz = rz;
		if ( includeCentroid && cz < cminz ) cminz = cz;
		if ( includeCentroid && cz > cmaxz ) cmaxz = cz;

	}

	target[ 0 ] = minx;
	target[ 1 ] = miny;
	target[ 2 ] = minz;

	target[ 3 ] = maxx;
	target[ 4 ] = maxy;
	target[ 5 ] = maxz;

	if ( includeCentroid ) {

		centroidTarget[ 0 ] = cminx;
		centroidTarget[ 1 ] = cminy;
		centroidTarget[ 2 ] = cminz;

		centroidTarget[ 3 ] = cmaxx;
		centroidTarget[ 4 ] = cmaxy;
		centroidTarget[ 5 ] = cmaxz;

	}

}

// A stand alone function for retrieving the centroid bounds.
function getCentroidBounds( triangleCentroids, offset, count, centroidTarget ) {

	let cminx = Infinity;
	let cminy = Infinity;
	let cminz = Infinity;
	let cmaxx = - Infinity;
	let cmaxy = - Infinity;
	let cmaxz = - Infinity;

	for ( let i = offset * 6, end = ( offset + count ) * 6; i < end; i += 6 ) {

		const cx = triangleCentroids[ i + 0 ];
		if ( cx < cminx ) cminx = cx;
		if ( cx > cmaxx ) cmaxx = cx;

		const cy = triangleCentroids[ i + 2 ];
		if ( cy < cminy ) cminy = cy;
		if ( cy > cmaxy ) cmaxy = cy;

		const cz = triangleCentroids[ i + 4 ];
		if ( cz < cminz ) cminz = cz;
		if ( cz > cmaxz ) cmaxz = cz;

	}

	centroidTarget[ 0 ] = cminx;
	centroidTarget[ 1 ] = cminy;
	centroidTarget[ 2 ] = cminz;

	centroidTarget[ 3 ] = cmaxx;
	centroidTarget[ 4 ] = cmaxy;
	centroidTarget[ 5 ] = cmaxz;

}

// returns the average coordinate on the specified axis of the all the provided triangles
export function getAverage( triangleBounds, offset, count, axis ) {

	let avg = 0;
	for ( let i = offset, end = offset + count; i < end; i ++ ) {

		avg += triangleBounds[ i * 6 + axis * 2 ];

	}

	return avg / count;

}

// precomputes the bounding box for each triangle; required for quickly calculating tree splits.
// result is an array of size tris.length * 6 where triangle i maps to a
// [x_center, x_delta, y_center, y_delta, z_center, z_delta] tuple starting at index i * 6,
// representing the center and half-extent in each dimension of triangle i
export function computeTriangleBounds( geo ) {

	const verts = geo.attributes.position.array;
	const index = geo.index.array;
	const triCount = index.length / 3;
	const bounds = new Float32Array( triCount * 6 );

	for ( let tri = 0; tri < triCount; tri ++ ) {

		const ai = index[ 3 * tri + 0 ] * 3;
		const bi = index[ 3 * tri + 1 ] * 3;
		const ci = index[ 3 * tri + 2 ] * 3;

		for ( let el = 0; el < 3; el ++ ) {

			const a = verts[ ai + el ];
			const b = verts[ bi + el ];
			const c = verts[ ci + el ];
			const min = Math.min( a, b, c );
			const max = Math.max( a, b, c );
			const halfExtents = ( max - min ) / 2;
			bounds[ tri * 6 + el * 2 + 0 ] = min + halfExtents;
			bounds[ tri * 6 + el * 2 + 1 ] = halfExtents;

		}

	}

	return bounds;

}

export function buildTree( geo, options ) {

	ensureIndex( geo );

	const ctx = new BVHConstructionContext( geo, options );
	const cacheCentroidBounds = new Float32Array( 6 );
	let reachedMaxDepth = false;

	// either recursively splits the given node, creating left and right subtrees for it, or makes it a leaf node,
	// recording the offset and count of its triangles and writing them into the reordered geometry index.
	const splitNode = ( node, offset, count, centroidBounds = null, depth = 0 ) => {

		if ( depth >= options.maxDepth ) {

			reachedMaxDepth = true;

		}

		// early out if we've met our capacity
		if ( count <= options.maxLeafTris || depth >= options.maxDepth ) {

			node.offset = offset;
			node.count = count;
			return node;

		}

		// Find where to split the volume
		const split = ctx.getOptimalSplit( node.boundingData, centroidBounds, offset, count, options.strategy );
		if ( split.axis === - 1 ) {

			node.offset = offset;
			node.count = count;
			return node;

		}

		const splitOffset = ctx.partition( offset, count, split );

		// create the two new child nodes
		if ( splitOffset === offset || splitOffset === offset + count ) {

			node.offset = offset;
			node.count = count;

		} else {

			node.splitAxis = split.axis;

			// create the left child and compute its bounding box
			const left = node.left = new MeshBVHNode();
			const lstart = offset, lcount = splitOffset - offset;
			left.boundingData = new Float32Array( 6 );
			getBounds( ctx.bounds, lstart, lcount, left.boundingData, cacheCentroidBounds );

			splitNode( left, lstart, lcount, cacheCentroidBounds, depth + 1 );

			// repeat for right
			const right = node.right = new MeshBVHNode();
			const rstart = splitOffset, rcount = count - lcount;
			right.boundingData = new Float32Array( 6 );
			getBounds( ctx.bounds, rstart, rcount, right.boundingData, cacheCentroidBounds );

			splitNode( right, rstart, rcount, cacheCentroidBounds, depth + 1 );

		}

		return node;

	};

	const roots = [];
	const ranges = getRootIndexRanges( geo );

	if ( ranges.length === 1 ) {

		const root = new MeshBVHNode();
		const range = ranges[ 0 ];

		if ( geo.boundingBox != null ) {

			root.boundingData = boxToArray( geo.boundingBox );
			getCentroidBounds( ctx.bounds, range.offset, range.count, cacheCentroidBounds );

		} else {

			root.boundingData = new Float32Array( 6 );
			getBounds( ctx.bounds, range.offset, range.count, root.boundingData, cacheCentroidBounds );

		}

		splitNode( root, range.offset, range.count, cacheCentroidBounds );
		roots.push( root );

	} else {

		for ( let range of ranges ) {

			const root = new MeshBVHNode();
			root.boundingData = new Float32Array( 6 );
			getBounds( ctx.bounds, range.offset, range.count, root.boundingData, cacheCentroidBounds );

			splitNode( root, range.offset, range.count, cacheCentroidBounds );
			roots.push( root );

		}

	}

	if ( reachedMaxDepth && options.verbose ) {

		console.warn( `MeshBVH: Max depth of ${ options.maxDepth } reached when generating BVH. Consider increasing maxDepth.` );
		console.warn( this, geo );

	}

	// if the geometry doesn't have a bounding box, then let's politely populate it using
	// the work we did to determine the BVH root bounds

	if ( geo.boundingBox == null ) {

		const rootBox = new THREE.Box3();
		geo.boundingBox = new THREE.Box3();

		for ( let root of roots ) {

			geo.boundingBox.union( arrayToBox( root.boundingData, rootBox ) );

		}

	}

	return roots;

}
