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
			ctx.getBounds( lstart, lcount, left.boundingData, cacheCentroidBounds );

			splitNode( left, lstart, lcount, cacheCentroidBounds, depth + 1 );

			// repeat for right
			const right = node.right = new MeshBVHNode();
			const rstart = splitOffset, rcount = count - lcount;
			right.boundingData = new Float32Array( 6 );
			ctx.getBounds( rstart, rcount, right.boundingData, cacheCentroidBounds );

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
			ctx.getCentroidBounds( range.offset, range.count, cacheCentroidBounds );

		} else {

			root.boundingData = new Float32Array( 6 );
			ctx.getBounds( range.offset, range.count, root.boundingData, cacheCentroidBounds );

		}

		splitNode( root, range.offset, range.count, cacheCentroidBounds );
		roots.push( root );

	} else {

		for ( let range of ranges ) {

			const root = new MeshBVHNode();
			root.boundingData = new Float32Array( 6 );
			ctx.getBounds( range.offset, range.count, root.boundingData, cacheCentroidBounds );

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
