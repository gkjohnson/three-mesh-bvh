import { getBounds } from './computeBoundsUtils.js';
import { getOptimalSplit } from './splitUtils.js';
import { BVHNode } from '../BVHNode.js';
import { BYTES_PER_NODE } from '../Constants.js';

import { partition } from './sortUtils.js';
import { countNodes, populateBuffer } from './buildUtils.js';

export function buildTree( bvh, primitiveBounds, offset, count, options, loadRange ) {

	// expand variables
	const {
		maxDepth,
		verbose,
		maxLeafSize,
		strategy,
		onProgress,
	} = options;

	const partitionBuffer = bvh.primitiveBuffer;
	const partitionStride = bvh.primitiveBufferStride;

	// generate intermediate variables
	const cacheCentroidBoundingData = new Float32Array( 6 );
	let reachedMaxDepth = false;

	const root = new BVHNode();
	getBounds( primitiveBounds, offset, count, root.boundingData, cacheCentroidBoundingData );
	splitNode( root, offset, count, cacheCentroidBoundingData );
	return root;

	function triggerProgress( primitivesProcessed ) {

		if ( onProgress ) {

			onProgress( ( primitivesProcessed - loadRange.offset ) / loadRange.count );

		}

	}

	// either recursively splits the given node, creating left and right subtrees for it, or makes it a leaf node,
	// recording the offset and count of its primitives and writing them into the reordered geometry index.
	function splitNode( node, offset, count, centroidBoundingData = null, depth = 0 ) {

		if ( ! reachedMaxDepth && depth >= maxDepth ) {

			reachedMaxDepth = true;
			if ( verbose ) {

				console.warn( `BVH: Max depth of ${ maxDepth } reached when generating BVH. Consider increasing maxDepth.` );

			}

		}

		// early out if we've met our capacity
		if ( count <= maxLeafSize || depth >= maxDepth ) {

			finalizeLeaf( node, offset, count, depth );
			return node;

		}

		// Find where to split the volume
		const split = getOptimalSplit( node.boundingData, centroidBoundingData, primitiveBounds, offset, count, strategy );
		if ( split.axis === - 1 ) {

			finalizeLeaf( node, offset, count, depth );
			return node;

		}

		const splitOffset = partition( partitionBuffer, partitionStride, primitiveBounds, offset, count, split );

		// create the two new child nodes
		if ( splitOffset === offset || splitOffset === offset + count ) {

			finalizeLeaf( node, offset, count, depth );

		} else {

			node.splitAxis = split.axis;

			// create the left child and compute its bounding box
			const left = new BVHNode();
			const lstart = offset;
			const lcount = splitOffset - offset;
			node.left = left;

			getBounds( primitiveBounds, lstart, lcount, left.boundingData, cacheCentroidBoundingData );
			splitNode( left, lstart, lcount, cacheCentroidBoundingData, depth + 1 );

			// repeat for right
			const right = new BVHNode();
			const rstart = splitOffset;
			const rcount = count - lcount;
			node.right = right;

			getBounds( primitiveBounds, rstart, rcount, right.boundingData, cacheCentroidBoundingData );
			splitNode( right, rstart, rcount, cacheCentroidBoundingData, depth + 1 );

		}

		return node;

	}

	// commits a leaf node, but first gives the bvh a chance to split the range further by primitive
	// type so leaves never mix primitive types. Only runs when the bvh provides "partitionLeafByType".
	function finalizeLeaf( node, offset, count, depth ) {

		if ( bvh.partitionLeaf && count > 1 && depth < maxDepth ) {

			const splitOffset = bvh.partitionLeaf( partitionBuffer, partitionStride, primitiveBounds, offset, count );
			if ( splitOffset > offset && splitOffset < offset + count ) {

				// this split has no spatial meaning, so use the longest axis as a traversal-order hint;
				// the node bounds are what keep traversal correct.
				node.splitAxis = longestAxis( node.boundingData );

				const left = new BVHNode();
				const lcount = splitOffset - offset;
				node.left = left;
				getBounds( primitiveBounds, offset, lcount, left.boundingData, cacheCentroidBoundingData );
				splitNode( left, offset, lcount, cacheCentroidBoundingData, depth + 1 );

				const right = new BVHNode();
				const rcount = count - lcount;
				node.right = right;
				getBounds( primitiveBounds, splitOffset, rcount, right.boundingData, cacheCentroidBoundingData );
				splitNode( right, splitOffset, rcount, cacheCentroidBoundingData, depth + 1 );

				return;

			}

		}

		triggerProgress( offset + count );
		node.offset = offset;
		node.count = count;

	}

}

// returns the index ( 0, 1, 2 ) of the longest axis of a min / max bounding box
function longestAxis( boundingData ) {

	const x = boundingData[ 3 ] - boundingData[ 0 ];
	const y = boundingData[ 4 ] - boundingData[ 1 ];
	const z = boundingData[ 5 ] - boundingData[ 2 ];
	if ( x > y && x > z ) {

		return 0;

	}

	return y > z ? 1 : 2;

}

export function buildPackedTree( bvh, options ) {

	const BufferConstructor = options.useSharedArrayBuffer ? SharedArrayBuffer : ArrayBuffer;

	// get the range of buffer data to construct / arrange
	const rootRanges = bvh.getRootRanges( options.range );
	const firstRange = rootRanges[ 0 ];
	const lastRange = rootRanges[ rootRanges.length - 1 ];
	const fullRange = {
		offset: firstRange.offset,
		count: lastRange.offset + lastRange.count - firstRange.offset,
	};

	// construct the primitive bounds for sorting
	const primitiveBounds = new Float32Array( 6 * fullRange.count );
	primitiveBounds.offset = fullRange.offset;
	bvh.computePrimitiveBounds( fullRange.offset, fullRange.count, primitiveBounds );

	// Build BVH roots
	bvh._roots = rootRanges.map( range => {

		const root = buildTree( bvh, primitiveBounds, range.offset, range.count, options, fullRange );
		const nodeCount = countNodes( root );
		const buffer = new BufferConstructor( BYTES_PER_NODE * nodeCount );
		populateBuffer( 0, root, buffer );
		return buffer;

	} );

}
