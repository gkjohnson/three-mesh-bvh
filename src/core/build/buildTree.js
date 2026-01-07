import { ensureIndex } from './geometryUtils.js';
import { getBounds } from './computeBoundsUtils.js';
import { getOptimalSplit } from './splitUtils.js';
import { BVHNode } from '../BVHNode.js';
import { BYTES_PER_NODE } from '../Constants.js';

import { partition } from './sortUtils.js';
import { countNodes, populateBuffer } from './buildUtils.js';

// construct a new buffer that points to the set of triangles represented by the given ranges
export function generateIndirectBuffer( primCount, useSharedArrayBuffer, ranges ) {

	const useUint32 = primCount > 2 ** 16;

	// use getRootIndexRanges which excludes gaps
	const length = ranges.reduce( ( acc, val ) => acc + val.count, 0 );
	const byteCount = useUint32 ? 4 : 2;
	const buffer = useSharedArrayBuffer ? new SharedArrayBuffer( length * byteCount ) : new ArrayBuffer( length * byteCount );
	const indirectBuffer = useUint32 ? new Uint32Array( buffer ) : new Uint16Array( buffer );

	// construct a compact form of the triangles in these ranges
	let index = 0;
	for ( let r = 0; r < ranges.length; r ++ ) {

		const { offset, count } = ranges[ r ];
		for ( let i = 0; i < count; i ++ ) {

			indirectBuffer[ index + i ] = offset + i;

		}

		index += count;

	}

	return indirectBuffer;

}

export function buildTree( bvh, primitiveBounds, offset, count, options ) {

	// expand variables
	const {
		maxDepth,
		verbose,
		maxLeafSize,
		strategy,
		onProgress,
		indirect,
	} = options;
	const indirectBuffer = bvh._indirectBuffer;
	const geometry = bvh.geometry;

	const partitionBuffer = indirect ? indirectBuffer : geometry.index.array;
	const partitionStride = indirect ? 1 : bvh.primitiveStride;

	// generate intermediate variables
	const totalPrimitives = bvh.getPrimitiveCount();
	const cacheCentroidBoundingData = new Float32Array( 6 );
	let reachedMaxDepth = false;

	const root = new BVHNode();
	getBounds( primitiveBounds, offset, count, root.boundingData, cacheCentroidBoundingData );
	splitNode( root, offset, count, cacheCentroidBoundingData );
	return root;

	function triggerProgress( primitivesProcessed ) {

		if ( onProgress ) {

			onProgress( primitivesProcessed / totalPrimitives );

		}

	}

	// either recursively splits the given node, creating left and right subtrees for it, or makes it a leaf node,
	// recording the offset and count of its triangles and writing them into the reordered geometry index.
	function splitNode( node, offset, count, centroidBoundingData = null, depth = 0 ) {

		if ( ! reachedMaxDepth && depth >= maxDepth ) {

			reachedMaxDepth = true;
			if ( verbose ) {

				console.warn( `BVH: Max depth of ${ maxDepth } reached when generating BVH. Consider increasing maxDepth.` );

			}

		}

		// early out if we've met our capacity
		if ( count <= maxLeafSize || depth >= maxDepth ) {

			triggerProgress( offset + count );
			node.offset = offset;
			node.count = count;
			return node;

		}

		// Find where to split the volume
		const split = getOptimalSplit( node.boundingData, centroidBoundingData, primitiveBounds, offset, count, strategy );
		if ( split.axis === - 1 ) {

			triggerProgress( offset + count );
			node.offset = offset;
			node.count = count;
			return node;

		}

		const splitOffset = partition( partitionBuffer, partitionStride, primitiveBounds, offset, count, split );

		// create the two new child nodes
		if ( splitOffset === offset || splitOffset === offset + count ) {

			triggerProgress( offset + count );
			node.offset = offset;
			node.count = count;

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

}

export function buildPackedTree( bvh, options ) {

	const BufferConstructor = options.useSharedArrayBuffer ? SharedArrayBuffer : ArrayBuffer;
	const geometry = bvh.geometry;
	let primitiveBounds, rootRanges;
	if ( options.indirect ) {

		// construct an buffer that is indirectly sorts the triangles used for the BVH
		const ranges = bvh.getRootRanges( options.range );
		const indirectBuffer = generateIndirectBuffer( bvh.getPrimitiveCount(), options.useSharedArrayBuffer, ranges );
		bvh._indirectBuffer = indirectBuffer;

		// store offset on the array for later use & allocate only for the
		// range being computed
		primitiveBounds = new Float32Array( 6 * indirectBuffer.length );
		primitiveBounds.offset = 0;
		bvh.computePrimitiveBounds( 0, indirectBuffer.length, primitiveBounds );

		rootRanges = [ { offset: 0, count: indirectBuffer.length } ];

	} else {

		ensureIndex( geometry, options );

		rootRanges = bvh.getRootRanges( options.range );

		const firstRange = rootRanges[ 0 ];
		const lastRange = rootRanges[ rootRanges.length - 1 ];
		const fullRange = {
			offset: firstRange.offset,
			count: lastRange.offset + lastRange.count - firstRange.offset,
		};

		primitiveBounds = new Float32Array( 6 * fullRange.count );
		primitiveBounds.offset = fullRange.offset;
		bvh.computePrimitiveBounds( fullRange.offset, fullRange.count, primitiveBounds );


	}

	// Build BVH roots
	bvh._roots = rootRanges.map( range => {

		const root = buildTree( bvh, primitiveBounds, range.offset, range.count, options );
		const nodeCount = countNodes( root );
		const buffer = new BufferConstructor( BYTES_PER_NODE * nodeCount );
		populateBuffer( 0, root, buffer );
		return buffer;

	} );

}
