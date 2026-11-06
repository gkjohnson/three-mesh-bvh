import { getBounds } from './computeBoundsUtils.js';
import { getOptimalSplit } from './splitUtils.js';
import { getLongestEdgeIndex } from '../../utils/ArrayBoxUtilities.js';
import { BYTES_PER_NODE, UINT32_PER_NODE } from '../Constants.js';
import { partition } from './sortUtils.js';
import { buildTree } from './buildTree.js';

const MAX_POINTER = Math.pow( 2, 32 );

// the primitives of the subtrees that are built at once, between which the build may wait for a new task
const SUBTREE_SIZE = 4096;

// the bounds, centroid bounds and split axis of the node being split
const _nodeBounds = /* @__PURE__ */ new Float32Array( 6 );
const _centroidBounds = /* @__PURE__ */ new Float32Array( 6 );
let _splitAxis = 0;

// Like "buildPackedTree" but builds the roots in slices of "timeSlice" milliseconds of work, waiting for a
// new task between them so a page can render and handle input meanwhile. The roots are assigned once
// they are all built.
export async function buildPackedTreeAsync( bvh, options ) {

	const { timeSlice = 16 } = options;

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

	const roots = [];
	for ( const range of rootRanges ) {

		roots.push( await buildTreeAsync( bvh, primitiveBounds, range.offset, range.count, options, fullRange, timeSlice ) );

	}

	bvh._roots = roots;

}

// Builds the same packed tree as "buildTree". The nodes over SUBTREE_SIZE primitives are split here one at a
// time, like "buildTree" splits them, and every subtree below them is built at once by "buildTree" and copied
// into place, so most of the work runs in the same code as a synchronous build. Between them it waits for a new
// task once "timeSlice" milliseconds have passed since it started or resumed.
async function buildTreeAsync( bvh, primitiveBounds, offset, count, options, loadRange, timeSlice ) {

	const {
		maxDepth,
		targetLeafSize,
		_strictLeafSize = Infinity,
		strategy,
		useSharedArrayBuffer = false,
	} = options;

	const partitionBuffer = bvh.primitiveBuffer;
	const partitionStride = bvh.primitiveBufferStride;

	const BufferConstructor = useSharedArrayBuffer ? SharedArrayBuffer : ArrayBuffer;
	const buffer = new BufferConstructor( BYTES_PER_NODE * Math.max( 1, 2 * Math.ceil( count ) - 1 ) );
	const uint8Array = new Uint8Array( buffer );
	const float32Array = new Float32Array( buffer );
	const uint32Array = new Uint32Array( buffer );
	let nodeCount = 0;
	let sliceEnd = performance.now() + timeSlice;

	await writeSubtree( offset, count, 0 );
	return buffer.slice( 0, nodeCount * BYTES_PER_NODE );

	async function writeSubtree( offset, count, depth ) {

		if ( performance.now() > sliceEnd ) {

			await nextTask();
			sliceEnd = performance.now() + timeSlice;

		}

		// small subtrees, and the nodes "buildTree" makes leaves, are built by it below this depth
		const splitOffset = count > SUBTREE_SIZE && depth < maxDepth ? splitNode( offset, count ) : - 1;
		if ( splitOffset === - 1 ) {

			const subtree = buildTree( bvh, primitiveBounds, offset, count, { ...options, maxDepth: maxDepth - depth }, loadRange );
			uint8Array.set( new Uint8Array( subtree ), nodeCount * BYTES_PER_NODE );
			nodeCount += subtree.byteLength / BYTES_PER_NODE;
			return;

		}

		// the node, with the bounds and axis of "splitNode", is followed by the left subtree, then the right one,
		// stored as an offset relative to this node
		const nodeIndex = nodeCount ++;
		const node32 = nodeIndex * UINT32_PER_NODE;
		float32Array.set( _nodeBounds, node32 );
		uint32Array[ node32 + 7 ] = _splitAxis;

		await writeSubtree( offset, splitOffset - offset, depth + 1 );

		const relativeRightIndex = nodeCount - nodeIndex;
		if ( relativeRightIndex > MAX_POINTER ) {

			throw new Error( 'MeshBVH: Cannot store relative child node offset greater than 32 bits.' );

		}

		uint32Array[ node32 + 6 ] = relativeRightIndex;

		await writeSubtree( splitOffset, offset + count - splitOffset, depth + 1 );

	}

	// computes the bounds of the node into "_nodeBounds" and splits its primitives like "buildTree" does, storing
	// the axis in "_splitAxis" and returning the offset of the right ones, or returns -1 if "buildTree" would make
	// the node a leaf. Partitioning only moves primitives that are on the wrong side, so a leaf's are unchanged.
	function splitNode( offset, count ) {

		getBounds( primitiveBounds, offset, count, _nodeBounds, _centroidBounds );

		const mustSplit = count > _strictLeafSize;
		if ( count <= targetLeafSize && ! mustSplit ) {

			return - 1;

		}

		const split = getOptimalSplit( _nodeBounds, _centroidBounds, primitiveBounds, offset, count, strategy );
		let splitOffset = split.axis === - 1 ? - 1 : partition( partitionBuffer, partitionStride, primitiveBounds, offset, count, split );

		if ( split.axis === - 1 || splitOffset === offset || splitOffset === offset + count ) {

			if ( ! mustSplit ) {

				return - 1;

			}

			split.axis = Math.max( 0, getLongestEdgeIndex( _nodeBounds ) );
			splitOffset = offset + Math.max( 1, Math.floor( count / 2 ) );

		}

		_splitAxis = split.axis;
		return splitOffset;

	}

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
