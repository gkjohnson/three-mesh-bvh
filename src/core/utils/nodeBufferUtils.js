import { IS_LEAFNODE_FLAG, UINT32_PER_NODE } from '../Constants.js';

export function IS_LEAF( n16, uint16Array ) {

	return uint16Array[ n16 + 15 ] === IS_LEAFNODE_FLAG;

}

export function OFFSET( n32, uint32Array ) {

	return uint32Array[ n32 + 6 ];

}

export function COUNT( n16, uint16Array ) {

	return uint16Array[ n16 + 14 ];

}

// Returns the uint32-aligned offset of the left child node for performance
export function LEFT_NODE( n32 ) {

	return n32 + UINT32_PER_NODE;

}

// Returns the uint32-aligned offset of the right child node for performance
export function RIGHT_NODE( n32, uint32Array ) {

	// stored value is relative offset from parent, convert to absolute uint32 index
	const relativeOffset = uint32Array[ n32 + 6 ];
	return n32 + relativeOffset * UINT32_PER_NODE;

}

export function SPLIT_AXIS( n32, uint32Array ) {

	return uint32Array[ n32 + 7 ];

}

export function BOUNDING_DATA_INDEX( n32 ) {

	return n32;

}
