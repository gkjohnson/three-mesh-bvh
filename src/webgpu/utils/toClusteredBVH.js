/** @import { Object3D, BufferGeometry } from 'three' */
import { Mesh } from 'three/webgpu';
import { GeometryBVH } from '../../core/GeometryBVH.js';
import { SAH } from '../../core/Constants.js';
import { ClusteredBVH } from '../ClusteredBVH.js';

/**
 * Normalizes the various accepted `bvh` arguments into a {@link ClusteredBVH}. A pre-built
 * ClusteredBVH is returned as-is; otherwise an Object3D, BufferGeometry, GeometryBVH, or array
 * of those is wrapped into a new ClusteredBVH.
 *
 * @private
 * @param {ClusteredBVH | Object3D | BufferGeometry | GeometryBVH | Array} bvh
 * @param {Object} options - ClusteredBVH options ( notably the required "getBVH" callback ).
 * @returns {ClusteredBVH}
 */
export function toClusteredBVH( bvh, options ) {

	if ( bvh instanceof ClusteredBVH ) {

		return bvh;

	}

	if ( ! Array.isArray( bvh ) ) {

		bvh = [ bvh ];

	}

	const objects = bvh.map( item => {

		if ( item.isObject3D ) {

			return item;

		} else if ( item.isBufferGeometry ) {

			return new Mesh( item );

		} else if ( item instanceof GeometryBVH ) {

			const dummy = new Mesh();
			dummy.geometry.boundsTree = item;
			return dummy;

		}

	} );

	return new ClusteredBVH( objects, { strategy: SAH, ...options } );

}
