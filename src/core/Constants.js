// Split strategy constants

/**
 * Option for splitting each BVH node down the center of the longest axis of the bounds.
 *
 * This is the fastest construction option and will yield a good, performant bounds.
 */
export const CENTER = 0;

/**
 * Option for splitting each BVH node at the average point along the longest axis for
 * all triangle centroids in the bounds.
 *
 * This strategy may be better than `CENTER` with some geometry.
 */
export const AVERAGE = 1;

/**
 * Option to use a Surface Area Heuristic to split the bounds more optimally. This SAH
 * implementation tests 32 discrete splits in each node along each axis to determine
 * which split is the lowest cost.
 *
 * This is the slowest construction option but will yield the best bounds of the three
 * options and use the least memory.
 */
export const SAH = 2;

// Traversal constants

/**
 * Indicates the shape did not intersect the given bounding box.
 */
export const NOT_INTERSECTED = 0;

/**
 * Indicates the shape did intersect the given bounding box.
 */
export const INTERSECTED = 1;

/**
 * Indicate the shape entirely contains the given bounding box.
 */
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

