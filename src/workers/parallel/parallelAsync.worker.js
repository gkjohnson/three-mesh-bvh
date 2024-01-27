
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

		// TODO: handle indirect case, multiple roots


	} else if ( operation === 'BUILD_BOUNDS' ) {


	} else if ( operation === 'BUILD_TREE' ) {

		const {
			offset, length,
			indirectBuffer, index, bounds,
		} = data;

		const resultBuffer = buildBuffer( offset, length, { indirectBuffer, index, bounds } );

		postMessage( {
			resultBuffer,
		} );

	}

};


