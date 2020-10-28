import MeshBVH from '../src/MeshBVH.js';

export function generateAsync( geometry, options = {} ) {

	return new Promise( ( resolve, reject ) => {

		const worker = new Worker( './generateAsync.worker.js' );
		worker.onmessage = e => {

			const { serialized, error } = e;
			worker.terminate();
			if ( error ) {

				reject( new Error( error ) );

			} else {

				resolve( MeshBVH.deserialize( serialized, geometry ) );

			}

		};

		const index = geometry.index ? geometry.index.array : null;
		const position = geometry.attributes.position.array;

		worker.postMessage( {

			index,
			position,
			options,

		}, [ index, position ] );

	} );

}
