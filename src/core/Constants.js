// Split strategy constants
export const CENTER = 0;
export const AVERAGE = 1;
export const SAH = 2;

// Traversal constants
export const NOT_INTERSECTED = 0;
export const INTERSECTED = 1;
export const CONTAINED = 2;

// SAH cost constants
// TODO: hone these costs more. The relative difference between them should be the
// difference in measured time to perform a primitive intersection vs traversing
// bounds.
// TODO: could be tuned per primitive type (triangles vs lines vs points)
export const PRIMITIVE_INTERSECT_COST = 1.25;
export const TRAVERSAL_COST = 1;


// Build constants
export const BYTES_PER_NODE = 6 * 4 + 4 + 4;
export const UINT32_PER_NODE = BYTES_PER_NODE / 4;
export const IS_LEAFNODE_FLAG = 0xFFFF;

// Bit masks for 32 bit node data
export const LEAFNODE_MASK_32 = IS_LEAFNODE_FLAG << 16;

// EPSILON for computing floating point error during build
// https://en.wikipedia.org/wiki/Machine_epsilon#Values_for_standard_hardware_floating_point_arithmetics
export const FLOAT32_EPSILON = Math.pow( 2, - 24 );

export const SKIP_GENERATION = Symbol( 'SKIP_GENERATION' );

export const DEFAULT_OPTIONS = {
	strategy: CENTER,
	maxDepth: 40,
	maxLeafSize: 10,
	useSharedArrayBuffer: false,
	setBoundingBox: true,
	onProgress: null,
	indirect: false,
	verbose: true,
	range: null,
	[ SKIP_GENERATION ]: false,
};

