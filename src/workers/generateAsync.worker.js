import {
	BufferGeometry,
	BufferAttribute,
} from 'three';
import { MeshBVH } from '../core/MeshBVH.js';

global.onmessage = function ( { data } ) {

	let prevTime = global.performance.now();
	function onProgressCallback( progress ) {

		const currTime = global.performance.now();
		if ( currTime - prevTime >= 10 || progress === 1.0 ) {

			global.postMessage( {

				error: null,
				serialized: null,
				position: null,
				progress,

			} );
			prevTime = currTime;

		}

	}

	const { index, position, options } = data;
	try {

		const geometry = new BufferGeometry();
		geometry.setAttribute( 'position', new BufferAttribute( position, 3, false ) );
		if ( index ) {

			geometry.setIndex( new BufferAttribute( index, 1, false ) );

		}

		if ( options.includedProgressCallback ) {

			options.onProgress = onProgressCallback;

		}

		if ( options.groups ) {

			const groups = options.groups;
			for ( const i in groups ) {

				const group = groups[ i ];
				geometry.addGroup( group.start, group.count, group.materialIndex );

			}

		}

		const bvh = new MeshBVH( geometry, options );
		const serialized = MeshBVH.serialize( bvh, { copyIndexBuffer: false } );

		global.postMessage( {

			error: null,
			serialized,
			position,
			progress: 1,

		}, [ serialized.index.buffer, position.buffer ] );

	} catch ( error ) {

		global.postMessage( {

			error,
			serialized: null,
			position: null,
			progress: 1,

		} );

	}

};
