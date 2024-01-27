
const childWorkers = [];
onmessage = ( { data } ) => {

	const { operation } = data;

	if ( operation === 'INIT' ) {

		const { count } = data;
		while ( childWorkers.length > count ) {

			childWorkers.pop().terminate();

		}

		while ( childWorkers.length < count ) {

			childWorkers.push( new Worker( new URL( './parallelAsync.worker.js', import.meta.url ), { module: true } ) );

		}

		// TODO: handle indirect case, not roots (implicity use indirect buffer for now)
		// TODO: traverse to the the amount of threads needed - 1, 2, 4, 8, 16

	} else if ( operation === 'BUILD_BOUNDS' ) {


	} else if ( operation === 'BUILD_TREE' ) {

		const {
			offset, length,
			indirectBuffer, index, bounds,
			options,
		} = data;

		// TODO: build a packed buffer and pass it back to the main thread
		const resultBuffer = buildBuffer( offset, length, { indirectBuffer, index, bounds }, options );

		postMessage( {
			resultBuffer,
		}, [ resultBuffer.buffer ] );

	}

};

function buildBuffer( offset, length, info, options ) {

	const { indirectBuffer, index, bounds } = info;

}

