/**
 * Refit shaders for GPU BVH2:
 * 1) buildParentMap: derive parent index for every node from child pointers.
 * 2) refitLeaves: update all leaf bounds and append ready parents.
 * 3) refitInternalWave: process ready internal nodes and append next-wave parents.
 *
 * Topology remains fixed. Only node bounds are updated.
 */

export const refitBuildParentsShader = /* wgsl */ `

struct BVH2Node {
	boundsMin: vec3f,
	leftChild: u32,
	boundsMax: vec3f,
	rightChild: u32,
};

@group(0) @binding(0) var<storage, read> bvh2Nodes: array<BVH2Node>;
@group(0) @binding(1) var<storage, read_write> nodeCounter: atomic<u32>;
@group(0) @binding(2) var<storage, read_write> parentIdx: array<u32>;
@group(0) @binding(3) var<storage, read> clusterIdx: array<u32>;

const INVALID_IDX: u32 = 0xFFFFFFFFu;

@compute @workgroup_size(256)
fn buildParentMap(
	@builtin(global_invocation_id) globalId: vec3u
) {
	let nodeIdx = globalId.x;
	let nodeCount = atomicLoad(&nodeCounter);
	if (nodeIdx >= nodeCount) {
		return;
	}

	let node = bvh2Nodes[nodeIdx];
	if (node.leftChild != INVALID_IDX) {
		parentIdx[node.leftChild] = nodeIdx;
		parentIdx[node.rightChild] = nodeIdx;
	}

	// Mark root as self-parent so refit traversal has a stable termination condition.
	if (nodeIdx == 0u) {
		let rootIdx = clusterIdx[0];
		parentIdx[rootIdx] = rootIdx;
	}
}
`;

export const refitBVHLeavesShader = /* wgsl */ `

struct Uniforms {
	primCount: u32,
	positionStride: u32,
	pad0: u32,
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
@group(0) @binding(4) var<storage, read> parentIdx: array<u32>;
@group(0) @binding(5) var<storage, read_write> visitCount: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> activeListOut: array<u32>;
@group(0) @binding(7) var<storage, read_write> activeCountOut: atomic<u32>;

const INVALID_IDX: u32 = 0xFFFFFFFFu;
const WORKGROUP_SIZE: u32 = 256u;

var<workgroup> sharedPrefix: array<u32, 256>;
var<workgroup> uReadyCount: u32;
var<workgroup> uActiveListBase: u32;

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
fn refitLeaves(
	@builtin(global_invocation_id) globalId: vec3u,
	@builtin(local_invocation_id) localId: vec3u
) {
	let primIdx = globalId.x;
	let localIdx = localId.x;

	var readyParent = INVALID_IDX;
	var isReady = false;

	if (primIdx < uniforms.primCount) {
		// 1) Update leaf bounds
		let leafBounds = computeTriangleBounds(primIdx);
		bvh2Nodes[primIdx].boundsMin = leafBounds.min;
		bvh2Nodes[primIdx].boundsMax = leafBounds.max;

		// 2) Signal parent and mark ready on second arrival
		let p = parentIdx[primIdx];
		if (p != primIdx && p != INVALID_IDX) {
			let old = atomicAdd(&visitCount[p], 1u);
			if (old == 1u) {
				isReady = true;
				readyParent = p;
			}
		}
	}

	// Workgroup-aggregated append: one global atomicAdd per workgroup.
	sharedPrefix[localIdx] = select(0u, 1u, isReady);
	workgroupBarrier();

	for (var stride = 1u; stride < WORKGROUP_SIZE; stride = stride * 2u) {
		var addVal = 0u;
		if (localIdx >= stride) {
			addVal = sharedPrefix[localIdx - stride];
		}
		workgroupBarrier();
		sharedPrefix[localIdx] = sharedPrefix[localIdx] + addVal;
		workgroupBarrier();
	}

	if (localIdx == 0u) {
		uReadyCount = sharedPrefix[WORKGROUP_SIZE - 1u];
		var base = 0u;
		if (uReadyCount > 0u) {
			base = atomicAdd(&activeCountOut, uReadyCount);
		}
		uActiveListBase = base;
	}

	let readyCount = workgroupUniformLoad(&uReadyCount);
	let activeBase = workgroupUniformLoad(&uActiveListBase);
	if (isReady && readyCount > 0u) {
		let outIdx = activeBase + (sharedPrefix[localIdx] - 1u);
		activeListOut[outIdx] = readyParent;
	}
}
`;

export function getRefitBVHInternalShader( workgroupSize = 256 ) {

	const wgSize = Math.max( 1, Math.floor( workgroupSize ) );
	return /* wgsl */ `

struct BVH2Node {
	boundsMin: vec3f,
	leftChild: u32,
	boundsMax: vec3f,
	rightChild: u32,
};

@group(0) @binding(0) var<storage, read_write> bvh2Nodes: array<BVH2Node>;
@group(0) @binding(1) var<storage, read> parentIdx: array<u32>;
@group(0) @binding(2) var<storage, read_write> visitCount: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read> activeListIn: array<u32>;
@group(0) @binding(4) var<storage, read_write> activeListOut: array<u32>;
@group(0) @binding(5) var<storage, read_write> activeCountIn: atomic<u32>;
@group(0) @binding(6) var<storage, read_write> activeCountOut: atomic<u32>;

const INVALID_IDX: u32 = 0xFFFFFFFFu;
const WORKGROUP_SIZE: u32 = ${wgSize}u;

var<workgroup> sharedPrefix: array<u32, ${wgSize}>;
var<workgroup> uReadyCount: u32;
var<workgroup> uActiveListBase: u32;

@compute @workgroup_size(${wgSize})
fn refitInternalWave(
	@builtin(global_invocation_id) globalId: vec3u,
	@builtin(local_invocation_id) localId: vec3u
) {
	let threadIdx = globalId.x;
	let localIdx = localId.x;
	let activeCount = atomicLoad(&activeCountIn);

	var readyParent = INVALID_IDX;
	var isReady = false;

	if (threadIdx < activeCount) {
		let nodeIdx = activeListIn[threadIdx];
		if (nodeIdx != INVALID_IDX) {
			let node = bvh2Nodes[nodeIdx];
			let c0 = node.leftChild;
			let c1 = node.rightChild;
			if (c0 != INVALID_IDX && c1 != INVALID_IDX) {
				let mergedMin = min(bvh2Nodes[c0].boundsMin, bvh2Nodes[c1].boundsMin);
				let mergedMax = max(bvh2Nodes[c0].boundsMax, bvh2Nodes[c1].boundsMax);
				bvh2Nodes[nodeIdx].boundsMin = mergedMin;
				bvh2Nodes[nodeIdx].boundsMax = mergedMax;

				let p = parentIdx[nodeIdx];
				if (p != nodeIdx && p != INVALID_IDX) {
					let old = atomicAdd(&visitCount[p], 1u);
					if (old == 1u) {
						isReady = true;
						readyParent = p;
					}
				}
			}
		}
	}

	// Workgroup-aggregated append: one global atomicAdd per workgroup.
	sharedPrefix[localIdx] = select(0u, 1u, isReady);
	workgroupBarrier();

	for (var stride = 1u; stride < WORKGROUP_SIZE; stride = stride * 2u) {
		var addVal = 0u;
		if (localIdx >= stride) {
			addVal = sharedPrefix[localIdx - stride];
		}
		workgroupBarrier();
		sharedPrefix[localIdx] = sharedPrefix[localIdx] + addVal;
		workgroupBarrier();
	}

	if (localIdx == 0u) {
		uReadyCount = sharedPrefix[WORKGROUP_SIZE - 1u];
		var base = 0u;
		if (uReadyCount > 0u) {
			base = atomicAdd(&activeCountOut, uReadyCount);
		}
		uActiveListBase = base;
	}

	let readyCount = workgroupUniformLoad(&uReadyCount);
	let activeBase = workgroupUniformLoad(&uActiveListBase);
	if (isReady && readyCount > 0u) {
		let outIdx = activeBase + (sharedPrefix[localIdx] - 1u);
		activeListOut[outIdx] = readyParent;
	}
}
`;

}
