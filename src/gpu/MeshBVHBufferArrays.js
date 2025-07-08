import { BYTES_PER_NODE } from '../core/Constants.js';
import {
	BOUNDING_DATA_INDEX,
	COUNT,
	IS_LEAF,
	RIGHT_NODE,
	OFFSET,
	SPLIT_AXIS,
} from '../core/utils/nodeBufferUtils.js';
import { getIndexArray, getVertexCount } from '../core/build/geometryUtils.js';
import { BufferAttribute } from 'three';

export class MeshBVHBufferArrays {

	constructor() {

		this.index = null;
		this.position = null;
		this.bvhBounds = null;
		this.bvhContents = null;

		this._cachedIndexAttr = null;

	}

	updateFrom( bvh ) {

		const { geometry } = bvh;
		const { boundsArray, contentsArray } = bvhToArrays( bvh );

		this.bvhBounds = boundsArray;
		this.bvhContents = contentsArray;


		const posAttr = geometry.attributes.position;
		const count = posAttr.count;
		const newPosition = new Float32Array( count * 4 );

		for ( let i = 0; i < count; i ++ ) {

			newPosition[ 4 * i + 0 ] = posAttr.getX( i );
			newPosition[ 4 * i + 1 ] = posAttr.getY( i );
			newPosition[ 4 * i + 2 ] = posAttr.getZ( i );
			newPosition[ 4 * i + 3 ] = 1;

		}

		this.position = newPosition;


		if ( bvh.indirect ) {

			const indirectBuffer = bvh._indirectBuffer;

			if (
				this._cachedIndexAttr === null ||
				this._cachedIndexAttr.count !== indirectBuffer.length
			) {

				if ( geometry.index ) {

					this._cachedIndexAttr = geometry.index.clone();

				} else {

					const array = getIndexArray( getVertexCount( geometry ) );
					this._cachedIndexAttr = new BufferAttribute( array, 1, false );

				}

			}

			dereferenceIndex( geometry, indirectBuffer, this._cachedIndexAttr );
			this.index = convertIndexAttributeToVec4Array( this._cachedIndexAttr );

		} else {

			if ( geometry.index ) {

				this.index = convertIndexAttributeToVec4Array( geometry.index );

			} else {

				this.index = null;

			}

		}

	}

}


function convertIndexAttributeToVec4Array( attribute ) {

	const array = attribute.array;
	const count = array.length / 3;
	const newArray = new Uint32Array( count * 4 );

	for ( let i = 0; i < count; i ++ ) {

		newArray[ 4 * i + 0 ] = array[ 3 * i + 0 ];
		newArray[ 4 * i + 1 ] = array[ 3 * i + 1 ];
		newArray[ 4 * i + 2 ] = array[ 3 * i + 2 ];
		newArray[ 4 * i + 3 ] = 0; // padding

	}

	return newArray;

}


function bvhToArrays( bvh ) {

	const roots = bvh._roots;

	if ( roots.length !== 1 ) {

		throw new Error( 'MeshBVHUniformArrays: Multi-root BVHs not supported.' );

	}

	const root = roots[ 0 ];
	const uint32Array = new Uint32Array( root );
	const float32Array = new Float32Array( root );

	const nodeCount = root.byteLength / BYTES_PER_NODE;

 	const boundsArray = new Float32Array( 8 * nodeCount );
	const contentsArray = new Uint32Array( 2 * nodeCount );

	for ( let i = 0; i < nodeCount; i ++ ) {

		// copy bounds data
		for ( let b = 0; b < 3; b ++ ) {

			boundsArray[ 8 * i + 0 + b ] = float32Array[ 8 * i + 0 + b ];
			boundsArray[ 8 * i + 4 + b ] = float32Array[ 8 * i + 3 + b ];

		}

		// copy offset, count, and child index data
		contentsArray[ i * 2 + 0 ] = uint32Array[ 8 * i + 6 ];
		contentsArray[ i * 2 + 1 ] = uint32Array[ 8 * i + 7 ];

	}

	return { boundsArray, contentsArray };

}
