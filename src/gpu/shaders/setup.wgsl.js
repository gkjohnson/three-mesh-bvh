/**
 * Setup shaders: Two passes
 * Pass 1: Compute primitive bounds, initialize nodes, atomic reduce to scene bounds
 * Pass 2: Compute Morton codes using scene bounds
 *
 * Optimization: Uses lock-free integer atomics for scene bounds - eliminates reduction passes
 */

// Pass 1: Compute bounds, initialize state, atomic update scene bounds
export const computeBoundsShader = /* wgsl */ `

struct Uniforms {
	primCount: u32,
	workgroupCount: u32,
	positionStride: u32,
	pad1: u32,
};

struct BVH2Node {
	boundsMin: vec3f,
	leftChild: u32,
	boundsMax: vec3f,
	rightChild: u32,
};

struct Bounds {
	min: vec3f,
	max: vec3f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
// Zero-copy: read packed f32/u32 arrays directly (no vec4 padding)
@group(0) @binding(1) var<storage, read> positions: array<f32>;
@group(0) @binding(2) var<storage, read> indices: array<u32>;
@group(0) @binding(3) var<storage, read_write> bvh2Nodes: array<BVH2Node>;
// Phase 1 optimization: plain u32 instead of atomic - no contention on initial write
@group(0) @binding(4) var<storage, read_write> clusterIdx: array<u32>;
// Atomic scene bounds in sortable-u32 format:
// [minX, minY, minZ, maxX, maxY, maxZ]
@group(0) @binding(5) var<storage, read_write> atomicSceneBounds: array<atomic<u32>, 6>;
// GPU-side initialization: moved from CPU
@group(0) @binding(6) var<storage, read_write> parentIdx: array<u32>;
@group(0) @binding(7) var<storage, read_write> hplocState: array<vec4u>;
@group(0) @binding(8) var<storage, read_write> activeList: array<u32>;

const INVALID_IDX: u32 = 0xFFFFFFFFu;
const WORKGROUP_SIZE: u32 = 256u;

var<workgroup> sharedMin: array<vec3f, WORKGROUP_SIZE>;
var<workgroup> sharedMax: array<vec3f, WORKGROUP_SIZE>;

// Map f32 to sortable u32 so unsigned integer order matches float order.
// Negative values: invert all bits. Non-negative values: set sign bit.
fn f32ToOrderedU32(val: f32) -> u32 {
	let bits = bitcast<u32>(val);
	return select(bits | 0x80000000u, ~bits, (bits & 0x80000000u) != 0u);
}

// Atomic min for f32 via native atomicMin on sortable-u32
fn atomicMinF32(idx: u32, val: f32) {
	atomicMin(&atomicSceneBounds[idx], f32ToOrderedU32(val));
}

// Atomic max for f32 via native atomicMax on sortable-u32
fn atomicMaxF32(idx: u32, val: f32) {
	atomicMax(&atomicSceneBounds[idx], f32ToOrderedU32(val));
}

// Load position from packed f32 array (configurable stride: 3 for vec3, 4 for vec4)
fn loadPosition(vertexIdx: u32) -> vec3f {
	let base = vertexIdx * uniforms.positionStride;
	return vec3f(positions[base], positions[base + 1u], positions[base + 2u]);
}

fn computeTriangleBounds(primIdx: u32) -> Bounds {
	// Load indices from packed u32 array (stride 3)
	let base = primIdx * 3u;
	let i0 = indices[base];
	let i1 = indices[base + 1u];
	let i2 = indices[base + 2u];

	let v0 = loadPosition(i0);
	let v1 = loadPosition(i1);
	let v2 = loadPosition(i2);

	var bounds: Bounds;
	bounds.min = min(min(v0, v1), v2);
	bounds.max = max(max(v0, v1), v2);
	return bounds;
}

@compute @workgroup_size(256)
fn computeBounds(
	@builtin(global_invocation_id) globalId: vec3u,
	@builtin(local_invocation_id) localId: vec3u,
	@builtin(workgroup_id) workgroupId: vec3u
) {
	let primIdx = globalId.x;
	let localIdx = localId.x;

	var localMin = vec3f(1e30);
	var localMax = vec3f(-1e30);

	if (primIdx < uniforms.primCount) {
		let bounds = computeTriangleBounds(primIdx);

		// Store as leaf node
		var node: BVH2Node;
		node.boundsMin = bounds.min;
		node.boundsMax = bounds.max;
		node.leftChild = INVALID_IDX;
		node.rightChild = primIdx;
		bvh2Nodes[primIdx] = node;

		// Initialize cluster index (plain store - no atomic needed)
		clusterIdx[primIdx] = primIdx;

		// GPU-side initialization (moved from CPU)
		parentIdx[primIdx] = INVALID_IDX;

		// hplocState: vec4u(left, right, split, active) - single vectorized write
		hplocState[primIdx] = vec4u(primIdx, primIdx, 0u, 1u);

		// Initialize active list (folded from separate initActiveList dispatch)
		activeList[primIdx] = primIdx;

		localMin = bounds.min;
		localMax = bounds.max;
	}

	sharedMin[localIdx] = localMin;
	sharedMax[localIdx] = localMax;

	workgroupBarrier();

	// Workgroup reduction
	for (var stride = WORKGROUP_SIZE / 2u; stride > 0u; stride = stride >> 1u) {
		if (localIdx < stride) {
			sharedMin[localIdx] = min(sharedMin[localIdx], sharedMin[localIdx + stride]);
			sharedMax[localIdx] = max(sharedMax[localIdx], sharedMax[localIdx + stride]);
		}
		workgroupBarrier();
	}

	// Thread 0 atomically updates global scene bounds (eliminates reduction passes!)
	if (localIdx == 0u) {
		let wgMin = sharedMin[0];
		let wgMax = sharedMax[0];

		// Atomic min for each component of min bounds
		atomicMinF32(0u, wgMin.x);
		atomicMinF32(1u, wgMin.y);
		atomicMinF32(2u, wgMin.z);

		// Atomic max for each component of max bounds
		atomicMaxF32(3u, wgMax.x);
		atomicMaxF32(4u, wgMax.y);
		atomicMaxF32(5u, wgMax.z);
	}
}
`;

// Pass 1b: Final reduction of partial bounds to single scene bounds
export const reduceBoundsShader = /* wgsl */ `

struct Uniforms {
	primCount: u32,
	workgroupCount: u32,
	pad0: u32,
	pad1: u32,
};

struct SceneBounds {
	min: vec3f,
	pad0: f32,
	max: vec3f,
	pad1: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> partialBoundsMin: array<vec4f>;
@group(0) @binding(2) var<storage, read> partialBoundsMax: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> sceneBounds: SceneBounds;

const WORKGROUP_SIZE: u32 = 256u;

var<workgroup> sharedMin: array<vec3f, WORKGROUP_SIZE>;
var<workgroup> sharedMax: array<vec3f, WORKGROUP_SIZE>;

@compute @workgroup_size(256)
fn reduceBounds(
	@builtin(local_invocation_id) localId: vec3u
) {
	let localIdx = localId.x;

	var localMin = vec3f(1e30);
	var localMax = vec3f(-1e30);

	// Load partial results
	if (localIdx < uniforms.workgroupCount) {
		localMin = partialBoundsMin[localIdx].xyz;
		localMax = partialBoundsMax[localIdx].xyz;
	}

	sharedMin[localIdx] = localMin;
	sharedMax[localIdx] = localMax;

	workgroupBarrier();

	// Reduction
	for (var stride = WORKGROUP_SIZE / 2u; stride > 0u; stride = stride >> 1u) {
		if (localIdx < stride) {
			sharedMin[localIdx] = min(sharedMin[localIdx], sharedMin[localIdx + stride]);
			sharedMax[localIdx] = max(sharedMax[localIdx], sharedMax[localIdx + stride]);
		}
		workgroupBarrier();
	}

	// Write final result
	if (localIdx == 0u) {
		sceneBounds.min = sharedMin[0];
		sceneBounds.max = sharedMax[0];
	}
}
`;

// Pass 1b (multi-pass): Reduce partial bounds into a smaller partial set
export const reduceBoundsToPartialShader = /* wgsl */ `

struct Uniforms {
	primCount: u32,
	workgroupCount: u32,
	pad0: u32,
	pad1: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> partialBoundsMinIn: array<vec4f>;
@group(0) @binding(2) var<storage, read> partialBoundsMaxIn: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> partialBoundsMinOut: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> partialBoundsMaxOut: array<vec4f>;

const WORKGROUP_SIZE: u32 = 256u;

var<workgroup> sharedMin: array<vec3f, WORKGROUP_SIZE>;
var<workgroup> sharedMax: array<vec3f, WORKGROUP_SIZE>;

@compute @workgroup_size(256)
fn reduceBoundsToPartial(
	@builtin(local_invocation_id) localId: vec3u,
	@builtin(workgroup_id) workgroupId: vec3u
) {
	let localIdx = localId.x;
	let base = workgroupId.x * WORKGROUP_SIZE;
	let idx = base + localIdx;

	var localMin = vec3f(1e30);
	var localMax = vec3f(-1e30);

	// Load partial results
	if (idx < uniforms.workgroupCount) {
		localMin = partialBoundsMinIn[idx].xyz;
		localMax = partialBoundsMaxIn[idx].xyz;
	}

	sharedMin[localIdx] = localMin;
	sharedMax[localIdx] = localMax;

	workgroupBarrier();

	// Reduction
	for (var stride = WORKGROUP_SIZE / 2u; stride > 0u; stride = stride >> 1u) {
		if (localIdx < stride) {
			sharedMin[localIdx] = min(sharedMin[localIdx], sharedMin[localIdx + stride]);
			sharedMax[localIdx] = max(sharedMax[localIdx], sharedMax[localIdx + stride]);
		}
		workgroupBarrier();
	}

	// Write reduced result
	if (localIdx == 0u) {
		partialBoundsMinOut[workgroupId.x] = vec4f(sharedMin[0], 0.0);
		partialBoundsMaxOut[workgroupId.x] = vec4f(sharedMax[0], 0.0);
	}
}
`;

// Pass 2: Compute Morton codes
export const computeMortonShader = /* wgsl */ `

struct Uniforms {
	primCount: u32,
	workgroupCount: u32,
	pad0: u32,
	pad1: u32,
};

struct BVH2Node {
	boundsMin: vec3f,
	leftChild: u32,
	boundsMax: vec3f,
	rightChild: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> bvh2Nodes: array<BVH2Node>;
// Atomic scene bounds in sortable-u32 format:
// [minX, minY, minZ, maxX, maxY, maxZ]
@group(0) @binding(2) var<storage, read> atomicSceneBounds: array<u32, 6>;
@group(0) @binding(3) var<storage, read_write> mortonCodes: array<u32>;

fn orderedU32ToF32(key: u32) -> f32 {
	let bits = select(key & 0x7FFFFFFFu, ~key, (key & 0x80000000u) == 0u);
	return bitcast<f32>(bits);
}

fn expandBits(v: u32) -> u32 {
	var x = v & 0x3FFu;
	x = (x | (x << 16u)) & 0x030000FFu;
	x = (x | (x << 8u)) & 0x0300F00Fu;
	x = (x | (x << 4u)) & 0x030C30C3u;
	x = (x | (x << 2u)) & 0x09249249u;
	return x;
}

fn computeMortonCode(normalizedPos: vec3f) -> u32 {
	let clamped = clamp(normalizedPos, vec3f(0.0), vec3f(1.0));
	let scaled = vec3u(clamped * 1023.0);

	let xx = expandBits(scaled.x);
	let yy = expandBits(scaled.y);
	let zz = expandBits(scaled.z);

	return (xx << 2u) | (yy << 1u) | zz;
}

@compute @workgroup_size(256)
fn computeMorton(
	@builtin(global_invocation_id) globalId: vec3u
) {
	let primIdx = globalId.x;

	if (primIdx >= uniforms.primCount) {
		return;
	}

	let node = bvh2Nodes[primIdx];
	let centroid = (node.boundsMin + node.boundsMax) * 0.5;

	// Decode scene bounds from sortable-u32 format.
	let sceneMin = vec3f(
		orderedU32ToF32(atomicSceneBounds[0]),
		orderedU32ToF32(atomicSceneBounds[1]),
		orderedU32ToF32(atomicSceneBounds[2])
	);
	let sceneMax = vec3f(
		orderedU32ToF32(atomicSceneBounds[3]),
		orderedU32ToF32(atomicSceneBounds[4]),
		orderedU32ToF32(atomicSceneBounds[5])
	);

	let sceneExtent = sceneMax - sceneMin;
	let safeExtent = select(sceneExtent, vec3f(1.0), sceneExtent == vec3f(0.0));

	let normalized = (centroid - sceneMin) / safeExtent;
	mortonCodes[primIdx] = computeMortonCode(normalized);
}
`;

// Subgroup-optimized version: uses subgroupMin/Max to reduce within subgroups first
// This reduces workgroup barriers from 8 to ~3 (for subgroup_size=32)
export const computeBoundsSubgroupShader = /* wgsl */ `
enable subgroups;

struct Uniforms {
	primCount: u32,
	workgroupCount: u32,
	positionStride: u32,
	pad1: u32,
};

struct BVH2Node {
	boundsMin: vec3f,
	leftChild: u32,
	boundsMax: vec3f,
	rightChild: u32,
};

struct Bounds {
	min: vec3f,
	max: vec3f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> positions: array<f32>;
@group(0) @binding(2) var<storage, read> indices: array<u32>;
@group(0) @binding(3) var<storage, read_write> bvh2Nodes: array<BVH2Node>;
@group(0) @binding(4) var<storage, read_write> clusterIdx: array<u32>;
@group(0) @binding(5) var<storage, read_write> atomicSceneBounds: array<atomic<u32>, 6>;
@group(0) @binding(6) var<storage, read_write> parentIdx: array<u32>;
@group(0) @binding(7) var<storage, read_write> hplocState: array<vec4u>;
@group(0) @binding(8) var<storage, read_write> activeList: array<u32>;

const INVALID_IDX: u32 = 0xFFFFFFFFu;
const WORKGROUP_SIZE: u32 = 256u;

// Shared memory sized for worst case (subgroupSize=1 means 256 subgroups)
// Most GPUs have subgroupSize=32, so only 8 slots used, but we need to be safe
var<workgroup> sharedMin: array<vec3f, WORKGROUP_SIZE>;
var<workgroup> sharedMax: array<vec3f, WORKGROUP_SIZE>;

fn f32ToOrderedU32(val: f32) -> u32 {
	let bits = bitcast<u32>(val);
	return select(bits | 0x80000000u, ~bits, (bits & 0x80000000u) != 0u);
}

fn atomicMinF32(idx: u32, val: f32) {
	atomicMin(&atomicSceneBounds[idx], f32ToOrderedU32(val));
}

fn atomicMaxF32(idx: u32, val: f32) {
	atomicMax(&atomicSceneBounds[idx], f32ToOrderedU32(val));
}

fn loadPosition(vertexIdx: u32) -> vec3f {
	let base = vertexIdx * uniforms.positionStride;
	return vec3f(positions[base], positions[base + 1u], positions[base + 2u]);
}

fn computeTriangleBounds(primIdx: u32) -> Bounds {
	let base = primIdx * 3u;
	let i0 = indices[base];
	let i1 = indices[base + 1u];
	let i2 = indices[base + 2u];

	let v0 = loadPosition(i0);
	let v1 = loadPosition(i1);
	let v2 = loadPosition(i2);

	var bounds: Bounds;
	bounds.min = min(min(v0, v1), v2);
	bounds.max = max(max(v0, v1), v2);
	return bounds;
}

@compute @workgroup_size(256)
fn computeBounds(
	@builtin(global_invocation_id) globalId: vec3u,
	@builtin(local_invocation_id) localId: vec3u,
	@builtin(subgroup_invocation_id) subgroupInvocationId: u32,
	@builtin(subgroup_size) subgroupSize: u32
) {
	let primIdx = globalId.x;
	let localIdx = localId.x;
	let subgroupIdx = localIdx / subgroupSize;

	var localMin = vec3f(1e30);
	var localMax = vec3f(-1e30);

	if (primIdx < uniforms.primCount) {
		let bounds = computeTriangleBounds(primIdx);

		// Store as leaf node
		var node: BVH2Node;
		node.boundsMin = bounds.min;
		node.boundsMax = bounds.max;
		node.leftChild = INVALID_IDX;
		node.rightChild = primIdx;
		bvh2Nodes[primIdx] = node;

		// Initialize cluster index
		clusterIdx[primIdx] = primIdx;

		// GPU-side initialization
		parentIdx[primIdx] = INVALID_IDX;

		// hplocState: vec4u(left, right, split, active) - single vectorized write
		hplocState[primIdx] = vec4u(primIdx, primIdx, 0u, 1u);

		// Initialize active list (folded from separate initActiveList dispatch)
		activeList[primIdx] = primIdx;

		localMin = bounds.min;
		localMax = bounds.max;
	}

	// Subgroup reduction - no barrier needed, hardware handles it
	let sgMinX = subgroupMin(localMin.x);
	let sgMinY = subgroupMin(localMin.y);
	let sgMinZ = subgroupMin(localMin.z);
	let sgMaxX = subgroupMax(localMax.x);
	let sgMaxY = subgroupMax(localMax.y);
	let sgMaxZ = subgroupMax(localMax.z);

	// subgroupSize is uniform within workgroup, so this is uniform (no barrier needed)
	let subgroupCount = WORKGROUP_SIZE / subgroupSize;

	// First thread of each subgroup writes to shared memory
	if (subgroupInvocationId == 0u) {
		sharedMin[subgroupIdx] = vec3f(sgMinX, sgMinY, sgMinZ);
		sharedMax[subgroupIdx] = vec3f(sgMaxX, sgMaxY, sgMaxZ);
	}

	workgroupBarrier();

	// Final reduction: tree reduction across subgroup results
	// Use fixed iteration count for uniform control flow (8 iterations covers up to 256 subgroups)
	// Each iteration halves the active range until only element 0 remains
	for (var s = 128u; s > 0u; s = s >> 1u) {
		// Only reduce if this stride is within our subgroup count
		if (s < subgroupCount && localIdx < s) {
			sharedMin[localIdx] = min(sharedMin[localIdx], sharedMin[localIdx + s]);
			sharedMax[localIdx] = max(sharedMax[localIdx], sharedMax[localIdx + s]);
		}
		workgroupBarrier();
	}

	// Thread 0 atomically updates global scene bounds
	if (localIdx == 0u) {
		let wgMin = sharedMin[0];
		let wgMax = sharedMax[0];
		atomicMinF32(0u, wgMin.x);
		atomicMinF32(1u, wgMin.y);
		atomicMinF32(2u, wgMin.z);
		atomicMaxF32(3u, wgMax.x);
		atomicMaxF32(4u, wgMax.y);
		atomicMaxF32(5u, wgMax.z);
	}
}
`;

// Combined export for backwards compatibility
export const setupShader = computeBoundsShader;

export const setupShaders = {
	computeBounds: computeBoundsShader,
	computeBoundsSubgroup: computeBoundsSubgroupShader,
	reduceBounds: reduceBoundsShader,
	reduceBoundsToPartial: reduceBoundsToPartialShader,
	computeMorton: computeMortonShader,
};
