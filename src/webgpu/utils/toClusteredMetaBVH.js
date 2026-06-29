/** @import { Object3D, BufferGeometry } from 'three' */
import { Mesh } from 'three/webgpu';
import { GeometryBVH } from '../../core/GeometryBVH.js';
import { SAH } from '../../core/Constants.js';
import { ClusteredMetaBVH } from '../ClusteredMetaBVH.js';

/**
 * Normalizes the various accepted `bvh` arguments into a {@link ClusteredMetaBVH}. A pre-built
 * ClusteredMetaBVH is returned as-is; otherwise an Object3D, BufferGeometry, GeometryBVH, or array
 * of those is wrapped into a new ClusteredMetaBVH.
 *
 * @private
 * @param {ClusteredMetaBVH | Object3D | BufferGeometry | GeometryBVH | Array} bvh
 * @param {Object} options - ClusteredMetaBVH options ( notably the required "getBVH" callback ).
 * @returns {ClusteredMetaBVH}
 */
export function toClusteredMetaBVH( bvh, options ) {

	if ( bvh instanceof ClusteredMetaBVH ) {

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

	return new ClusteredMetaBVH( objects, { strategy: SAH, ...options } );

}
