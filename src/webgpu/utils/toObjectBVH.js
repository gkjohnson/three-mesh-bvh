/** @import { Object3D, BufferGeometry } from 'three' */
import { Mesh } from 'three/webgpu';
import { GeometryBVH } from '../../core/GeometryBVH.js';
import { ObjectBVH } from '../../core/ObjectBVH.js';
import { SAH } from '../../core/Constants.js';

/**
 * Normalizes the various accepted `bvh` arguments into an {@link ObjectBVH}. A pre-built ObjectBVH
 * is returned as-is; otherwise an Object3D, BufferGeometry, GeometryBVH, or array of those is
 * wrapped into a new ObjectBVH.
 *
 * @private
 * @param {ObjectBVH | Object3D | BufferGeometry | GeometryBVH | Array} bvh
 * @returns {ObjectBVH}
 */
export function toObjectBVH( bvh ) {

	if ( bvh instanceof ObjectBVH ) {

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

	return new ObjectBVH( objects, { strategy: SAH, strictLeafSize: 1 } );

}
