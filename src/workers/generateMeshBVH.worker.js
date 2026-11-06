import {
	BufferGeometry,
	BufferAttribute,
	InterleavedBuffer,
	InterleavedBufferAttribute,
} from 'three';
import { MeshBVH } from '../core/MeshBVH.js';

self.onmessage = ( { data } ) => {

	let prevTime = - 1;
	function onProgressCallback( progress ) {

		// account for error
		progress = Math.min( progress, 1 );

		const currTime = performance.now();
		if ( currTime - prevTime >= 10 && progress !== 1.0 ) {

			self.postMessage( {

				error: null,
				serialized: null,
				position: null,
				progress,

			} );
			prevTime = currTime;

		}

	}

	const { index, position, positionStride, positionOffset, positionNormalized, options } = data;
	try {

		const geometry = new BufferGeometry();
		if ( positionStride === 3 ) {

			geometry.setAttribute( 'position', new BufferAttribute( position, 3, positionNormalized ) );

		} else {

			geometry.setAttribute( 'position', new InterleavedBufferAttribute( new InterleavedBuffer( position, positionStride ), 3, positionOffset, positionNormalized ) );

		}

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
		let toTransfer = [ position.buffer, ...serialized.roots ];
		if ( serialized.index ) {

			toTransfer.push( serialized.index.buffer );

		}

		toTransfer = toTransfer.filter( v => ( typeof SharedArrayBuffer === 'undefined' ) || ! ( v instanceof SharedArrayBuffer ) );

		if ( bvh._indirectBuffer ) {

			toTransfer.push( serialized.indirectBuffer.buffer );

		}

		self.postMessage( {

			error: null,
			serialized,
			position,
			progress: 1,

		}, toTransfer );

	} catch ( error ) {

		// hand the transferred arrays back so the geometry is still usable after a failed build
		self.postMessage( {

			error,
			serialized: null,
			position,
			index,
			progress: 1,

		}, [ position, index ]
			.filter( arr => arr && ( ( typeof SharedArrayBuffer === 'undefined' ) || ! ( arr.buffer instanceof SharedArrayBuffer ) ) )
			.map( arr => arr.buffer ) );

	}

};
