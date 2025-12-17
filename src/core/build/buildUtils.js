import { BYTES_PER_NODE, IS_LEAFNODE_FLAG } from '../Constants.js';

let float32Array, uint32Array, uint16Array, uint8Array;
const MAX_POINTER = Math.pow( 2, 32 );

export function countNodes( node ) {

	if ( 'count' in node ) {

		return 1;

	} else {

		return 1 + countNodes( node.left ) + countNodes( node.right );

	}

}

export function populateBuffer( byteOffset, node, buffer ) {

	float32Array = new Float32Array( buffer );
	uint32Array = new Uint32Array( buffer );
	uint16Array = new Uint16Array( buffer );
	uint8Array = new Uint8Array( buffer );

	return _populateBuffer( byteOffset, node );

}

// pack structure
// boundingData  				: 6 float32
// right / offset 				: 1 uint32
// splitAxis / isLeaf + count 	: 1 uint32 / 2 uint16
function _populateBuffer( byteOffset, node ) {

	const node32Index = byteOffset / 4;
	const node16Index = byteOffset / 2;
	const isLeaf = 'count' in node;
	const boundingData = node.boundingData;
	for ( let i = 0; i < 6; i ++ ) {

		float32Array[ node32Index + i ] = boundingData[ i ];

	}

	if ( isLeaf ) {

		if ( node.buffer ) {

			uint8Array.set( new Uint8Array( node.buffer ), byteOffset );
			return byteOffset + node.buffer.byteLength;

		} else {

			uint32Array[ node32Index + 6 ] = node.offset;
			uint16Array[ node16Index + 14 ] = node.count;
			uint16Array[ node16Index + 15 ] = IS_LEAFNODE_FLAG;
			return byteOffset + BYTES_PER_NODE;

		}

	} else {

		const { left, right, splitAxis } = node;

		// fill in the left node contents
		const leftByteOffset = byteOffset + BYTES_PER_NODE;
		let rightByteOffset = _populateBuffer( leftByteOffset, left );

		// calculate relative offset from parent to right child
		const currentNodeIndex = byteOffset / BYTES_PER_NODE;
		const rightNodeIndex = rightByteOffset / BYTES_PER_NODE;
		const relativeRightIndex = rightNodeIndex - currentNodeIndex;

		// check if the relative offset is too high
		if ( relativeRightIndex > MAX_POINTER ) {

			throw new Error( 'MeshBVH: Cannot store relative child node offset greater than 32 bits.' );

		}

		// fill in the right node contents (store as relative offset)
		uint32Array[ node32Index + 6 ] = relativeRightIndex;
		uint32Array[ node32Index + 7 ] = splitAxis;

		// return the next available buffer pointer
		return _populateBuffer( rightByteOffset, right );

	}

}
