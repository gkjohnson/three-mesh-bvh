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



export class MeshBVHBufferArrays {

	constructor() {

		this.index = null;
		this.position = null;
		this.bvhBounds = null;

		this._cachedIndexAttr = null;

	}

	updateFrom( bvh ) {

		const { geometry } = bvh;

		this.bvhBounds = bvhToArrays( bvh );

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


function u32ToF32( u ) {

	return new Float32Array( new Uint32Array( [ u ] ).buffer )[ 0 ];

}

//16 byte aligned datas for wgsl
function bvhToArrays( bvh ) {

	const root = bvh._roots[ 0 ];

	if ( !root ) throw new Error('MeshBVHUniformArrays: Multi-root BVHs not supported.');

	const u32 = new Uint32Array( root ); 
	const f32 = new Float32Array( root );

	const nodeCount = root.byteLength / BYTES_PER_NODE;
	const bounds = new Float32Array( 8 * nodeCount );

	for ( let i = 0; i < nodeCount; i ++ ) {

		const ni = i * BYTES_PER_NODE / 4;
		const bi = BOUNDING_DATA_INDEX( ni );
		const fo = ni * 2;

		for ( let b = 0; b < 3; b ++ ) {

			bounds[ 8 * i + 0 + b ] = f32[ bi + 0 + b ];
			bounds[ 8 * i + 4 + b ] = f32[ bi + 3 + b ];

		}

		if ( IS_LEAF( fo, u32, true ) ) {

			const count = 0xffff0000 | COUNT( fo, u32, true );
			const offset = OFFSET( ni, u32 );

			bounds[ 8 * i + 3 ] = u32ToF32( count );
			bounds[ 8 * i + 7 ] = u32ToF32( offset );

		} else {

			const splitAxis = SPLIT_AXIS( ni, u32 );
			const rightIndex = 4 * RIGHT_NODE( ni, u32 ) / BYTES_PER_NODE;

			bounds[ 8 * i + 3 ] = u32ToF32( splitAxis );
			bounds[ 8 * i + 7 ] = u32ToF32( rightIndex );

		}

	}

	return bounds;

}
