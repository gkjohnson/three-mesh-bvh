import { MathUtils, BufferGeometry, BufferAttribute } from 'three';
import { WorkerPool } from './utils/WorkerPool.js';
import { BYTES_PER_NODE } from '../core/Constants.js';
import { buildTree, generateIndirectBuffer } from '../core/build/buildTree.js';
import { countNodes, populateBuffer } from '../core/build/buildUtils.js';
import { computeTriangleBounds } from '../core/build/computeBoundsUtils.js';
import { getFullGeometryRange, getRootIndexRanges } from '../core/build/geometryUtils.js';
import { DEFAULT_OPTIONS } from '../core/MeshBVH.js';

let isRunning = false;
let prevTime = 0;
const workerPool = new WorkerPool( () => new Worker( new URL( './parallelMeshBVH.worker.js', import.meta.url ), { type: 'module' } ) );

self.onmessage = async ( { data } ) => {

	if ( isRunning ) {

		throw new Error( 'Worker is already running a task.' );

	}

	const { operation } = data;
	if ( operation === 'BUILD_BVH' ) {

		isRunning = true;

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
		let indirectBuffer = null;
		let triangleBounds, geometryRanges;
		if ( options.indirect ) {

			const ranges = getRootIndexRanges( geometry, options.range );
			indirectBuffer = generateIndirectBuffer( geometry, true, ranges );
			triangleBounds = new Float32Array( new SharedArrayBuffer( indirectBuffer.length * 6 * 4 ) );
			triangleBounds.offset = 0;
			geometryRanges = [ { offset: 0, count: indirectBuffer.length } ];

		} else {

			const fullRange = getFullGeometryRange( geometry, options.range )[ 0 ];
			triangleBounds = new Float32Array( new SharedArrayBuffer( fullRange.count * 6 * 4 ) );
			triangleBounds.offset = fullRange.offset;
			geometryRanges = getRootIndexRanges( geometry, options.range );

		}

		// generate portions of the triangle bounds buffer over multiple frames
		const boundsPromises = [];
		const triCount = triangleBounds.length / 6;
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
					triangleBounds,
					triangleBoundsOffset: triangleBounds.offset,
					indirectBuffer,
				}
			) );

		}

		await Promise.all( boundsPromises );

		// create a proxy bvh structure
		const proxyBvh = {
			_indirectBuffer: indirectBuffer,
			geometry: geometry,
		};

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
		for ( let i = 0, l = geometryRanges.length; i < l; i ++ ) {

			// build the tree down to the necessary depth
			const promises = [];
			const range = geometryRanges[ i ];
			const root = buildTree( proxyBvh, triangleBounds, range.offset, range.count, localOptions );
			const flatNodes = flattenNodes( root );
			let bufferLengths = 0;
			let remainingNodes = 0;
			let nextWorker = 0;

			// trigger workers for each generated leaf node
			for ( let j = 0, l = flatNodes.length; j < l; j ++ ) {

				const node = flatNodes[ j ];
				const isLeaf = Boolean( node.count );
				if ( isLeaf ) {

					// adjust the maxDepth to account for the depth we've already traversed
					const workerOptions = {
						...DEFAULT_OPTIONS,
						...options
					};

					workerOptions.maxDepth = workerOptions.maxDepth - node.depth;

					const pr = workerPool.runSubTask(
						nextWorker ++,
						{
							operation: 'BUILD_SUBTREE',
							offset: node.offset,
							count: node.count,
							indirectBuffer,
							index,
							position,
							triangleBounds,
							triangleBoundsOffset: triangleBounds.offset,
							options: workerOptions,
						},
						getOnProgressDeltaCallback( delta => {

							totalProgress += 0.9 * delta / nextWorker;
							triggerOnProgress( totalProgress );

						} ),
					).then( data => {

						const buffer = data.buffer;
						node.buffer = buffer;
						bufferLengths += buffer.byteLength;

					} );

					promises.push( pr );

				} else {

					remainingNodes ++;

				}

			}

			// wait for the sub trees to complete
			await Promise.all( promises );

			const BufferConstructor = options.useSharedArrayBuffer ? SharedArrayBuffer : ArrayBuffer;
			const buffer = new BufferConstructor( bufferLengths + remainingNodes * BYTES_PER_NODE );
			populateBuffer( 0, root, buffer );

			packedRoots.push( buffer );

		}

		// transfer the data back
		self.postMessage( {
			error: null,
			serialized: {
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

		const proxyBvh = {
			_indirectBuffer: indirectBuffer,
			geometry: getGeometry( index, position ),
		};

		const localOptions = {
			...DEFAULT_OPTIONS,
			...options,
			onProgress: options.includedProgressCallback ? triggerOnProgress : null,
		};

		// reconstruct the triangle bounds structure before use
		triangleBounds.offset = triangleBoundsOffset;

		const root = buildTree( proxyBvh, triangleBounds, offset, count, localOptions );
		const nodeCount = countNodes( root );
		const buffer = new ArrayBuffer( BYTES_PER_NODE * nodeCount );
		populateBuffer( 0, root, buffer );
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
		computeTriangleBounds( geometry, offset, count, indirectBuffer, triangleBounds );
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

function flattenNodes( node ) {

	const arr = [];
	traverse( node );
	return arr;

	function traverse( node, depth = 0 ) {

		node.depth = depth;
		arr.push( node );

		const isLeaf = Boolean( node.count );
		if ( ! isLeaf ) {

			traverse( node.left, depth + 1 );
			traverse( node.right, depth + 1 );

		}

	}

}
