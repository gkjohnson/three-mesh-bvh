import MeshBVH from '../src/MeshBVH.js';

export function generateAsync( geometry, options = {} ) {

	return new Promise( ( resolve, reject ) => {

		const worker = new Worker( './generateAsync.worker.js' );
		worker.onmessage = e => {

			const { serialized, position, error } = e.data;

			worker.terminate();
			if ( error ) {

				reject( new Error( error ) );

			} else {

				const bvh = MeshBVH.deserialize( serialized, geometry, false );

				// we need to replace the arrays because they're neutered entirely by the
				// webworker transfer.
				geometry.attributes.position.array = position;
				if ( geometry.index ) {

					geometry.index.array = serialized.index;

				}
				resolve( bvh );

			}

		};

		const index = geometry.index ? geometry.index.array : null;
		const position = geometry.attributes.position.array;

		const transferrables = [ position ];
		if ( index ) {

			transferrables.push( index );

		}

		worker.postMessage( {

			index,
			position,
			options,

		}, transferrables.map( arr => arr.buffer ) );

	} );

}
