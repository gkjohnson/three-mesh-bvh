import { getBounds } from './computeBoundsUtils.js';
import { getOptimalSplit } from './splitUtils.js';
import { getLongestEdgeIndex } from '../../utils/ArrayBoxUtilities.js';
import { BVHNode } from '../BVHNode.js';
import { BYTES_PER_NODE } from '../Constants.js';

import { partition } from './sortUtils.js';
import { countNodes, populateBuffer } from './buildUtils.js';

export function buildTree( bvh, primitiveBounds, offset, count, options, loadRange ) {

	// expand variables
	const {
		maxDepth,
		verbose,
		targetLeafSize,
		_strictLeafSize = Infinity,
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

		// A hard guarantee that no leaf exceeds "_strictLeafSize" primitives. When this node is over
		// that limit it must keep splitting regardless of the heuristic.
		const mustSplit = count > _strictLeafSize;

		// early out if we've met our capacity - unless the strict guarantee still requires a split
		if ( ( count <= targetLeafSize && ! mustSplit ) || depth >= maxDepth ) {

			triggerProgress( offset + count );
			node.offset = offset;
			node.count = count;
			return node;

		}

		// Find where to split the volume
		const split = getOptimalSplit( node.boundingData, centroidBoundingData, primitiveBounds, offset, count, strategy );
		let splitOffset = split.axis === - 1 ? - 1 : partition( partitionBuffer, partitionStride, primitiveBounds, offset, count, split );

		// If the heuristic can't produce a usable split then make a leaf unless the strict guarantee requires the split -
		// in which case force an arbitrary median split. The axis comes from the node bounds so parallel and serial
		// builds produce identical trees.
		if ( split.axis === - 1 || splitOffset === offset || splitOffset === offset + count ) {

			if ( ! mustSplit ) {

				triggerProgress( offset + count );
				node.offset = offset;
				node.count = count;
				return node;

			}

			split.axis = Math.max( 0, getLongestEdgeIndex( node.boundingData ) );
			splitOffset = offset + Math.max( 1, Math.floor( count / 2 ) );

		}

		// create the two new child nodes
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

		return node;

	}

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
