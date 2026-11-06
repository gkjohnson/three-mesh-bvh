import { getBounds } from './computeBoundsUtils.js';
import { getOptimalSplit } from './splitUtils.js';
import { getLongestEdgeIndex } from '../../utils/ArrayBoxUtilities.js';
import { BYTES_PER_NODE, UINT32_PER_NODE, IS_LEAFNODE_FLAG } from '../Constants.js';
import { partition } from './sortUtils.js';

const MAX_POINTER = Math.pow( 2, 32 );

// the bounds and centroid bounds of the node about to be split
const _nodeBounds = /* @__PURE__ */ new Float32Array( 6 );
const _centroidBounds = /* @__PURE__ */ new Float32Array( 6 );

// Builds the tree over the given primitive range directly into a packed node buffer and returns
// it trimmed to the nodes written. Nodes are written depth first, so a left child directly follows
// its parent and the right child is stored as a relative node offset.
//
// pack structure
// boundingData  				: 6 float32
// right / offset 				: 1 uint32
// splitAxis / isLeaf + count 	: 1 uint32 / 2 uint16
export function buildTree( bvh, primitiveBounds, offset, count, options, loadRange ) {

	// expand variables
	const {
		maxDepth,
		verbose,
		targetLeafSize,
		_strictLeafSize = Infinity,
		strategy,
		onProgress,
		useSharedArrayBuffer = false,
	} = options;

	const partitionBuffer = bvh.primitiveBuffer;
	const partitionStride = bvh.primitiveBufferStride;

	// a binary tree with at least one primitive per leaf has at most 2n - 1 nodes. Group ranges that
	// don't line up with triangles give a fractional count.
	const BufferConstructor = useSharedArrayBuffer ? SharedArrayBuffer : ArrayBuffer;
	const buffer = new BufferConstructor( BYTES_PER_NODE * Math.max( 1, 2 * Math.ceil( count ) - 1 ) );
	const float32Array = new Float32Array( buffer );
	const uint32Array = new Uint32Array( buffer );
	const uint16Array = new Uint16Array( buffer );
	let nodeCount = 0;
	let reachedMaxDepth = false;

	getBounds( primitiveBounds, offset, count, _nodeBounds, _centroidBounds );
	splitNode( offset, count, 0 );
	return buffer.slice( 0, nodeCount * BYTES_PER_NODE );

	function triggerProgress( primitivesProcessed ) {

		if ( onProgress ) {

			onProgress( ( primitivesProcessed - loadRange.offset ) / loadRange.count );

		}

	}

	function writeLeaf( node32, offset, count ) {

		const node16 = node32 * 2;
		uint32Array[ node32 + 6 ] = offset;
		uint16Array[ node16 + 14 ] = count;
		uint16Array[ node16 + 15 ] = IS_LEAFNODE_FLAG;
		triggerProgress( offset + count );

	}

	// writes the node whose bounds are in "_nodeBounds" and either recursively splits it, creating left and right
	// subtrees for it, or makes it a leaf node, recording the offset and count of its primitives.
	function splitNode( offset, count, depth ) {

		const nodeIndex = nodeCount ++;
		const node32 = nodeIndex * UINT32_PER_NODE;
		float32Array.set( _nodeBounds, node32 );

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

			writeLeaf( node32, offset, count );
			return;

		}

		// Find where to split the volume
		const split = getOptimalSplit( _nodeBounds, _centroidBounds, primitiveBounds, offset, count, strategy );
		let splitOffset = split.axis === - 1 ? - 1 : partition( partitionBuffer, partitionStride, primitiveBounds, offset, count, split );

		// If the heuristic can't produce a usable split then make a leaf unless the strict guarantee requires the split -
		// in which case force an arbitrary median split. The axis comes from the node bounds so parallel and serial
		// builds produce identical trees.
		if ( split.axis === - 1 || splitOffset === offset || splitOffset === offset + count ) {

			if ( ! mustSplit ) {

				writeLeaf( node32, offset, count );
				return;

			}

			split.axis = Math.max( 0, getLongestEdgeIndex( _nodeBounds ) );
			splitOffset = offset + Math.max( 1, Math.floor( count / 2 ) );

		}

		uint32Array[ node32 + 7 ] = split.axis;

		// the left child directly follows this node
		const leftCount = splitOffset - offset;
		getBounds( primitiveBounds, offset, leftCount, _nodeBounds, _centroidBounds );
		splitNode( offset, leftCount, depth + 1 );

		// the right child follows the left subtree, stored as an offset relative to this node
		const relativeRightIndex = nodeCount - nodeIndex;
		if ( relativeRightIndex > MAX_POINTER ) {

			throw new Error( 'MeshBVH: Cannot store relative child node offset greater than 32 bits.' );

		}

		uint32Array[ node32 + 6 ] = relativeRightIndex;

		const rightCount = count - leftCount;
		getBounds( primitiveBounds, splitOffset, rightCount, _nodeBounds, _centroidBounds );
		splitNode( splitOffset, rightCount, depth + 1 );

	}

}

export function buildPackedTree( bvh, options ) {

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

		return buildTree( bvh, primitiveBounds, range.offset, range.count, options, fullRange );

	} );

}
