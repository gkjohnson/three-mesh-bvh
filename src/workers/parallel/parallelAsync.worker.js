import { MathUtils } from 'three';
import { BYTES_PER_NODE } from '../../core/Constants.js';
import { buildTree, generateIndirectBuffer } from '../../core/build/buildTree.js';
import { countNodes, populateBuffer } from '../../core/build/buildUtils.js';
import { computeTriangleBounds } from '../../core/build/computeBoundsUtils.js';
import { getFullGeometryRange, getRootIndexRanges } from '../../core/build/geometryUtils.js';
import { WorkerPool } from './WorkerPool.js';
import { flattenNodes, getGeometry } from './utils.js';
import { DEFAULT_OPTIONS } from '../../core/MeshBVH.js';

let isRunning = false;
let prevTime = 0;
const workerPool = new WorkerPool();

onmessage = async ( { data } ) => {

	if ( isRunning ) {

		throw new Error();

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

		// generate necessary buffers and objects
		const geometry = getGeometry( index, position );
		const indirectBuffer = options.indirect ? generateIndirectBuffer( geometry, true ) : null;
		const triangleBounds = computeTriangleBounds( geometry );
		const geometryRanges = options.indirect ? getFullGeometryRange( geometry ) : getRootIndexRanges( geometry );

		// create a proxy bvh structure
		const proxyBvh = {
			_indirectBuffer: indirectBuffer,
			geometry: geometry,
		};


		let totalProgress = 0;

		const progressCallback = getOnProgressDeltaCallback( delta => {

			totalProgress += delta * 0.1;
			triggerOnProgress( totalProgress );

		} );

		const localOptions = {
			...DEFAULT_OPTIONS,
			...options,
			verbose: false,
			maxDepth: Math.round( Math.log2( workerPool.workerCount ) ),
			onProgress: options.includedProgressCallback ? progressCallback : null,
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
							options: {
								...DEFAULT_OPTIONS,
								...options
							},
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
		postMessage( {
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

	} else if ( operation === 'REFIT' ) {

	} else if ( operation === 'BUILD_BOUNDS' ) {

	} else if ( operation === 'BUILD_SUBTREE' ) {

		const {
			offset,
			count,
			indirectBuffer,
			index,
			position,
			triangleBounds,
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

		const root = buildTree( proxyBvh, triangleBounds, offset, count, localOptions );
		const nodeCount = countNodes( root );
		const buffer = new ArrayBuffer( BYTES_PER_NODE * nodeCount );
		populateBuffer( 0, root, buffer );

		postMessage( { type: 'result', buffer }, [ buffer ] );

	} else if ( operation === 'REFIT_SUBTREE' ) {

	}

};

function getOnProgressDeltaCallback( cb ) {

	let lastProgress = 0;
	return function onProgressDeltaCallback( progress ) {

		cb( progress - lastProgress );
		lastProgress = progress;

	};

}

function triggerOnProgress( progress ) {

	const currTime = performance.now();
	if ( currTime - prevTime >= 10 || progress === 1.0 ) {

		postMessage( {

			error: null,
			progress,
			type: 'progress'

		} );
		prevTime = currTime;

	}

}
