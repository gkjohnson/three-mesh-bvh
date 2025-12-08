import { BYTES_PER_NODE } from '../Constants.js';

// number of uint32 elements per node
const STRIDE_32 = BYTES_PER_NODE / 4;

export function IS_LEAF( n16, uint16Array ) {

	return uint16Array[ n16 + 15 ] === 0xFFFF;

}

export function OFFSET( n32, uint32Array ) {

	return uint32Array[ n32 + 6 ];

}

export function COUNT( n16, uint16Array ) {

	return uint16Array[ n16 + 14 ];

}

export function LEFT_NODE( n32 ) {

	return n32 + STRIDE_32;

}

export function RIGHT_NODE( n32, uint32Array ) {

	// stored value is node index, convert to uint32 index
	return uint32Array[ n32 + 6 ] * STRIDE_32;

}

export function SPLIT_AXIS( n32, uint32Array ) {

	return uint32Array[ n32 + 7 ];

}

export function BOUNDING_DATA_INDEX( n32 ) {

	return n32;

}
