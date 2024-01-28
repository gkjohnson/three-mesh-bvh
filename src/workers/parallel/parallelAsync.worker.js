import { MathUtils } from 'three';
import { BYTES_PER_NODE } from '../../core/Constants.js';
import { buildTree, generateIndirectBuffer } from '../../core/build/buildTree.js';
import { countNodes, populateBuffer } from '../../core/build/buildUtils.js';
import { computeTriangleBounds } from '../../core/build/computeBoundsUtils.js';
import { getFullGeometryRange, getRootIndexRanges } from '../../core/build/geometryUtils.js';
import { WorkerPool } from './WorkerPool.js';
import { flattenNodes, getGeometry } from './utils.js';
import { CENTER } from '../../core/Constants.js';

let isRunning = false;
let prevTime = 0;
const workerPool = new WorkerPool();
const DEFAULT_OPTIONS = {
	strategy: CENTER,
	maxDepth: 40,
	maxLeafTris: 10,
	verbose: true,
	useSharedArrayBuffer: false,
	setBoundingBox: true,
	onProgress: null,
	indirect: false,
	verbose: true,
};

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

		workerPool.setWorkerCount( MathUtils.floorPowerOfTwo( maxWorkerCount ) );

		const geometry = getGeometry( index, position );
		const indirectBuffer = options.indirect ? generateIndirectBuffer( geometry, true ) : null;

		// create a proxy bvh structure
		const proxyBvh = {
			_indirectBuffer: indirectBuffer,
			geometry: getGeometry( index, position ),
		};

		const localOptions = {
			...DEFAULT_OPTIONS,
			...options,
			verbose: false,
			maxDepth: Math.round( Math.log2( workerPool.workerCount ) ),
			onProgress: options.includedProgressCallback ? onProgressCallback : null,
		};

		// generate the ranges for all roots asynchronously
		const triangleBounds = computeTriangleBounds( geometry );
		const geometryRanges = options.indirect ? getFullGeometryRange( geometry ) : getRootIndexRanges( geometry );
		const packedRoots = [];
		for ( let i = 0, l = geometryRanges.length; i < l; i ++ ) {

			const promises = [];
			const range = geometryRanges[ i ];
			const root = buildTree( proxyBvh, triangleBounds, range.offset, range.count, localOptions );
			const flatNodes = flattenNodes( root );
			let bufferLengths = 0;
			let remainingNodes = 0;
			let nextWorker = 0;

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
						onProgressCallback,
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

		// TODO: transfer packed roots
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

		const root = buildTree( proxyBvh, triangleBounds, offset, count, options );
		const nodeCount = countNodes( root );
		const buffer = new ArrayBuffer( BYTES_PER_NODE * nodeCount );
		populateBuffer( 0, root, buffer );

		postMessage( { type: 'result', buffer }, [ buffer ] );

	}

};

function onProgressCallback( progress ) {

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
