import { ensureIndex, getFullGeometryRange, getRootIndexRanges, getTriCount } from './geometryUtils.js';
import { getBounds, computeTriangleBounds } from './computeBoundsUtils.js';
import { getOptimalSplit } from './splitUtils.js';
import { MeshBVHNode } from '../MeshBVHNode.js';
import { BYTES_PER_NODE } from '../Constants.js';

import { partition } from './sortUtils.generated.js';
import { partition_indirect } from './sortUtils_indirect.generated.js';
import { countNodes, populateBuffer } from './buildUtils.js';

// construct a new buffer that points to the set of triangles represented by the given ranges
export function generateIndirectBuffer( geometry, useSharedArrayBuffer, ranges ) {

	const triCount = ( geometry.index ? geometry.index.count : geometry.attributes.position.count ) / 3;
	const useUint32 = triCount > 2 ** 16;

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

export function buildTree( bvh, triangleBounds, offset, count, options ) {

	// expand variables
	const {
		maxDepth,
		verbose,
		maxLeafTris,
		strategy,
		onProgress,
		indirect,
	} = options;
	const indirectBuffer = bvh._indirectBuffer;
	const geometry = bvh.geometry;
	const indexArray = geometry.index ? geometry.index.array : null;
	const partionFunc = indirect ? partition_indirect : partition;

	// generate intermediate variables
	const totalTriangles = getTriCount( geometry );
	const cacheCentroidBoundingData = new Float32Array( 6 );
	let reachedMaxDepth = false;

	const root = new MeshBVHNode();
	getBounds( triangleBounds, offset, count, root.boundingData, cacheCentroidBoundingData );
	splitNode( root, offset, count, cacheCentroidBoundingData );
	return root;

	function triggerProgress( trianglesProcessed ) {

		if ( onProgress ) {

			onProgress( trianglesProcessed / totalTriangles );

		}

	}

	// either recursively splits the given node, creating left and right subtrees for it, or makes it a leaf node,
	// recording the offset and count of its triangles and writing them into the reordered geometry index.
	function splitNode( node, offset, count, centroidBoundingData = null, depth = 0 ) {

		if ( ! reachedMaxDepth && depth >= maxDepth ) {

			reachedMaxDepth = true;
			if ( verbose ) {

				console.warn( `MeshBVH: Max depth of ${ maxDepth } reached when generating BVH. Consider increasing maxDepth.` );
				console.warn( geometry );

			}

		}

		// early out if we've met our capacity
		if ( count <= maxLeafTris || depth >= maxDepth ) {

			triggerProgress( offset + count );
			node.offset = offset;
			node.count = count;
			return node;

		}

		// Find where to split the volume
		const split = getOptimalSplit( node.boundingData, centroidBoundingData, triangleBounds, offset, count, strategy );
		if ( split.axis === - 1 ) {

			triggerProgress( offset + count );
			node.offset = offset;
			node.count = count;
			return node;

		}

		const splitOffset = partionFunc( indirectBuffer, indexArray, triangleBounds, offset, count, split );

		// create the two new child nodes
		if ( splitOffset === offset || splitOffset === offset + count ) {

			triggerProgress( offset + count );
			node.offset = offset;
			node.count = count;

		} else {

			node.splitAxis = split.axis;

			// create the left child and compute its bounding box
			const left = new MeshBVHNode();
			const lstart = offset;
			const lcount = splitOffset - offset;
			node.left = left;

			getBounds( triangleBounds, lstart, lcount, left.boundingData, cacheCentroidBoundingData );
			splitNode( left, lstart, lcount, cacheCentroidBoundingData, depth + 1 );

			// repeat for right
			const right = new MeshBVHNode();
			const rstart = splitOffset;
			const rcount = count - lcount;
			node.right = right;

			getBounds( triangleBounds, rstart, rcount, right.boundingData, cacheCentroidBoundingData );
			splitNode( right, rstart, rcount, cacheCentroidBoundingData, depth + 1 );

		}

		return node;

	}

}

export function buildPackedTree( bvh, options ) {

	const BufferConstructor = options.useSharedArrayBuffer ? SharedArrayBuffer : ArrayBuffer;
	const geometry = bvh.geometry;
	let triangleBounds, geometryRanges;
	if ( options.indirect ) {

		// construct an buffer that is indirectly sorts the triangles used for the BVH
		const ranges = getRootIndexRanges( geometry, options.range );
		const indirectBuffer = generateIndirectBuffer( geometry, options.useSharedArrayBuffer, ranges );
		bvh._indirectBuffer = indirectBuffer;
		triangleBounds = computeTriangleBounds( geometry, 0, indirectBuffer.length, indirectBuffer );
		geometryRanges = [ { offset: 0, count: indirectBuffer.length } ];

	} else {

		ensureIndex( geometry, options );

		const fullRange = getFullGeometryRange( geometry, options.range )[ 0 ];
		triangleBounds = computeTriangleBounds( geometry, fullRange.offset, fullRange.count );
		geometryRanges = getRootIndexRanges( geometry, options.range );

	}

	// Build BVH roots
	bvh._roots = geometryRanges.map( range => {

		const root = buildTree( bvh, triangleBounds, range.offset, range.count, options );
		const nodeCount = countNodes( root );
		const buffer = new BufferConstructor( BYTES_PER_NODE * nodeCount );
		populateBuffer( 0, root, buffer );
		return buffer;

	} );

}
