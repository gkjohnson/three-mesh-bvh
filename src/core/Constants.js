// Split strategy constants

/**
 * Splits each BVH node at the center of its longest axis. Fastest to build and
 * yields good performance for most geometry.
 */
export const CENTER = 0;

/**
 * Splits each BVH node at the average centroid position along the longest axis.
 * May produce better results than `CENTER` for irregular geometry.
 */
export const AVERAGE = 1;

/**
 * Uses a Surface Area Heuristic to find the lowest-cost split across 32 candidate
 * positions per axis. Slowest to build but yields the most optimal tree and lowest
 * memory usage.
 */
export const SAH = 2;

// Traversal constants

/**
 * Returned from `intersectsBounds` to indicate the query shape does not intersect
 * the bounding box. Traversal does not descend into this node.
 */
export const NOT_INTERSECTED = 0;

/**
 * Returned from `intersectsBounds` to indicate the query shape intersects the
 * bounding box. Traversal continues into child nodes.
 */
export const INTERSECTED = 1;

/**
 * Returned from `intersectsBounds` to indicate the query shape fully contains the
 * bounding box. All primitives in the subtree are intersected immediately without
 * further bounds testing.
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

