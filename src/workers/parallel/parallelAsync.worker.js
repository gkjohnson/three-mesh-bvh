import { BufferAttribute, BufferGeometry } from 'three';
import { BYTES_PER_NODE } from '../../core/Constants';
import { buildTree } from '../../core/build/buildTree.js';
import { countNodes, populateBuffer } from '../../core/build/buildUtils.js';
import { computeTriangleBounds } from '../../core/build/computeBoundsUtils';
import { getFullGeometryRange, getRootIndexRanges } from '../../core/build/geometryUtils';

let isRunning = false;
let prevTime = 0;
const childWorkers = [];
onmessage = async ( { data } ) => {

	if ( isRunning ) {

		throw new Error();

	}

	const { operation } = data;
	if ( operation === 'INIT' ) {

		isRunning = true;

		const {
			maxWorkerCount,
			indirectBuffer,
			indexArray,
			positionArray,
			options,
		} = data;
		while ( childWorkers.length < maxWorkerCount ) {

			childWorkers.push( new Worker( new URL( './parallelAsync.worker.js', import.meta.url ), { module: true } ) );

		}

		while ( childWorkers.length > maxWorkerCount ) {

			childWorkers.pop().terminate();

		}

		// TODO: interleaved buffers do not work

		const proxyBvh = {
			_indirectBuffer: indirectBuffer,
			geometry: getGeometry( indexArray, positionArray ),
		};

		// TODO: generate triangleBounds asynchronously
		const geometry = getGeometry( indexArray, positionArray );
		const triangleBounds = computeTriangleBounds( geometry );

		const localOptions = {
			...options,
			maxDepth: Math.floor( Math.log2( maxWorkerCount ) ),
			onProgress: options.includedProgressCallback ? onProgressCallback : null,
		};

		const geometryRanges = options.indirect ? getFullGeometryRange( geometry ) : getRootIndexRanges( geometry );
		for ( let i = 0, l = geometryRanges.length; i < l; i ++ ) {

			const promises = [];
			const range = geometryRanges[ i ];
			const root = buildTree( proxyBvh, triangleBounds, range.offset, range.count, localOptions );
			const flatNodes = flattenNodes( root );
			let bufferLengths = 0;
			let remainingNodes = 0;

			for ( let i = 0, l = flatNodes.length; i < l; i ++ ) {

				const index = i;
				const isLeaf = Boolean( flatNodes[ i ].count );

				if ( isLeaf ) {

					const pr = new Promise( resolve => {

						// TODO: trigger worker and wait for result

					} ).then( buffer => {

						flatNodes[ index ] = buffer;
						bufferLengths += buffer.byteLength;

					} );

					promises.push( pr );

				} else {

					remainingNodes ++;

				}

			}

			await Promise.all( promises );

			const BufferConstructor = options.useSharedArrayBuffer ? SharedArrayBuffer : ArrayBuffer;
			const buffer = new BufferConstructor( bufferLengths + remainingNodes * BYTES_PER_NODE );

			// TODO: expand all the data into the buffers
			// TODO: adjust offset

		}

		// TODO: generate bounds to the necessary depth
		// TODO: trigger messages on the workers and await their completion
		// TODO: handle progress

		isRunning = false;

	} else if ( operation === 'BUILD_BOUNDS' ) {


	} else if ( operation === 'BUILD_TREE' ) {

		const {
			offset, length,
			indirectBuffer, index, triangleBounds,
			options,
		} = data;

		const resultBuffer = buildBuffer( offset, length, { indirectBuffer, index, triangleBounds }, options );
		postMessage( { resultBuffer }, [ resultBuffer ] );

	}

};

function buildBuffer( offset, count, info, options ) {

	const {
		indirectBuffer,
		indexArray,
		positionArray,
		triangleBounds,
	} = info;

	const proxyBvh = {
		_indirectBuffer: indirectBuffer,
		geometry: getGeometry( indexArray, positionArray ),
	};

	const root = buildTree( proxyBvh, triangleBounds, offset, count, options );
	const nodeCount = countNodes( root );
	const buffer = new ArrayBuffer( BYTES_PER_NODE * nodeCount );
	populateBuffer( 0, root, buffer );
	return buildBuffer;

}

function getGeometry( index, position ) {

	const geometry = new BufferGeometry();
	if ( index ) {

		geometry.index = new BufferAttribute( index, 1, false );

	}

	geometry.setAttribute( 'position', new BufferAttribute( position, 3 ) );
	return geometry;

}

function onProgressCallback( progress ) {

	const currTime = performance.now();
	if ( currTime - prevTime >= 10 || progress === 1.0 ) {

		postMessage( {

			error: null,
			serialized: null,
			position: null,
			progress,

		} );
		prevTime = currTime;

	}

}

function flattenNodes( node ) {

	const arr = [];
	traverse( node );
	return node;

	function traverse( node ) {

		arr.push( node );

		const isLeaf = Boolean( node.count );
		if ( ! isLeaf ) {

			traverse( node.left );
			traverse( node.right );

		}

	}


}
