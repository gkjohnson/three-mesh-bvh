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

	// the generator only yields after a time slice so it runs to completion in one step
	const generator = buildTreeGenerator( bvh, primitiveBounds, offset, count, options, loadRange, Infinity );
	let result = generator.next();
	while ( ! result.done ) {

		result = generator.next();

	}

	return result.value;

}

// Generator form of "buildTree" that yields once more than "timeSlice" milliseconds have passed since
// it started or resumed so a build can be spread over multiple tasks. The node bounds are computed
// after resuming because the shared scratch arrays may have been used by another build in between.
export function* buildTreeGenerator( bvh, primitiveBounds, offset, count, options, loadRange, timeSlice ) {

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

	// the right subtrees still to be built, depth first, as parent node index, offset, count and depth
	const stack = [];

	// the node to write next and the node whose right child it is, or -1 for a left child or the root
	let nodeOffset = offset;
	let nodePrimitives = count;
	let depth = 0;
	let parentIndex = - 1;

	let sliceStart = performance.now();
	let steps = 0;

	while ( true ) {

		// yield after the time slice, checking the time every 64 nodes
		if ( ( ++ steps & 63 ) === 0 && performance.now() - sliceStart > timeSlice ) {

			yield;
			sliceStart = performance.now();

		}

		const nodeIndex = nodeCount ++;
		const node32 = nodeIndex * UINT32_PER_NODE;

		// a right child is stored in its parent as an offset relative to the parent, after the left subtree
		if ( parentIndex !== - 1 ) {

			const relativeRightIndex = nodeIndex - parentIndex;
			if ( relativeRightIndex > MAX_POINTER ) {

				throw new Error( 'MeshBVH: Cannot store relative child node offset greater than 32 bits.' );

			}

			uint32Array[ parentIndex * UINT32_PER_NODE + 6 ] = relativeRightIndex;

		}

		getBounds( primitiveBounds, nodeOffset, nodePrimitives, _nodeBounds, _centroidBounds );
		float32Array.set( _nodeBounds, node32 );

		if ( splitNode( node32, nodeIndex, nodeOffset, nodePrimitives, depth ) ) {

			continue;

		}

		// the node is a leaf, continue with the last right subtree not built yet
		if ( stack.length === 0 ) {

			break;

		}

		depth = stack.pop();
		nodePrimitives = stack.pop();
		nodeOffset = stack.pop();
		parentIndex = stack.pop();

	}

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

	// splits the node whose bounds are in "_nodeBounds", continuing with its left child and pushing its right
	// child onto the stack, and returns true, or makes it a leaf node, recording the offset and count of its
	// primitives, and returns false.
	function splitNode( node32, nodeIndex, offset, count, nodeDepth ) {

		if ( ! reachedMaxDepth && nodeDepth >= maxDepth ) {

			reachedMaxDepth = true;
			if ( verbose ) {

				console.warn( `BVH: Max depth of ${ maxDepth } reached when generating BVH. Consider increasing maxDepth.` );

			}

		}

		// A hard guarantee that no leaf exceeds "_strictLeafSize" primitives. When this node is over
		// that limit it must keep splitting regardless of the heuristic.
		const mustSplit = count > _strictLeafSize;

		// early out if we've met our capacity - unless the strict guarantee still requires a split
		if ( ( count <= targetLeafSize && ! mustSplit ) || nodeDepth >= maxDepth ) {

			writeLeaf( node32, offset, count );
			return false;

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
				return false;

			}

			split.axis = Math.max( 0, getLongestEdgeIndex( _nodeBounds ) );
			splitOffset = offset + Math.max( 1, Math.floor( count / 2 ) );

		}

		uint32Array[ node32 + 7 ] = split.axis;

		// the left child directly follows this node, the right child follows the left subtree
		const leftCount = splitOffset - offset;
		stack.push( nodeIndex, splitOffset, count - leftCount, nodeDepth + 1 );

		nodeOffset = offset;
		nodePrimitives = leftCount;
		depth = nodeDepth + 1;
		parentIndex = - 1;
		return true;

	}

}

export function buildPackedTree( bvh, options ) {

	const { rootRanges, fullRange, primitiveBounds } = getBuildRanges( bvh, options );

	// Build BVH roots
	bvh._roots = rootRanges.map( range => {

		return buildTree( bvh, primitiveBounds, range.offset, range.count, options, fullRange );

	} );

}

// Like "buildPackedTree" but builds the roots in slices of "timeSlice" milliseconds of work, waiting for a
// new task between them so a page can render and handle input meanwhile. The roots are assigned once
// they are all built.
export async function buildPackedTreeAsync( bvh, options ) {

	const { timeSlice = 16 } = options;
	const { rootRanges, fullRange, primitiveBounds } = getBuildRanges( bvh, options );

	const roots = [];
	for ( const range of rootRanges ) {

		const generator = buildTreeGenerator( bvh, primitiveBounds, range.offset, range.count, options, fullRange, timeSlice );
		let result = generator.next();
		while ( ! result.done ) {

			await nextTask();
			result = generator.next();

		}

		roots.push( result.value );

	}

	bvh._roots = roots;

}

// returns the root ranges to build, the full range of primitives they span and the bounds of those primitives
function getBuildRanges( bvh, options ) {

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

	return { rootRanges, fullRange, primitiveBounds };

}

// resolves in a new task, without the minimum delay of nested timeouts where MessageChannel is available
function nextTask() {

	return new Promise( resolve => {

		if ( typeof MessageChannel === 'undefined' ) {

			setTimeout( resolve );
			return;

		}

		const channel = new MessageChannel();
		channel.port1.onmessage = () => {

			channel.port1.close();
			resolve();

		};

		channel.port2.postMessage( null );

	} );

}
