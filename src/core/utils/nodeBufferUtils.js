import { UINT32_PER_NODE } from '../Constants.js';

export function IS_LEAF( n16, uint16Array ) {

	return uint16Array[ n16 + 15 ] === 0xFFFF;

}

export function OFFSET( n32, uint32Array ) {

	return uint32Array[ n32 + 6 ];

}

export function COUNT( n16, uint16Array ) {

	return uint16Array[ n16 + 14 ];

}

// Returns the uint32 index of the left child node.
// Note: Although the BVH buffer stores node indices (conceptual node numbers),
// these accessor functions return uint32 indices for direct array access.
// This design prioritizes performance - returning values in the format needed
// at call sites (for array indexing) rather than requiring conversions.
//
// Left child is always immediately after parent (sequential in memory).
export function LEFT_NODE( n32 ) {

	return n32 + UINT32_PER_NODE;

}

// Returns the uint32 index of the right child node.
// The buffer stores the right child as a node index at uint32Array[n32 + 6],
// which is converted to a uint32 index by multiplying by UINT32_PER_NODE.
//
// Example: If node 2 is at byte offset 64:
//   - Stored value: uint32Array[n32 + 6] = 2 (node index)
//   - Returned value: 2 * 8 = 16 (uint32 index for array access)
export function RIGHT_NODE( n32, uint32Array ) {

	// stored value is node index, convert to uint32 index
	return uint32Array[ n32 + 6 ] * UINT32_PER_NODE;

}

export function SPLIT_AXIS( n32, uint32Array ) {

	return uint32Array[ n32 + 7 ];

}

export function BOUNDING_DATA_INDEX( n32 ) {

	return n32;

}
