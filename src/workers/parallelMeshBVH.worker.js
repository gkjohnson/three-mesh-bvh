import { MathUtils, BufferGeometry, BufferAttribute } from 'three';
import { WorkerPool } from './utils/WorkerPool.js';
import { BYTES_PER_NODE, UINT32_PER_NODE, IS_LEAFNODE_FLAG, DEFAULT_OPTIONS, SKIP_GENERATION } from '../core/Constants.js';
import { buildTree } from '../core/build/buildTree.js';
import { MeshBVH } from '../core/MeshBVH.js';
import { getRootPrimitiveRanges } from '../core/build/geometryUtils.js';
import { generateIndirectBuffer } from '../core/GeometryBVH.js';

let isRunning = false;
let prevTime = - 1;
const workerPool = new WorkerPool( () => new Worker( new URL( './parallelMeshBVH.worker.js', import.meta.url ), { type: 'module' } ) );

self.onmessage = async ( { data } ) => {

	if ( isRunning ) {

		throw new Error( 'Worker is already running a task.' );

	}

	const { operation } = data;
	if ( operation === 'BUILD_BVH' ) {

		isRunning = true;

		triggerOnProgress( 0 );

		const {
			maxWorkerCount,
			index,
			position,
			options,
		} = data;

		// initialize the number of workers balanced for a binary tree
		workerPool.setWorkerCount( MathUtils.floorPowerOfTwo( maxWorkerCount ) );

		// generate necessary buffers and objects - based on the "buildTree" implementation
		const geometry = getGeometry( index, position, options.groups );
		let proxyBvh = createProxyBVH( geometry, null );

		let indirectBuffer = null;
		if ( options.indirect ) {

			const ranges = getRootPrimitiveRanges( geometry, options.range, proxyBvh.primitiveStride );
			indirectBuffer = generateIndirectBuffer( ranges, true );
			proxyBvh._indirectBuffer = indirectBuffer;

		}

		// get the range of buffer data to construct / arrange as done in "buildTree"
		const rootRanges = proxyBvh.getRootRanges( options.range );
		const firstRange = rootRanges[ 0 ];
		const lastRange = rootRanges[ rootRanges.length - 1 ];
		const fullRange = {
			offset: firstRange.offset,
			count: lastRange.offset + lastRange.count - firstRange.offset,
		};

		// construct the primitive bounds for sorting
		const primitiveBounds = new Float32Array( 6 * fullRange.count );
		primitiveBounds.offset = fullRange.offset;
		proxyBvh.computePrimitiveBounds( fullRange.offset, fullRange.count, primitiveBounds );

		// generate portions of the triangle bounds buffer over multiple frames
		const boundsPromises = [];
		const triCount = primitiveBounds.length / 6;
		for ( let i = 0, l = workerPool.workerCount; i < l; i ++ ) {

			const countPerWorker = Math.ceil( triCount / l );
			const offset = i * countPerWorker;
			const count = Math.min( countPerWorker, triCount - offset );

			boundsPromises.push( workerPool.runSubTask(
				i,
				{
					operation: 'BUILD_TRIANGLE_BOUNDS',
					offset,
					count,
					index,
					position,
					triangleBounds: primitiveBounds,
					triangleBoundsOffset: primitiveBounds.offset,
					indirectBuffer,
				}
			) );

		}

		await Promise.all( boundsPromises );

		let totalProgress = 0;

		const localOptions = {
			...DEFAULT_OPTIONS,
			...options,
			verbose: false,
			maxDepth: Math.round( Math.log2( workerPool.workerCount ) ),
			onProgress: options.includedProgressCallback ?
				getOnProgressDeltaCallback( delta => {

					totalProgress += 0.1 * delta;
					triggerOnProgress( totalProgress );

				} ) :
				null,
		};

		// generate the ranges for all roots asynchronously
		const packedRoots = [];
		for ( let i = 0, l = rootRanges.length; i < l; i ++ ) {

			// build the tree down to the necessary depth
			const promises = [];
			const range = rootRanges[ i ];
			const topTree = buildTree( proxyBvh, primitiveBounds, range.offset, range.count, localOptions, fullRange );
			const leaves = getLeaves( topTree, range );
			let bufferLengths = 0;
			let nextWorker = 0;

			// trigger workers for each generated leaf node
			for ( let j = 0, l = leaves.length; j < l; j ++ ) {

				const leaf = leaves[ j ];

				// adjust the maxDepth to account for the depth we've already traversed
				const workerOptions = {
					...DEFAULT_OPTIONS,
					...options
				};

				workerOptions.maxDepth = workerOptions.maxDepth - leaf.depth;

				const pr = workerPool.runSubTask(
					nextWorker ++,
					{
						operation: 'BUILD_SUBTREE',
						offset: leaf.offset,
						count: leaf.count,
						indirectBuffer,
						index,
						position,
						triangleBounds: primitiveBounds,
						triangleBoundsOffset: primitiveBounds.offset,
						options: workerOptions,
					},
					getOnProgressDeltaCallback( delta => {

						totalProgress += 0.9 * delta / nextWorker;
						triggerOnProgress( totalProgress );

					} ),
				).then( data => {

					leaf.buffer = data.buffer;
					bufferLengths += data.buffer.byteLength;

				} );

				promises.push( pr );

			}

			// wait for the sub trees to complete
			await Promise.all( promises );

			const internalNodes = topTree.byteLength / BYTES_PER_NODE - leaves.length;
			const BufferConstructor = options.useSharedArrayBuffer ? SharedArrayBuffer : ArrayBuffer;
			const buffer = new BufferConstructor( bufferLengths + internalNodes * BYTES_PER_NODE );
			mergeSubtrees( topTree, leaves, buffer );

			packedRoots.push( buffer );

		}

		// transfer the data back
		self.postMessage( {
			error: null,
			serialized: {
				version: 1,
				roots: packedRoots,
				index: index,
				indirectBuffer: indirectBuffer,
			},
			position,
			progress: 1,
		} );

		isRunning = false;

	} else if ( operation === 'BUILD_SUBTREE' ) {

		const {
			offset,
			count,
			indirectBuffer,
			index,
			position,
			triangleBounds,
			triangleBoundsOffset,
			options,
		} = data;

		const geometry = getGeometry( index, position );
		const proxyBvh = createProxyBVH( geometry, indirectBuffer );

		// the subtree is transferred back, so it cannot be a shared buffer
		const localOptions = {
			...DEFAULT_OPTIONS,
			...options,
			useSharedArrayBuffer: false,
			onProgress: options.includedProgressCallback ? triggerOnProgress : null,
		};

		// reconstruct the triangle bounds structure before use
		triangleBounds.offset = triangleBoundsOffset;

		const buffer = buildTree( proxyBvh, triangleBounds, offset, count, localOptions, { offset, count } );
		self.postMessage( { type: 'result', buffer, progress: 1 }, [ buffer ] );

	} else if ( operation === 'BUILD_TRIANGLE_BOUNDS' ) {

		const {
			index,
			position,
			triangleBounds,
			triangleBoundsOffset,
			offset,
			count,
			indirectBuffer,
		} = data;

		// reconstruct the triangle bounds structure before use
		triangleBounds.offset = triangleBoundsOffset;

		const geometry = getGeometry( index, position );
		const proxyBvh = createProxyBVH( geometry, indirectBuffer );
		proxyBvh.computePrimitiveBounds( offset, count, triangleBounds );

		self.postMessage( { type: 'result' } );

	} else if ( operation === 'REFIT' ) {

		// TODO

	} else if ( operation === 'REFIT_SUBTREE' ) {

		// TODO

	}

};

// Helper functions and utils
function getOnProgressDeltaCallback( cb ) {

	let lastProgress = 0;
	return function onProgressDeltaCallback( progress ) {

		cb( progress - lastProgress );
		lastProgress = progress;

	};

}

function triggerOnProgress( progress ) {

	// account for error
	progress = Math.min( progress, 1 );

	const currTime = performance.now();
	if ( currTime - prevTime >= 10 && progress !== 1.0 ) {

		self.postMessage( {

			error: null,
			progress,
			type: 'progress'

		} );
		prevTime = currTime;

	}

}

function getGeometry( index, position, groups = null ) {

	const geometry = new BufferGeometry();
	if ( index ) {

		geometry.index = new BufferAttribute( index, 1, false );

	}

	geometry.setAttribute( 'position', new BufferAttribute( position, 3 ) );

	if ( groups ) {

		for ( let i = 0, l = groups.length; i < l; i ++ ) {

			const { start, count, materialIndex } = groups[ i ];
			geometry.addGroup( start, count, materialIndex );

		}

	}

	return geometry;

}

function createProxyBVH( geometry, indirectBuffer ) {

	const bvh = new MeshBVH( geometry, { [ SKIP_GENERATION ]: true } );
	bvh._indirectBuffer = indirectBuffer;
	return bvh;

}

// the leaves of a packed tree with their depth and primitive range, in node order. A group range
// that doesn't line up with triangles has a fractional offset, which the packed leaves truncate,
// so it is restored from the range and each leaf runs up to the next to keep the exact counts.
function getLeaves( buffer, range ) {

	const uint32Array = new Uint32Array( buffer );
	const uint16Array = new Uint16Array( buffer );
	const leaves = [];
	traverse( 0, 0 );

	const fraction = range.offset - Math.floor( range.offset );
	for ( let i = 0, l = leaves.length; i < l; i ++ ) {

		leaves[ i ].offset += fraction;

	}

	for ( let i = 0, l = leaves.length; i < l; i ++ ) {

		const end = i + 1 < l ? leaves[ i + 1 ].offset : range.offset + range.count;
		leaves[ i ].count = end - leaves[ i ].offset;

	}

	return leaves;

	function traverse( nodeIndex, depth ) {

		const node32 = nodeIndex * UINT32_PER_NODE;
		const node16 = node32 * 2;
		if ( uint16Array[ node16 + 15 ] === IS_LEAFNODE_FLAG ) {

			leaves.push( {
				nodeIndex,
				depth,
				offset: uint32Array[ node32 + 6 ],
				count: 0,
				buffer: null,
			} );

		} else {

			traverse( nodeIndex + 1, depth + 1 );
			traverse( nodeIndex + uint32Array[ node32 + 6 ], depth + 1 );

		}

	}

}

// copies the packed top tree into "target" with every leaf replaced by its subtree buffer. Child
// offsets are relative to the parent so the subtree buffers are copied as they are.
function mergeSubtrees( topTree, leaves, target ) {

	const sourceUint32 = new Uint32Array( topTree );
	const targetUint32 = new Uint32Array( target );
	const targetUint8 = new Uint8Array( target );
	const leafMap = new Map( leaves.map( leaf => [ leaf.nodeIndex, leaf ] ) );
	write( 0, 0 );

	// writes the node at "byteOffset" and returns the byte offset after its subtree
	function write( nodeIndex, byteOffset ) {

		const leaf = leafMap.get( nodeIndex );
		if ( leaf ) {

			targetUint8.set( new Uint8Array( leaf.buffer ), byteOffset );
			return byteOffset + leaf.buffer.byteLength;

		}

		const node32 = nodeIndex * UINT32_PER_NODE;
		const target32 = byteOffset / 4;
		for ( let i = 0; i < UINT32_PER_NODE; i ++ ) {

			targetUint32[ target32 + i ] = sourceUint32[ node32 + i ];

		}

		const rightByteOffset = write( nodeIndex + 1, byteOffset + BYTES_PER_NODE );
		targetUint32[ target32 + 6 ] = ( rightByteOffset - byteOffset ) / BYTES_PER_NODE;
		return write( nodeIndex + sourceUint32[ node32 + 6 ], rightByteOffset );

	}

}
