/**
 * H-PLOC (Hierarchical Parallel Locally-Ordered Clustering) shader.
 *
 * Threading model: 1 thread per primitive (not 1 workgroup per primitive)
 * Each thread does its own LBVH traversal.
 * When a thread's range exceeds threshold, the workgroup collaborates on PLOC merging.
 *
 * Multi-dispatch version with LBVH multi-step optimization:
 * - While range is small (≤ MERGING_THRESHOLD), do multiple LBVH steps per dispatch
 * - This is safe because small ranges only use parentIdx atomics (device-wide visibility)
 * - Exit loop when: sibling not arrived, OR range needs PLOC merging
 * - Thread state is persisted in global buffers between dispatches
 * - This optimization significantly reduces total dispatch count
 */

const sharedHplocCode = /* wgsl */ `

struct Uniforms {
	primCount: u32,
	bitOffset: u32,
	pad0: u32,
	pad1: u32,
};

struct BVH2Node {
	boundsMin: vec3f,
	leftChild: u32,
	boundsMax: vec3f,
	rightChild: u32,
};

struct AABB {
	min: vec3f,
	max: vec3f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> mortonCodes: array<u32>;
// Phase 1 optimization: plain u32 instead of atomic - H-PLOC guarantees disjoint range access
@group(0) @binding(2) var<storage, read_write> clusterIdx: array<u32>;
@group(0) @binding(3) var<storage, read_write> parentIdx: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> bvh2Nodes: array<BVH2Node>;
@group(0) @binding(5) var<storage, read_write> nodeCounter: atomic<u32>;

// Persistent state buffer (for multi-dispatch)
// Each primitive's state is vec4u(left, right, split, active)
@group(0) @binding(6) var<storage, read_write> state: array<vec4u>;
// activeCount removed - was pure overhead (never used for early termination)

const INVALID_IDX: u32 = 0xFFFFFFFFu;
// WG=64 is optimal - larger sizes hit shared memory/occupancy limits
const WORKGROUP_SIZE: u32 = 64u;
const SEARCH_RADIUS: u32 = 8u;
// Must be <= WORKGROUP_SIZE/2 because two combining ranges could each have
// up to MERGING_THRESHOLD clusters, and PLOC can only load WORKGROUP_SIZE total
const MERGING_THRESHOLD: u32 = 32u;

// Shared memory for PLOC merging
var<workgroup> sharedClusterIdx: array<u32, 64>;
var<workgroup> sharedBoundsMin: array<vec3f, 64>;
var<workgroup> sharedBoundsMax: array<vec3f, 64>;
var<workgroup> sharedNearestNeighbor: array<u32, 64>;

// Per-thread state shared for collaboration
var<workgroup> sharedLeft: array<u32, 64>;
var<workgroup> sharedRight: array<u32, 64>;
var<workgroup> sharedSplit: array<u32, 64>;
var<workgroup> sharedActive: array<u32, 64>;
var<workgroup> sharedNeedsMerge: array<u32, 64>;

// Parallel compaction support (Hillis-Steele prefix sum)
var<workgroup> sharedPrefixSum: array<u32, 64>;
var<workgroup> sharedTempIdx: array<u32, 64>;
var<workgroup> sharedTempMin: array<vec3f, 64>;
var<workgroup> sharedTempMax: array<vec3f, 64>;

// Compacted merge list (indices of threads that need PLOC merging)
// Separate from other arrays to avoid corruption during PLOC inner loop
var<workgroup> sharedMergeList: array<u32, 64>;

// Broadcast variables (read via workgroupUniformLoad for uniform control flow)
var<workgroup> uAnyActive: u32;
var<workgroup> uMergeLeft: u32;
var<workgroup> uMergeRight: u32;
var<workgroup> uMergeSplit: u32;
var<workgroup> uIsFinal: u32;
var<workgroup> uNewNumPrim: u32;
var<workgroup> uNeedsMergeT: u32;

// Returns common prefix length (higher = more similar, lower = more divergent)
// Uses countLeadingZeros for canonical LBVH parent selection
fn delta(a: u32, b: u32) -> u32 {
	let mcA = mortonCodes[a];
	let mcB = mortonCodes[b];
	let xorVal = mcA ^ mcB;
	if (xorVal == 0u) {
		// Equal morton codes: use index to break ties
		// Add 32 to ensure this is always > any CLZ(xorVal)
		return 32u + countLeadingZeros(a ^ b);
	}
	return countLeadingZeros(xorVal);
}

fn findParentId(left: u32, right: u32, primCount: u32) -> u32 {
	if (left == 0u) {
		return right;
	}
	if (right == primCount - 1u) {
		return left - 1u;
	}

	let deltaRight = delta(right, right + 1u);
	let deltaLeft = delta(left - 1u, left);

	// With CLZ-based delta: higher = longer prefix = less divergent
	// Return right when right boundary is LESS divergent (higher CLZ)
	if (deltaRight > deltaLeft) {
		return right;
	}
	return left - 1u;
}

fn aabbArea(boundsMin: vec3f, boundsMax: vec3f) -> f32 {
	let extent = boundsMax - boundsMin;
	return 2.0 * (extent.x * extent.y + extent.y * extent.z + extent.z * extent.x);
}

@compute @workgroup_size(64)
fn hplocBuild(
	@builtin(global_invocation_id) globalId: vec3u,
	@builtin(local_invocation_id) localId: vec3u,
	@builtin(workgroup_id) workgroupId: vec3u
) {
	let localIdx = localId.x;
	let primIdx = globalId.x;  // One thread per primitive

	// OOB guard: threads beyond primCount are inactive and don't access state
	// IMPORTANT: Don't use select() for OOB guard - WGSL may evaluate both arguments
	let isOOB = primIdx >= uniforms.primCount;

	// Load persistent state from global buffer (vec4u per primitive)
	// OOB threads use dummy values (won't be written back)
	var stateVec = vec4u(0u);
	if (!isOOB) {
		stateVec = state[primIdx];
	}
	var left = stateVec.x;
	var right = stateVec.y;
	var split = stateVec.z;
	var isActive = stateVec.w != 0u && !isOOB;

	// Store state in shared memory for workgroup collaboration
	sharedLeft[localIdx] = left;
	sharedRight[localIdx] = right;
	sharedSplit[localIdx] = split;
	sharedActive[localIdx] = select(0u, 1u, isActive);
	sharedNeedsMerge[localIdx] = 0u;

	workgroupBarrier();

	// Check if any thread in workgroup is still active
	if (localIdx == 0u) {
		var anyActive = 0u;
		for (var i = 0u; i < WORKGROUP_SIZE; i = i + 1u) {
			anyActive = anyActive | sharedActive[i];
		}
		uAnyActive = anyActive;
	}
	// workgroupUniformLoad includes an implicit barrier AND tells compiler the value is uniform
	// This is required for uniform control flow analysis
	let anyActive = workgroupUniformLoad(&uAnyActive);

	// Early exit if no active threads - still need to save state
	if (anyActive == 0u) {
		// Save state (unchanged) - OOB threads don't write
		if (!isOOB) {
			state[primIdx] = vec4u(left, right, split, 0u);
		}
		return;
	}

	// ===== MULTI-STEP LBVH OPTIMIZATION =====
	// Do multiple LBVH traversal steps while range is small (no PLOC merging needed).
	// This is safe because small ranges don't write to clusterIdx - only parentIdx via atomics.
	// Atomics have device-wide visibility within a single dispatch.
	// Exit loop when: sibling not arrived, OR range needs PLOC merging.
	// IMPORTANT: Always try at least one LBVH step, THEN check if more steps are safe.

	var rangeSize = right - left + 1u;

	while (isActive) {
		// LBVH traversal step FIRST (always try at least one per dispatch)
		let parentId = findParentId(left, right, uniforms.primCount);
		var previousId = INVALID_IDX;

		if (parentId == right) {
			previousId = atomicExchange(&parentIdx[right], left);
			if (previousId != INVALID_IDX) {
				split = right + 1u;
				right = previousId;
			}
		} else {
			previousId = atomicExchange(&parentIdx[left - 1u], right);
			if (previousId != INVALID_IDX) {
				split = left;
				left = previousId;
			}
		}

		// If sibling hasn't arrived yet, become inactive and wait for next dispatch
		if (previousId == INVALID_IDX) {
			isActive = false;
			break;
		}

		// Sibling arrived - update range size
		rangeSize = right - left + 1u;

		// Check if PLOC merging is needed - must exit loop for cross-workgroup coordination
		if (rangeSize > MERGING_THRESHOLD || rangeSize == uniforms.primCount) {
			break;
		}

		// Range is still small - safe to continue with another LBVH step
	}

	// Update shared state
	sharedLeft[localIdx] = left;
	sharedRight[localIdx] = right;
	sharedSplit[localIdx] = split;
	sharedActive[localIdx] = select(0u, 1u, isActive);

	// Check if this thread needs merging
	let isFinal = isActive && (rangeSize == uniforms.primCount);
	let needsMerge = isActive && ((rangeSize > MERGING_THRESHOLD) || isFinal);
	sharedNeedsMerge[localIdx] = select(0u, 1u, needsMerge);

	workgroupBarrier();

	// Build compacted merge list to avoid O(WORKGROUP_SIZE) barriers
	// Previously: 64 iterations with workgroupUniformLoad each = 64 implicit barriers
	// Now: numMerges + 1 barriers (typical case: 1-3 merges = ~60 barriers saved)
	// NOTE: Use dedicated sharedMergeList array to avoid corruption by PLOC inner loop
	if (localIdx == 0u) {
		var mergeCount = 0u;
		for (var i = 0u; i < WORKGROUP_SIZE; i = i + 1u) {
			if (sharedNeedsMerge[i] != 0u) {
				sharedMergeList[mergeCount] = i;
				mergeCount = mergeCount + 1u;
			}
		}
		uNewNumPrim = mergeCount;
	}
	let numMerges = workgroupUniformLoad(&uNewNumPrim);

	// Process only threads that need merging (compacted list)
	for (var m = 0u; m < numMerges; m = m + 1u) {
		// Broadcast which thread index to process
		if (localIdx == 0u) {
			uNeedsMergeT = sharedMergeList[m];
		}
		let t = workgroupUniformLoad(&uNeedsMergeT);

		// Broadcast this thread's state to all
		if (localIdx == 0u) {
			uMergeLeft = sharedLeft[t];
			uMergeRight = sharedRight[t];
			uMergeSplit = sharedSplit[t];
			let tRangeSize = sharedRight[t] - sharedLeft[t] + 1u;
			uIsFinal = select(0u, 1u, tRangeSize == uniforms.primCount);
		}
		// workgroupUniformLoad handles synchronization AND marks value as uniform
		let mergeLeft = workgroupUniformLoad(&uMergeLeft);
		let mergeRight = workgroupUniformLoad(&uMergeRight);
		let mergeSplit = workgroupUniformLoad(&uMergeSplit);
		let mergeFinal = workgroupUniformLoad(&uIsFinal) != 0u;

		// Load clusters from left and right ranges
		// Load up to half WORKGROUP_SIZE from each child to maximize coverage
		// Left child: [mergeLeft, mergeSplit)
		// Right child: [mergeSplit, mergeRight+1)
		let totalLeft = mergeSplit - mergeLeft;
		let totalRight = mergeRight - mergeSplit + 1u;
		let halfWorkgroup = WORKGROUP_SIZE / 2u;
		let leftCount = min(totalLeft, halfWorkgroup);
		let rightCount = min(totalRight, halfWorkgroup);
		// Remember original loaded count - we need to write this many back
		let originalLoadedCount = leftCount + rightCount;
		var numPrim = originalLoadedCount;

		// Load cluster indices (some might be INVALID from previous merges)
		var loadedIdx = INVALID_IDX;
		if (localIdx < numPrim) {
			var loadIdx: u32;
			if (localIdx < leftCount) {
				loadIdx = mergeLeft + localIdx;
			} else {
				loadIdx = mergeSplit + (localIdx - leftCount);
			}
			loadedIdx = clusterIdx[loadIdx];
		}
		sharedClusterIdx[localIdx] = loadedIdx;
		workgroupBarrier();

		// Thread 0 compacts valid clusters (skip INVALID)
		if (localIdx == 0u) {
			var validCount = 0u;
			for (var i = 0u; i < numPrim; i = i + 1u) {
				let idx = sharedClusterIdx[i];
				if (idx != INVALID_IDX) {
					sharedNearestNeighbor[validCount] = idx;
					validCount = validCount + 1u;
				}
			}
			uNewNumPrim = validCount;
		}
		// workgroupUniformLoad handles synchronization AND marks value as uniform
		numPrim = workgroupUniformLoad(&uNewNumPrim);

		// Copy compacted indices back and load bounds
		// Also mark positions beyond numPrim as INVALID
		if (localIdx < numPrim) {
			let cIdx = sharedNearestNeighbor[localIdx];
			sharedClusterIdx[localIdx] = cIdx;

			let node = bvh2Nodes[cIdx];
			sharedBoundsMin[localIdx] = node.boundsMin;
			sharedBoundsMax[localIdx] = node.boundsMax;
		} else if (localIdx < originalLoadedCount) {
			// Mark remaining positions as INVALID
			sharedClusterIdx[localIdx] = INVALID_IDX;
		}
		workgroupBarrier();

		// Merge threshold: 1 if final (merge down to single root), else MERGING_THRESHOLD
		let threshold = select(MERGING_THRESHOLD, 1u, mergeFinal);

		// PLOC merging iterations
		for (var mergeIter = 0u; mergeIter < 32u; mergeIter = mergeIter + 1u) {
			if (numPrim <= threshold) {
				break;  // Uniform - numPrim is same for all threads
			}

			// Find nearest neighbor
			var nearestIdx = INVALID_IDX;
			var nearestCost = 1e30f;

			if (localIdx < numPrim) {
				let myMin = sharedBoundsMin[localIdx];
				let myMax = sharedBoundsMax[localIdx];

				let searchStart = select(0u, localIdx - SEARCH_RADIUS, localIdx >= SEARCH_RADIUS);
				let searchEnd = min(localIdx + SEARCH_RADIUS + 1u, numPrim);

				for (var j = searchStart; j < searchEnd; j = j + 1u) {
					if (j != localIdx) {
						let otherMin = sharedBoundsMin[j];
						let otherMax = sharedBoundsMax[j];
						let mergedMin = min(myMin, otherMin);
						let mergedMax = max(myMax, otherMax);
						let cost = aabbArea(mergedMin, mergedMax);

						if (cost < nearestCost) {
							nearestCost = cost;
							nearestIdx = j;
						}
					}
				}
				sharedNearestNeighbor[localIdx] = nearestIdx;
			}
			workgroupBarrier();

			// Determine merges (mutual nearest neighbors, lower index merges)
			var shouldMerge = false;
			if (localIdx < numPrim) {
				let myNearest = sharedNearestNeighbor[localIdx];
				if (myNearest != INVALID_IDX && myNearest < numPrim) {
					let theirNearest = sharedNearestNeighbor[myNearest];
					if (theirNearest == localIdx && localIdx < myNearest) {
						shouldMerge = true;
					}
				}
			}
			workgroupBarrier();

			// Perform merges and create BVH nodes
			// Phase 1 optimization: removed redundant atomicLoad - the atomicAdd handles overflow
			let maxNodes = 2u * uniforms.primCount;
			if (shouldMerge) {
				let myNearest = sharedNearestNeighbor[localIdx];
				let leftCluster = sharedClusterIdx[localIdx];
				let rightCluster = sharedClusterIdx[myNearest];

				let mergedMin = min(sharedBoundsMin[localIdx], sharedBoundsMin[myNearest]);
				let mergedMax = max(sharedBoundsMax[localIdx], sharedBoundsMax[myNearest]);

				let newNodeIdx = atomicAdd(&nodeCounter, 1u);
				if (newNodeIdx < maxNodes) {
					bvh2Nodes[newNodeIdx].boundsMin = mergedMin;
					bvh2Nodes[newNodeIdx].boundsMax = mergedMax;
					bvh2Nodes[newNodeIdx].leftChild = leftCluster;
					bvh2Nodes[newNodeIdx].rightChild = rightCluster;

					sharedClusterIdx[localIdx] = newNodeIdx;
					sharedBoundsMin[localIdx] = mergedMin;
					sharedBoundsMax[localIdx] = mergedMax;
				}
			}
			workgroupBarrier();

			// Parallel compaction using Hillis-Steele prefix sum
			// Step 1: Each thread determines if it survives
			var survives = false;
			if (localIdx < numPrim) {
				survives = true;
				let myNearest = sharedNearestNeighbor[localIdx];
				if (myNearest != INVALID_IDX && myNearest < numPrim) {
					let theirNearest = sharedNearestNeighbor[myNearest];
					// I was merged INTO if their nearest is me AND they have lower index
					if (theirNearest == localIdx && myNearest < localIdx) {
						survives = false;
					}
				}
			}

			// Step 2: Store survival flag for prefix sum
			sharedPrefixSum[localIdx] = select(0u, 1u, survives);
			workgroupBarrier();

			// Step 3: Hillis-Steele inclusive prefix sum (log2(32) = 5 iterations)
			for (var stride = 1u; stride < WORKGROUP_SIZE; stride = stride * 2u) {
				var addVal = 0u;
				if (localIdx >= stride) {
					addVal = sharedPrefixSum[localIdx - stride];
				}
				workgroupBarrier();
				sharedPrefixSum[localIdx] = sharedPrefixSum[localIdx] + addVal;
				workgroupBarrier();
			}

			// Step 4: Get total survivors (uniform read)
			if (localIdx == 0u) {
				// Last valid element contains total count
				uNewNumPrim = select(0u, sharedPrefixSum[numPrim - 1u], numPrim > 0u);
			}
			// workgroupUniformLoad handles synchronization AND marks value as uniform
			let newNumPrim = workgroupUniformLoad(&uNewNumPrim);

			// Step 5: Parallel scatter to temp arrays
			if (survives && localIdx < numPrim) {
				let writePos = sharedPrefixSum[localIdx] - 1u;  // Convert inclusive to exclusive
				sharedTempIdx[writePos] = sharedClusterIdx[localIdx];
				sharedTempMin[writePos] = sharedBoundsMin[localIdx];
				sharedTempMax[writePos] = sharedBoundsMax[localIdx];
			}
			workgroupBarrier();

			// Step 6: Copy back from temp and mark remaining as INVALID
			if (localIdx < newNumPrim) {
				sharedClusterIdx[localIdx] = sharedTempIdx[localIdx];
				sharedBoundsMin[localIdx] = sharedTempMin[localIdx];
				sharedBoundsMax[localIdx] = sharedTempMax[localIdx];
			} else if (localIdx < numPrim) {
				sharedClusterIdx[localIdx] = INVALID_IDX;
			}
			numPrim = newNumPrim;
			workgroupBarrier();
		}

		// Write results back to clusterIdx
		// Write ALL originalLoadedCount entries to [mergeLeft, mergeLeft + originalLoadedCount)
		// This matches CUDA's StoreIndices which writes numLeft + numRight entries
		// Positions [numPrim, originalLoadedCount) contain INVALID_IDX from compaction
		if (localIdx < originalLoadedCount) {
			clusterIdx[mergeLeft + localIdx] = sharedClusterIdx[localIdx];
		}
		// storageBarrier not needed - GPU barrier between dispatches handles visibility
		workgroupBarrier();

		// Clear the merge flag for this thread
		sharedNeedsMerge[t] = 0u;

		// Final merge complete: deactivate this thread (tree is done)
		// After final merge, numPrim=1 means root is built
		if (mergeFinal && numPrim <= 1u) {
			sharedActive[t] = 0u;
			// Update local isActive if this is our thread
			if (localIdx == t) {
				isActive = false;
			}
		}
		workgroupBarrier();
	}

	// ===== END OF ONE ITERATION =====

	// Save state to global buffer for next dispatch (vec4u per primitive)
	// OOB threads don't write back
	if (!isOOB) {
		state[primIdx] = vec4u(left, right, split, select(0u, 1u, isActive));
	}
}
`;

export const hplocShader = sharedHplocCode;

/**
 * Indirect dispatch version of H-PLOC for reduced workgroup launches.
 *
 * Instead of launching threads for ALL primitives every iteration,
 * we maintain an "active list" of primitives that still need work.
 * Each dispatch only processes active primitives, and writes still-active
 * ones to the output list for the next iteration.
 *
 * Reduces total workgroup launches from O(primCount × iterations) to
 * O(sum of active counts), which is much smaller due to geometric decay.
 */
export const hplocShaderIndirect = /* wgsl */ `

struct Uniforms {
	primCount: u32,
	bitOffset: u32,
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
@group(0) @binding(1) var<storage, read> mortonCodes: array<u32>;
@group(0) @binding(2) var<storage, read_write> clusterIdx: array<u32>;
@group(0) @binding(3) var<storage, read_write> parentIdx: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> bvh2Nodes: array<BVH2Node>;
@group(0) @binding(5) var<storage, read_write> nodeCounter: atomic<u32>;
@group(0) @binding(6) var<storage, read_write> state: array<vec4u>;

// Indirect dispatch buffers
@group(0) @binding(7) var<storage, read> activeListIn: array<u32>;
@group(0) @binding(8) var<storage, read_write> activeListOut: array<u32>;
@group(0) @binding(9) var<storage, read_write> activeCountOut: atomic<u32>;
// Note: activeCountIn needs read_write for atomicLoad even though we only read it
@group(0) @binding(10) var<storage, read_write> activeCountIn: atomic<u32>;

const INVALID_IDX: u32 = 0xFFFFFFFFu;
const WORKGROUP_SIZE: u32 = 64u;
const SEARCH_RADIUS: u32 = 8u;
const MERGING_THRESHOLD: u32 = 32u;

// Shared memory for PLOC merging
var<workgroup> sharedClusterIdx: array<u32, 64>;
var<workgroup> sharedBoundsMin: array<vec3f, 64>;
var<workgroup> sharedBoundsMax: array<vec3f, 64>;
var<workgroup> sharedNearestNeighbor: array<u32, 64>;

var<workgroup> sharedLeft: array<u32, 64>;
var<workgroup> sharedRight: array<u32, 64>;
var<workgroup> sharedSplit: array<u32, 64>;
var<workgroup> sharedActive: array<u32, 64>;
var<workgroup> sharedNeedsMerge: array<u32, 64>;

var<workgroup> sharedPrefixSum: array<u32, 64>;
var<workgroup> sharedTempIdx: array<u32, 64>;
var<workgroup> sharedTempMin: array<vec3f, 64>;
var<workgroup> sharedTempMax: array<vec3f, 64>;

var<workgroup> sharedMergeList: array<u32, 64>;

var<workgroup> uAnyActive: u32;
var<workgroup> uMergeLeft: u32;
var<workgroup> uMergeRight: u32;
var<workgroup> uMergeSplit: u32;
var<workgroup> uIsFinal: u32;
var<workgroup> uNewNumPrim: u32;
var<workgroup> uNeedsMergeT: u32;
var<workgroup> uActiveCount: u32;
var<workgroup> uLiveCount: u32;
var<workgroup> uActiveListBase: u32;

// Returns common prefix length (higher = more similar, lower = more divergent)
// Uses countLeadingZeros for canonical LBVH parent selection
fn delta(a: u32, b: u32) -> u32 {
	let mcA = mortonCodes[a];
	let mcB = mortonCodes[b];
	let xorVal = mcA ^ mcB;
	if (xorVal == 0u) {
		// Equal morton codes: use index to break ties
		// Add 32 to ensure this is always > any CLZ(xorVal)
		return 32u + countLeadingZeros(a ^ b);
	}
	return countLeadingZeros(xorVal);
}

fn findParentId(left: u32, right: u32, primCount: u32) -> u32 {
	if (left == 0u) {
		return right;
	}
	if (right == primCount - 1u) {
		return left - 1u;
	}

	let deltaRight = delta(right, right + 1u);
	let deltaLeft = delta(left - 1u, left);

	// With CLZ-based delta: higher = longer prefix = less divergent
	// Return right when right boundary is LESS divergent (higher CLZ)
	if (deltaRight > deltaLeft) {
		return right;
	}
	return left - 1u;
}

fn aabbArea(boundsMin: vec3f, boundsMax: vec3f) -> f32 {
	let extent = boundsMax - boundsMin;
	return 2.0 * (extent.x * extent.y + extent.y * extent.z + extent.z * extent.x);
}

@compute @workgroup_size(64)
fn hplocBuildIndirect(
	@builtin(global_invocation_id) globalId: vec3u,
	@builtin(local_invocation_id) localId: vec3u,
	@builtin(workgroup_id) workgroupId: vec3u
) {
	let localIdx = localId.x;
	let threadIdx = globalId.x;  // Index into active list

	// Read active count once per workgroup and broadcast (uniform value)
	if (localIdx == 0u) {
		uActiveCount = atomicLoad(&activeCountIn);
	}
	let activeCount = workgroupUniformLoad(&uActiveCount);

	// OOB guard: check if this thread has valid work
	// threadIdx could be >= activeCount for the last workgroup
	var isOOB = threadIdx >= activeCount;

	// Read primitive index from active list (instead of using globalId directly)
	// This is the key difference from hplocBuild - we only process active primitives
	var primIdx = 0u;
	if (!isOOB) {
		primIdx = activeListIn[threadIdx];
		// Double-check the primIdx is valid
		isOOB = primIdx >= uniforms.primCount;
	}

	// Load persistent state
	var stateVec = vec4u(0u);
	if (!isOOB) {
		stateVec = state[primIdx];
	}
	var left = stateVec.x;
	var right = stateVec.y;
	var split = stateVec.z;
	var isActive = stateVec.w != 0u && !isOOB;

	// Store state in shared memory for workgroup collaboration
	sharedLeft[localIdx] = left;
	sharedRight[localIdx] = right;
	sharedSplit[localIdx] = split;
	sharedActive[localIdx] = select(0u, 1u, isActive);
	sharedNeedsMerge[localIdx] = 0u;

	workgroupBarrier();

	// Check if any thread in workgroup is still active
	if (localIdx == 0u) {
		var anyActive = 0u;
		for (var i = 0u; i < WORKGROUP_SIZE; i = i + 1u) {
			anyActive = anyActive | sharedActive[i];
		}
		uAnyActive = anyActive;
	}
	let anyActive = workgroupUniformLoad(&uAnyActive);

	// Early exit if no active threads
	if (anyActive == 0u) {
		return;
	}

	// ===== MULTI-STEP LBVH OPTIMIZATION =====
	var rangeSize = right - left + 1u;

	while (isActive) {
		let parentId = findParentId(left, right, uniforms.primCount);
		var previousId = INVALID_IDX;

		if (parentId == right) {
			previousId = atomicExchange(&parentIdx[right], left);
			if (previousId != INVALID_IDX) {
				split = right + 1u;
				right = previousId;
			}
		} else {
			previousId = atomicExchange(&parentIdx[left - 1u], right);
			if (previousId != INVALID_IDX) {
				split = left;
				left = previousId;
			}
		}

		if (previousId == INVALID_IDX) {
			isActive = false;
			break;
		}

		rangeSize = right - left + 1u;

		if (rangeSize > MERGING_THRESHOLD || rangeSize == uniforms.primCount) {
			break;
		}
	}

	// Update shared state
	sharedLeft[localIdx] = left;
	sharedRight[localIdx] = right;
	sharedSplit[localIdx] = split;
	sharedActive[localIdx] = select(0u, 1u, isActive);

	// Check if this thread needs merging
	let isFinal = isActive && (rangeSize == uniforms.primCount);
	let needsMerge = isActive && ((rangeSize > MERGING_THRESHOLD) || isFinal);
	sharedNeedsMerge[localIdx] = select(0u, 1u, needsMerge);

	workgroupBarrier();

	// Build compacted merge list
	if (localIdx == 0u) {
		var mergeCount = 0u;
		for (var i = 0u; i < WORKGROUP_SIZE; i = i + 1u) {
			if (sharedNeedsMerge[i] != 0u) {
				sharedMergeList[mergeCount] = i;
				mergeCount = mergeCount + 1u;
			}
		}
		uNewNumPrim = mergeCount;
	}
	let numMerges = workgroupUniformLoad(&uNewNumPrim);

	// Process only threads that need merging (compacted list)
	for (var m = 0u; m < numMerges; m = m + 1u) {
		if (localIdx == 0u) {
			uNeedsMergeT = sharedMergeList[m];
		}
		let t = workgroupUniformLoad(&uNeedsMergeT);

		if (localIdx == 0u) {
			uMergeLeft = sharedLeft[t];
			uMergeRight = sharedRight[t];
			uMergeSplit = sharedSplit[t];
			let tRangeSize = sharedRight[t] - sharedLeft[t] + 1u;
			uIsFinal = select(0u, 1u, tRangeSize == uniforms.primCount);
		}
		let mergeLeft = workgroupUniformLoad(&uMergeLeft);
		let mergeRight = workgroupUniformLoad(&uMergeRight);
		let mergeSplit = workgroupUniformLoad(&uMergeSplit);
		let mergeFinal = workgroupUniformLoad(&uIsFinal) != 0u;

		let totalLeft = mergeSplit - mergeLeft;
		let totalRight = mergeRight - mergeSplit + 1u;
		let halfWorkgroup = WORKGROUP_SIZE / 2u;
		let leftCount = min(totalLeft, halfWorkgroup);
		let rightCount = min(totalRight, halfWorkgroup);
		let originalLoadedCount = leftCount + rightCount;
		var numPrim = originalLoadedCount;

		var loadedIdx = INVALID_IDX;
		if (localIdx < numPrim) {
			var loadIdx: u32;
			if (localIdx < leftCount) {
				loadIdx = mergeLeft + localIdx;
			} else {
				loadIdx = mergeSplit + (localIdx - leftCount);
			}
			loadedIdx = clusterIdx[loadIdx];
		}
		sharedClusterIdx[localIdx] = loadedIdx;
		workgroupBarrier();

		if (localIdx == 0u) {
			var validCount = 0u;
			for (var i = 0u; i < numPrim; i = i + 1u) {
				let idx = sharedClusterIdx[i];
				if (idx != INVALID_IDX) {
					sharedNearestNeighbor[validCount] = idx;
					validCount = validCount + 1u;
				}
			}
			uNewNumPrim = validCount;
		}
		numPrim = workgroupUniformLoad(&uNewNumPrim);

		if (localIdx < numPrim) {
			let cIdx = sharedNearestNeighbor[localIdx];
			sharedClusterIdx[localIdx] = cIdx;

			let node = bvh2Nodes[cIdx];
			sharedBoundsMin[localIdx] = node.boundsMin;
			sharedBoundsMax[localIdx] = node.boundsMax;
		} else if (localIdx < originalLoadedCount) {
			sharedClusterIdx[localIdx] = INVALID_IDX;
		}
		workgroupBarrier();

		let threshold = select(MERGING_THRESHOLD, 1u, mergeFinal);

		// PLOC merging iterations
		for (var mergeIter = 0u; mergeIter < 32u; mergeIter = mergeIter + 1u) {
			if (numPrim <= threshold) {
				break;
			}

			var nearestIdx = INVALID_IDX;
			var nearestCost = 1e30f;

			if (localIdx < numPrim) {
				let myMin = sharedBoundsMin[localIdx];
				let myMax = sharedBoundsMax[localIdx];

				let searchStart = select(0u, localIdx - SEARCH_RADIUS, localIdx >= SEARCH_RADIUS);
				let searchEnd = min(localIdx + SEARCH_RADIUS + 1u, numPrim);

				for (var j = searchStart; j < searchEnd; j = j + 1u) {
					if (j != localIdx) {
						let otherMin = sharedBoundsMin[j];
						let otherMax = sharedBoundsMax[j];
						let mergedMin = min(myMin, otherMin);
						let mergedMax = max(myMax, otherMax);
						let cost = aabbArea(mergedMin, mergedMax);

						if (cost < nearestCost) {
							nearestCost = cost;
							nearestIdx = j;
						}
					}
				}
				sharedNearestNeighbor[localIdx] = nearestIdx;
			}
			workgroupBarrier();

			var shouldMerge = false;
			if (localIdx < numPrim) {
				let myNearest = sharedNearestNeighbor[localIdx];
				if (myNearest != INVALID_IDX && myNearest < numPrim) {
					let theirNearest = sharedNearestNeighbor[myNearest];
					if (theirNearest == localIdx && localIdx < myNearest) {
						shouldMerge = true;
					}
				}
			}
			workgroupBarrier();

			let maxNodes = 2u * uniforms.primCount;
			if (shouldMerge) {
				let myNearest = sharedNearestNeighbor[localIdx];
				let leftCluster = sharedClusterIdx[localIdx];
				let rightCluster = sharedClusterIdx[myNearest];

				let mergedMin = min(sharedBoundsMin[localIdx], sharedBoundsMin[myNearest]);
				let mergedMax = max(sharedBoundsMax[localIdx], sharedBoundsMax[myNearest]);

				let newNodeIdx = atomicAdd(&nodeCounter, 1u);
				if (newNodeIdx < maxNodes) {
					bvh2Nodes[newNodeIdx].boundsMin = mergedMin;
					bvh2Nodes[newNodeIdx].boundsMax = mergedMax;
					bvh2Nodes[newNodeIdx].leftChild = leftCluster;
					bvh2Nodes[newNodeIdx].rightChild = rightCluster;

					sharedClusterIdx[localIdx] = newNodeIdx;
					sharedBoundsMin[localIdx] = mergedMin;
					sharedBoundsMax[localIdx] = mergedMax;
				}
			}
			workgroupBarrier();

			var survives = false;
			if (localIdx < numPrim) {
				survives = true;
				let myNearest = sharedNearestNeighbor[localIdx];
				if (myNearest != INVALID_IDX && myNearest < numPrim) {
					let theirNearest = sharedNearestNeighbor[myNearest];
					if (theirNearest == localIdx && myNearest < localIdx) {
						survives = false;
					}
				}
			}

			sharedPrefixSum[localIdx] = select(0u, 1u, survives);
			workgroupBarrier();

			for (var stride = 1u; stride < WORKGROUP_SIZE; stride = stride * 2u) {
				var addVal = 0u;
				if (localIdx >= stride) {
					addVal = sharedPrefixSum[localIdx - stride];
				}
				workgroupBarrier();
				sharedPrefixSum[localIdx] = sharedPrefixSum[localIdx] + addVal;
				workgroupBarrier();
			}

			if (localIdx == 0u) {
				uNewNumPrim = select(0u, sharedPrefixSum[numPrim - 1u], numPrim > 0u);
			}
			let newNumPrim = workgroupUniformLoad(&uNewNumPrim);

			if (survives && localIdx < numPrim) {
				let writePos = sharedPrefixSum[localIdx] - 1u;
				sharedTempIdx[writePos] = sharedClusterIdx[localIdx];
				sharedTempMin[writePos] = sharedBoundsMin[localIdx];
				sharedTempMax[writePos] = sharedBoundsMax[localIdx];
			}
			workgroupBarrier();

			if (localIdx < newNumPrim) {
				sharedClusterIdx[localIdx] = sharedTempIdx[localIdx];
				sharedBoundsMin[localIdx] = sharedTempMin[localIdx];
				sharedBoundsMax[localIdx] = sharedTempMax[localIdx];
			} else if (localIdx < numPrim) {
				sharedClusterIdx[localIdx] = INVALID_IDX;
			}
			numPrim = newNumPrim;
			workgroupBarrier();
		}

		if (localIdx < originalLoadedCount) {
			clusterIdx[mergeLeft + localIdx] = sharedClusterIdx[localIdx];
		}
		workgroupBarrier();

		sharedNeedsMerge[t] = 0u;

		if (mergeFinal && numPrim <= 1u) {
			sharedActive[t] = 0u;
			if (localIdx == t) {
				isActive = false;
			}
		}
		workgroupBarrier();
	}

	// Save state
	if (!isOOB) {
		state[primIdx] = vec4u(left, right, split, select(0u, 1u, isActive));
	}

	// Workgroup-aggregated output compaction: one global atomicAdd per workgroup.
	let live = isActive && !isOOB;
	sharedPrefixSum[localIdx] = select(0u, 1u, live);
	workgroupBarrier();

	for (var stride = 1u; stride < WORKGROUP_SIZE; stride = stride * 2u) {
		var addVal = 0u;
		if (localIdx >= stride) {
			addVal = sharedPrefixSum[localIdx - stride];
		}
		workgroupBarrier();
		sharedPrefixSum[localIdx] = sharedPrefixSum[localIdx] + addVal;
		workgroupBarrier();
	}

	if (localIdx == 0u) {
		uLiveCount = sharedPrefixSum[WORKGROUP_SIZE - 1u];
		var base = 0u;
		if (uLiveCount > 0u) {
			base = atomicAdd(&activeCountOut, uLiveCount);
		}
		uActiveListBase = base;
	}

	let liveCount = workgroupUniformLoad(&uLiveCount);
	let activeBase = workgroupUniformLoad(&uActiveListBase);
	if (live && liveCount > 0u) {
		let outIdx = activeBase + (sharedPrefixSum[localIdx] - 1u);
		activeListOut[outIdx] = primIdx;
	}
}
`;

/**
 * Tiny shader to update the indirect dispatch arguments.
 * Reads activeCount and writes ceil(count / WORKGROUP_SIZE) to indirectDispatch buffer.
 */
/**
 * Update dispatch shader variants - compute workgroup count and clear output counter.
 * The atomicStore replaces commandEncoder.clearBuffer(), enabling single-pass indirect dispatch.
 */
export const hplocUpdateDispatchShaderWave32 = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> activeCountIn: atomic<u32>;
@group(0) @binding(1) var<storage, read_write> indirectDispatch: array<u32>;
@group(0) @binding(2) var<storage, read_write> activeCountOut: atomic<u32>;

const WORKGROUP_SIZE: u32 = 32u;

@compute @workgroup_size(1)
fn updateIndirectDispatch() {
	let count = atomicLoad(&activeCountIn);
	let workgroups = (count + WORKGROUP_SIZE - 1u) / WORKGROUP_SIZE;
	// Allow 0 workgroups - makes remaining iterations after convergence essentially free
	// WebGPU spec allows dispatchWorkgroupsIndirect with 0 workgroups (no-op)
	indirectDispatch[0] = workgroups;
	indirectDispatch[1] = 1u;
	indirectDispatch[2] = 1u;

	// Clear OUTPUT counter for next iteration - replaces commandEncoder.clearBuffer()
	atomicStore(&activeCountOut, 0u);
}
`;

export const hplocUpdateDispatchShaderWave64 = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> activeCountIn: atomic<u32>;
@group(0) @binding(1) var<storage, read_write> indirectDispatch: array<u32>;
@group(0) @binding(2) var<storage, read_write> activeCountOut: atomic<u32>;

const WORKGROUP_SIZE: u32 = 64u;

@compute @workgroup_size(1)
fn updateIndirectDispatch() {
	let count = atomicLoad(&activeCountIn);
	let workgroups = (count + WORKGROUP_SIZE - 1u) / WORKGROUP_SIZE;
	// Allow 0 workgroups - makes remaining iterations after convergence essentially free
	// WebGPU spec allows dispatchWorkgroupsIndirect with 0 workgroups (no-op)
	indirectDispatch[0] = workgroups;
	indirectDispatch[1] = 1u;
	indirectDispatch[2] = 1u;

	// Clear OUTPUT counter for next iteration - replaces commandEncoder.clearBuffer()
	atomicStore(&activeCountOut, 0u);
}
`;

// Legacy shader for backwards compatibility (old 2-binding layout without output clear)
export const hplocUpdateDispatchShader = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> activeCount: atomic<u32>;
@group(0) @binding(1) var<storage, read_write> indirectDispatch: array<u32>;

const WORKGROUP_SIZE: u32 = 64u;

@compute @workgroup_size(1)
fn updateIndirectDispatch() {
	let count = atomicLoad(&activeCount);
	let workgroups = (count + WORKGROUP_SIZE - 1u) / WORKGROUP_SIZE;
	// Allow 0 workgroups - makes remaining iterations after convergence essentially free
	indirectDispatch[0] = workgroups;
	indirectDispatch[1] = 1u;
	indirectDispatch[2] = 1u;
}
`;

/**
 * Initialize the active list with all primitive indices (0, 1, 2, ..., primCount-1)
 */
export const hplocInitActiveListShader = /* wgsl */ `
struct Uniforms {
	primCount: u32,
	pad0: u32,
	pad1: u32,
	pad2: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read_write> activeList: array<u32>;

@compute @workgroup_size(256)
fn initActiveList(@builtin(global_invocation_id) globalId: vec3u) {
	let idx = globalId.x;
	if (idx < uniforms.primCount) {
		activeList[idx] = idx;
	}
}
`;

/**
 * Initialize all indirect dispatch counters in a single GPU pass.
 * This ensures counters are set at the correct point in command execution,
 * eliminating race conditions with writeBuffer initialization.
 */
export const hplocInitIndirectCountersShader = /* wgsl */ `
struct Uniforms {
	primCount: u32,
	initialWorkgroups: u32,
	pad0: u32,
	pad1: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read_write> nodeCounter: atomic<u32>;
@group(0) @binding(2) var<storage, read_write> activeCount0: atomic<u32>;
@group(0) @binding(3) var<storage, read_write> activeCount1: atomic<u32>;
@group(0) @binding(4) var<storage, read_write> indirectDispatch: array<u32>;

@compute @workgroup_size(1)
fn initIndirectCounters() {
	// Initialize nodeCounter to primCount (leaves are pre-allocated)
	atomicStore(&nodeCounter, uniforms.primCount);

	// Initialize active counts for ping-pong buffers
	atomicStore(&activeCount0, uniforms.primCount);
	atomicStore(&activeCount1, 0u);

	// Initialize indirect dispatch arguments
	// initialWorkgroups is always >= 1 when primCount > 0 (guaranteed by caller)
	indirectDispatch[0] = uniforms.initialWorkgroups;
	indirectDispatch[1] = 1u;
	indirectDispatch[2] = 1u;
}
`;

/**
 * Subgroup-optimized H-PLOC shader - Wave = Subgroup architecture
 *
 * Key optimizations:
 * 1. WG=128 with independent subgroups
 * 2. Ballot+ctz lane selection per subgroup (O(active) selection)
 * 3. Dynamic MERGING_THRESHOLD = subgroupSize/2 per paper
 * 4. Wave-aggregated node allocation
 * 5. Subgroup prefix sums for compaction
 *
 * IMPORTANT FIXES vs the previous (buggy) attempt:
 * - FIX: Do NOT reuse sharedClusterIdx/sharedNearestNeighbor/sharedTempIdx to store per-thread (left/right/split).
 *        Doing so corrupts later merges in the same dispatch.
 * - FIX: Only the selected lane in the owning subgroup gets its local state updated (deactivation).
 * - FIX: Barrier-safe control flow: no per-subgroup early breaks around workgroupBarrier().
 *
 * Note: WGSL currently only has workgroupBarrier(), so subgroup merges are executed in lockstep across the workgroup.
 */
/**
 * H-PLOC Wave32 shader - 1-subgroup-per-workgroup design
 *
 * Optimized for GPUs with subgroup size 32 (Apple M-series, NVIDIA).
 * Key optimizations:
 * 1. @workgroup_size(32) = subgroup size, so entire workgroup is one subgroup
 * 2. workgroupBarrier() is essentially free (no other subgroups to wait)
 * 3. Shared memory sized to exactly 32 elements
 * 4. MERGING_THRESHOLD = 16 (32/2) per paper's constraint
 * 5. No subgroupId partitioning needed
 * 6. Subgroup prefix sums for O(1) compaction
 */
export const hplocShaderWave32 = /* wgsl */ `

enable subgroups;

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupAdd(x: u32) -> u32 { return subgroupAdd(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupExclusiveAdd(x: u32) -> u32 { return subgroupExclusiveAdd(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupBallot(pred: bool) -> vec4<u32> { return subgroupBallot(pred); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupShuffle(x: u32, lane: u32) -> u32 { return subgroupShuffle(x, lane); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupShuffleF(x: f32, lane: u32) -> f32 { return subgroupShuffle(x, lane); }

struct Uniforms {
	primCount: u32,
	bitOffset: u32,
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
@group(0) @binding(1) var<storage, read> mortonCodes: array<u32>;
@group(0) @binding(2) var<storage, read_write> clusterIdx: array<u32>;
@group(0) @binding(3) var<storage, read_write> parentIdx: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> bvh2Nodes: array<BVH2Node>;
@group(0) @binding(5) var<storage, read_write> nodeCounter: atomic<u32>;
@group(0) @binding(6) var<storage, read_write> state: array<vec4u>;

const INVALID_IDX: u32 = 0xFFFFFFFFu;
const WORKGROUP_SIZE: u32 = 32u;
const SEARCH_RADIUS: u32 = 8u;
// MERGING_THRESHOLD = WORKGROUP_SIZE/2 because two combining ranges could each
// have up to MERGING_THRESHOLD clusters, and we can only load WORKGROUP_SIZE total
const MERGING_THRESHOLD: u32 = 16u;
const MAX_MERGE_ITERS: u32 = 32u;
const MAX_ROUNDS: u32 = 32u;

// Shared memory - sized to exactly WORKGROUP_SIZE (32)
var<workgroup> sharedClusterIdx: array<u32, 32>;
var<workgroup> sharedBoundsMin: array<vec3f, 32>;
var<workgroup> sharedBoundsMax: array<vec3f, 32>;
var<workgroup> sharedNearestNeighbor: array<u32, 32>;
var<workgroup> sharedTempIdx: array<u32, 32>;
var<workgroup> sharedTempMin: array<vec3f, 32>;
var<workgroup> sharedTempMax: array<vec3f, 32>;

// Broadcast variables (read via workgroupUniformLoad for uniform control flow)
var<workgroup> uHasMerge: u32;
var<workgroup> uSelLane: u32;
var<workgroup> uMergeLeft: u32;
var<workgroup> uMergeRight: u32;
var<workgroup> uMergeSplit: u32;
var<workgroup> uMergeFinal: u32;
var<workgroup> uNumPrim: u32;
var<workgroup> uValidCount: u32;

// Returns common prefix length (higher = more similar, lower = more divergent)
// Uses countLeadingZeros for canonical LBVH parent selection
fn delta(a: u32, b: u32) -> u32 {
	let mcA = mortonCodes[a];
	let mcB = mortonCodes[b];
	let xorVal = mcA ^ mcB;
	// Equal morton codes: add 32 to ensure this is always > any CLZ(xorVal)
	return select(countLeadingZeros(xorVal), 32u + countLeadingZeros(a ^ b), xorVal == 0u);
}

fn findParentId(left: u32, right: u32, primCount: u32) -> u32 {
	if (left == 0u) { return right; }
	if (right == primCount - 1u) { return left - 1u; }
	let deltaRight = delta(right, right + 1u);
	let deltaLeft = delta(left - 1u, left);
	// With CLZ-based delta: higher = longer prefix = less divergent
	// Return right when right boundary is LESS divergent (higher CLZ)
	return select(left - 1u, right, deltaRight > deltaLeft);
}

fn aabbArea(boundsMin: vec3f, boundsMax: vec3f) -> f32 {
	let extent = boundsMax - boundsMin;
	return 2.0 * (extent.x * extent.y + extent.y * extent.z + extent.z * extent.x);
}

// Count trailing zeros in ballot.x (32 bits)
fn ballotCtz(ballot: vec4<u32>) -> u32 {
	return countTrailingZeros(ballot.x);
}

fn ballotAny(ballot: vec4<u32>) -> bool {
	return ballot.x != 0u;
}

fn ballotCount(ballot: vec4<u32>) -> u32 {
	return countOneBits(ballot.x);
}

@compute @workgroup_size(32)
fn hplocBuild(
	@builtin(global_invocation_id) globalId: vec3u,
	@builtin(local_invocation_id) localId: vec3u,
	@builtin(subgroup_invocation_id) laneId: u32,
	@builtin(subgroup_size) subgroupSize: u32
) {
	let localIdx = localId.x;
	let primIdx = globalId.x;

	// Runtime check: this shader requires subgroup size 32
	if (subgroupSize != 32u) {
		// Save state unchanged and exit
		if (primIdx < uniforms.primCount) {
			// Don't touch state - let fallback shader handle it
		}
		return;
	}

	let isOOB = primIdx >= uniforms.primCount;

	// Load persistent state
	var stateVec = vec4u(0u);
	if (!isOOB) {
		stateVec = state[primIdx];
	}
	var left = stateVec.x;
	var right = stateVec.y;
	var split = stateVec.z;
	var isActive = stateVec.w != 0u && !isOOB;

	// ===== MULTI-STEP LBVH OPTIMIZATION =====
	var rangeSize = right - left + 1u;

	while (isActive) {
		let parentId = findParentId(left, right, uniforms.primCount);
		var previousId = INVALID_IDX;

		if (parentId == right) {
			previousId = atomicExchange(&parentIdx[right], left);
			if (previousId != INVALID_IDX) {
				split = right + 1u;
				right = previousId;
			}
		} else {
			previousId = atomicExchange(&parentIdx[left - 1u], right);
			if (previousId != INVALID_IDX) {
				split = left;
				left = previousId;
			}
		}

		if (previousId == INVALID_IDX) {
			isActive = false;
			break;
		}

		rangeSize = right - left + 1u;

		if (rangeSize > MERGING_THRESHOLD || rangeSize == uniforms.primCount) {
			break;
		}
	}

	// Determine if this thread needs a PLOC merge
	let isFinal = isActive && (rangeSize == uniforms.primCount);
	var needsMerge = isActive && ((rangeSize > MERGING_THRESHOLD) || isFinal);

	// ===== BALLOT+CTZ MERGE SELECTION =====
	// In 1-subgroup-per-workgroup, no cross-subgroup coordination needed
	// Use workgroupUniformLoad to satisfy WGSL uniform control flow requirements
	for (var round = 0u; round < MAX_ROUNDS; round = round + 1u) {
		let ballot = unsafeSubgroupBallot(needsMerge);

		// Broadcast hasMerge via workgroup variable for uniform control flow
		if (laneId == 0u) {
			uHasMerge = select(0u, 1u, ballotAny(ballot));
		}
		let hasMerge = workgroupUniformLoad(&uHasMerge) != 0u;

		if (!hasMerge) {
			break; // Uniform across entire workgroup
		}

		// Select first lane needing merge and broadcast via workgroup variables
		if (laneId == 0u) {
			let selLane = ballotCtz(ballot);
			uSelLane = selLane;
		}
		let selLane = workgroupUniformLoad(&uSelLane);

		// Broadcast merge parameters
		if (laneId == selLane) {
			uMergeLeft = left;
			uMergeRight = right;
			uMergeSplit = split;
			uMergeFinal = select(0u, 1u, (right - left + 1u) == uniforms.primCount);
		}
		let mergeLeft = workgroupUniformLoad(&uMergeLeft);
		let mergeRight = workgroupUniformLoad(&uMergeRight);
		let mergeSplit = workgroupUniformLoad(&uMergeSplit);
		let mergeFinal = workgroupUniformLoad(&uMergeFinal) != 0u;

		// Compute how many clusters to load from each side
		let totalLeft = mergeSplit - mergeLeft;
		let totalRight = mergeRight - mergeSplit + 1u;
		let halfWave = MERGING_THRESHOLD; // 16
		let leftCount = min(totalLeft, halfWave);
		let rightCount = min(totalRight, halfWave);
		let originalLoadedCount = leftCount + rightCount;
		var numPrim = originalLoadedCount;

		let threshold = select(MERGING_THRESHOLD, 1u, mergeFinal);

		// ===== Load cluster indices =====
		var loadedIdx = INVALID_IDX;
		if (laneId < numPrim) {
			var loadIdx: u32;
			if (laneId < leftCount) {
				loadIdx = mergeLeft + laneId;
			} else {
				loadIdx = mergeSplit + (laneId - leftCount);
			}
			loadedIdx = clusterIdx[loadIdx];
		}
		sharedClusterIdx[laneId] = loadedIdx;
		workgroupBarrier();

		// ===== Compact valid clusters (skip INVALID) =====
		let isValid = laneId < numPrim && loadedIdx != INVALID_IDX;
		let validBallot = unsafeSubgroupBallot(isValid);

		// Broadcast valid count for uniform control flow
		if (laneId == 0u) {
			uValidCount = ballotCount(validBallot);
		}
		let validCount = workgroupUniformLoad(&uValidCount);
		let validPrefix = unsafeSubgroupExclusiveAdd(select(0u, 1u, isValid));

		if (isValid) {
			sharedTempIdx[validPrefix] = loadedIdx;
		}
		workgroupBarrier();

		numPrim = validCount;

		// Load bounds for compacted cluster list
		var myClusterIdx = INVALID_IDX;
		var myBoundsMin = vec3f(0.0);
		var myBoundsMax = vec3f(0.0);

		if (laneId < numPrim) {
			myClusterIdx = sharedTempIdx[laneId];
			let node = bvh2Nodes[myClusterIdx];
			myBoundsMin = node.boundsMin;
			myBoundsMax = node.boundsMax;
		}

		sharedClusterIdx[laneId] = myClusterIdx;
		sharedBoundsMin[laneId] = myBoundsMin;
		sharedBoundsMax[laneId] = myBoundsMax;
		workgroupBarrier();

		// ===== PLOC merge loop =====
		for (var mergeIter = 0u; mergeIter < MAX_MERGE_ITERS; mergeIter = mergeIter + 1u) {
			// Broadcast numPrim for uniform control flow
			if (laneId == 0u) {
				uNumPrim = numPrim;
			}
			let uniformNumPrim = workgroupUniformLoad(&uNumPrim);
			if (uniformNumPrim <= threshold) {
				break; // Uniform - entire workgroup breaks together
			}

			// Find nearest neighbor (right-only + propagate to left)
			var nearestIdx = INVALID_IDX;
			var nearestCost = 1e30f;

			let laneActive = laneId < uniformNumPrim;
			var myMin = vec3f(0.0);
			var myMax = vec3f(0.0);
			if (laneActive) {
				myMin = sharedBoundsMin[laneId];
				myMax = sharedBoundsMax[laneId];
			}

			for (var r = 1u; r <= SEARCH_RADIUS; r = r + 1u) {
				var costRight = 1e30f;
				if (laneActive) {
					let j = laneId + r;
					if (j < uniformNumPrim) {
						let otherMin = sharedBoundsMin[j];
						let otherMax = sharedBoundsMax[j];
						let mergedMin = min(myMin, otherMin);
						let mergedMax = max(myMax, otherMax);
						costRight = aabbArea(mergedMin, mergedMax);

						if (costRight < nearestCost) {
							nearestCost = costRight;
							nearestIdx = j;
						}
					}
				}

				var leftLane = 0u;
				if (laneId >= r) {
					leftLane = laneId - r;
				}
				let incomingCost = unsafeSubgroupShuffleF(costRight, leftLane);

				if (laneActive && laneId >= r && incomingCost < nearestCost) {
					nearestCost = incomingCost;
					nearestIdx = leftLane;
				}
			}
			sharedNearestNeighbor[laneId] = nearestIdx;
			workgroupBarrier();

			// Determine mutual nearest neighbor pairs (lower index merges)
			var shouldMerge = false;
			if (laneId < numPrim && nearestIdx != INVALID_IDX && nearestIdx < numPrim) {
				let theirNearest = sharedNearestNeighbor[nearestIdx];
				if (theirNearest == laneId && laneId < nearestIdx) {
					shouldMerge = true;
				}
			}

			// Wave-aggregated node allocation
			let mergeCount = unsafeSubgroupAdd(select(0u, 1u, shouldMerge));
			let mergePrefix = unsafeSubgroupExclusiveAdd(select(0u, 1u, shouldMerge));

			var allocBase = 0u;
			if (laneId == 0u && mergeCount > 0u) {
				allocBase = atomicAdd(&nodeCounter, mergeCount);
			}
			allocBase = unsafeSubgroupShuffle(allocBase, 0u);

			// Perform merges
			let maxNodes = 2u * uniforms.primCount;
			if (shouldMerge) {
				let leftCluster = sharedClusterIdx[laneId];
				let rightCluster = sharedClusterIdx[nearestIdx];

				let mergedMin = min(sharedBoundsMin[laneId], sharedBoundsMin[nearestIdx]);
				let mergedMax = max(sharedBoundsMax[laneId], sharedBoundsMax[nearestIdx]);

				let newNodeIdx = allocBase + mergePrefix;
				if (newNodeIdx < maxNodes) {
					bvh2Nodes[newNodeIdx].boundsMin = mergedMin;
					bvh2Nodes[newNodeIdx].boundsMax = mergedMax;
					bvh2Nodes[newNodeIdx].leftChild = leftCluster;
					bvh2Nodes[newNodeIdx].rightChild = rightCluster;

					sharedClusterIdx[laneId] = newNodeIdx;
					sharedBoundsMin[laneId] = mergedMin;
					sharedBoundsMax[laneId] = mergedMax;
				}
			}
			workgroupBarrier();

			// Compaction: determine who survives
			var survives = false;
			if (laneId < uniformNumPrim) {
				survives = true;
				let myNearest = sharedNearestNeighbor[laneId];
				if (myNearest != INVALID_IDX && myNearest < uniformNumPrim) {
					let theirNearest = sharedNearestNeighbor[myNearest];
					if (theirNearest == laneId && myNearest < laneId) {
						survives = false;
					}
				}
			}

			let localSurviveCount = unsafeSubgroupAdd(select(0u, 1u, survives));
			let survivePrefix = unsafeSubgroupExclusiveAdd(select(0u, 1u, survives));

			if (survives) {
				sharedTempIdx[survivePrefix] = sharedClusterIdx[laneId];
				sharedTempMin[survivePrefix] = sharedBoundsMin[laneId];
				sharedTempMax[survivePrefix] = sharedBoundsMax[laneId];
			}

			// Broadcast survive count for uniform control flow
			if (laneId == 0u) {
				uNumPrim = localSurviveCount;
			}
			let surviveCount = workgroupUniformLoad(&uNumPrim);

			if (laneId < surviveCount) {
				sharedClusterIdx[laneId] = sharedTempIdx[laneId];
				sharedBoundsMin[laneId] = sharedTempMin[laneId];
				sharedBoundsMax[laneId] = sharedTempMax[laneId];
			}
			workgroupBarrier();

			numPrim = surviveCount;
		}

		// Broadcast final numPrim for uniform control flow
		if (laneId == 0u) {
			uNumPrim = numPrim;
		}
		let finalNumPrim = workgroupUniformLoad(&uNumPrim);

		// ===== Write results back to global clusterIdx =====
		if (laneId < originalLoadedCount) {
			let outIdx = select(INVALID_IDX, sharedClusterIdx[laneId], laneId < finalNumPrim);
			clusterIdx[mergeLeft + laneId] = outIdx;
		}

		// Only the selected lane clears its needsMerge and updates isActive
		if (laneId == selLane) {
			needsMerge = false;
			if (mergeFinal && finalNumPrim <= 1u) {
				isActive = false;
			}
		}

		workgroupBarrier();
	}

	// Save state
	if (!isOOB) {
		state[primIdx] = vec4u(left, right, split, select(0u, 1u, isActive));
	}
}
`;

/**
 * H-PLOC Wave32 Indirect shader - single-pass indirect dispatch version
 *
 * Same as wave32 but with active list input/output for reduced workgroup launches.
 * Key additions:
 * - Reads primIdx from activeListIn instead of globalId.x
 * - Writes still-active primitives to activeListOut
 * - Enables single compute pass with atomicStore output clear in updateDispatch
 */
export const hplocShaderWave32Indirect = /* wgsl */ `

enable subgroups;

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupAdd(x: u32) -> u32 { return subgroupAdd(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupExclusiveAdd(x: u32) -> u32 { return subgroupExclusiveAdd(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupBallot(pred: bool) -> vec4<u32> { return subgroupBallot(pred); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupShuffle(x: u32, lane: u32) -> u32 { return subgroupShuffle(x, lane); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupShuffleF(x: f32, lane: u32) -> f32 { return subgroupShuffle(x, lane); }

struct Uniforms {
	primCount: u32,
	bitOffset: u32,
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
@group(0) @binding(1) var<storage, read> mortonCodes: array<u32>;
@group(0) @binding(2) var<storage, read_write> clusterIdx: array<u32>;
@group(0) @binding(3) var<storage, read_write> parentIdx: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> bvh2Nodes: array<BVH2Node>;
@group(0) @binding(5) var<storage, read_write> nodeCounter: atomic<u32>;
@group(0) @binding(6) var<storage, read_write> state: array<vec4u>;
// Indirect dispatch active list bindings
@group(0) @binding(7) var<storage, read> activeListIn: array<u32>;
@group(0) @binding(8) var<storage, read_write> activeListOut: array<u32>;
@group(0) @binding(9) var<storage, read_write> activeCountOut: atomic<u32>;
@group(0) @binding(10) var<storage, read_write> activeCountIn: atomic<u32>;

const INVALID_IDX: u32 = 0xFFFFFFFFu;
const WORKGROUP_SIZE: u32 = 32u;
const SEARCH_RADIUS: u32 = 8u;
const MERGING_THRESHOLD: u32 = 16u;
const MAX_MERGE_ITERS: u32 = 32u;
const MAX_ROUNDS: u32 = 32u;

var<workgroup> sharedClusterIdx: array<u32, 32>;
var<workgroup> sharedBoundsMin: array<vec3f, 32>;
var<workgroup> sharedBoundsMax: array<vec3f, 32>;
var<workgroup> sharedNearestNeighbor: array<u32, 32>;
var<workgroup> sharedTempIdx: array<u32, 32>;
var<workgroup> sharedTempMin: array<vec3f, 32>;
var<workgroup> sharedTempMax: array<vec3f, 32>;

var<workgroup> uHasMerge: u32;
var<workgroup> uSelLane: u32;
var<workgroup> uMergeLeft: u32;
var<workgroup> uMergeRight: u32;
var<workgroup> uMergeSplit: u32;
var<workgroup> uMergeFinal: u32;
var<workgroup> uNumPrim: u32;
var<workgroup> uValidCount: u32;
var<workgroup> uActiveCount: u32;

// Returns common prefix length (higher = more similar, lower = more divergent)
fn delta(a: u32, b: u32) -> u32 {
	let mcA = mortonCodes[a];
	let mcB = mortonCodes[b];
	let xorVal = mcA ^ mcB;
	return select(countLeadingZeros(xorVal), 32u + countLeadingZeros(a ^ b), xorVal == 0u);
}

fn findParentId(left: u32, right: u32, primCount: u32) -> u32 {
	if (left == 0u) { return right; }
	if (right == primCount - 1u) { return left - 1u; }
	let deltaRight = delta(right, right + 1u);
	let deltaLeft = delta(left - 1u, left);
	return select(left - 1u, right, deltaRight > deltaLeft);
}

fn aabbArea(boundsMin: vec3f, boundsMax: vec3f) -> f32 {
	let extent = boundsMax - boundsMin;
	return 2.0 * (extent.x * extent.y + extent.y * extent.z + extent.z * extent.x);
}

fn ballotCtz(ballot: vec4<u32>) -> u32 { return countTrailingZeros(ballot.x); }
fn ballotAny(ballot: vec4<u32>) -> bool { return ballot.x != 0u; }
fn ballotCount(ballot: vec4<u32>) -> u32 { return countOneBits(ballot.x); }

@compute @workgroup_size(32)
fn hplocBuildIndirect(
	@builtin(global_invocation_id) globalId: vec3u,
	@builtin(local_invocation_id) localId: vec3u,
	@builtin(subgroup_invocation_id) laneId: u32,
	@builtin(subgroup_size) subgroupSize: u32
) {
	let localIdx = localId.x;
	let threadIdx = globalId.x;

	// Note: Runtime subgroup check removed - shader is only used when subgroup size is confirmed to be 32
	// during pipeline selection. The check was causing intermittent failures.

	// Read active count once per workgroup and broadcast (uniform value)
	if (laneId == 0u) {
		uActiveCount = atomicLoad(&activeCountIn);
	}
	let activeCount = workgroupUniformLoad(&uActiveCount);
	var isOOB = threadIdx >= activeCount;

	// Read primitive index from active list (key difference from direct dispatch)
	var primIdx = 0u;
	if (!isOOB) {
		primIdx = activeListIn[threadIdx];
		isOOB = primIdx >= uniforms.primCount;
	}

	// Load persistent state
	var stateVec = vec4u(0u);
	if (!isOOB) { stateVec = state[primIdx]; }
	var left = stateVec.x;
	var right = stateVec.y;
	var split = stateVec.z;
	var isActive = stateVec.w != 0u && !isOOB;

	// ===== MULTI-STEP LBVH OPTIMIZATION =====
	var rangeSize = right - left + 1u;

	while (isActive) {
		let parentId = findParentId(left, right, uniforms.primCount);
		var previousId = INVALID_IDX;

		if (parentId == right) {
			previousId = atomicExchange(&parentIdx[right], left);
			if (previousId != INVALID_IDX) { split = right + 1u; right = previousId; }
		} else {
			previousId = atomicExchange(&parentIdx[left - 1u], right);
			if (previousId != INVALID_IDX) { split = left; left = previousId; }
		}

		if (previousId == INVALID_IDX) { isActive = false; break; }
		rangeSize = right - left + 1u;
		if (rangeSize > MERGING_THRESHOLD || rangeSize == uniforms.primCount) { break; }
	}

	let isFinal = isActive && (rangeSize == uniforms.primCount);
	var needsMerge = isActive && ((rangeSize > MERGING_THRESHOLD) || isFinal);

	// ===== BALLOT+CTZ MERGE SELECTION =====
	for (var round = 0u; round < MAX_ROUNDS; round = round + 1u) {
		let ballot = unsafeSubgroupBallot(needsMerge);

		if (laneId == 0u) { uHasMerge = select(0u, 1u, ballotAny(ballot)); }
		let hasMerge = workgroupUniformLoad(&uHasMerge) != 0u;
		if (!hasMerge) { break; }

		if (laneId == 0u) { uSelLane = ballotCtz(ballot); }
		let selLane = workgroupUniformLoad(&uSelLane);

		if (laneId == selLane) {
			uMergeLeft = left;
			uMergeRight = right;
			uMergeSplit = split;
			uMergeFinal = select(0u, 1u, (right - left + 1u) == uniforms.primCount);
		}
		let mergeLeft = workgroupUniformLoad(&uMergeLeft);
		let mergeRight = workgroupUniformLoad(&uMergeRight);
		let mergeSplit = workgroupUniformLoad(&uMergeSplit);
		let mergeFinal = workgroupUniformLoad(&uMergeFinal) != 0u;

		let totalLeft = mergeSplit - mergeLeft;
		let totalRight = mergeRight - mergeSplit + 1u;
		let halfWave = MERGING_THRESHOLD;
		let leftCount = min(totalLeft, halfWave);
		let rightCount = min(totalRight, halfWave);
		let originalLoadedCount = leftCount + rightCount;
		var numPrim = originalLoadedCount;
		let threshold = select(MERGING_THRESHOLD, 1u, mergeFinal);

		// Load cluster indices
		var loadedIdx = INVALID_IDX;
		if (laneId < numPrim) {
			var loadIdx: u32;
			if (laneId < leftCount) { loadIdx = mergeLeft + laneId; }
			else { loadIdx = mergeSplit + (laneId - leftCount); }
			loadedIdx = clusterIdx[loadIdx];
		}
		sharedClusterIdx[laneId] = loadedIdx;
		workgroupBarrier();

		// Compact valid clusters
		let isValid = laneId < numPrim && loadedIdx != INVALID_IDX;
		let validBallot = unsafeSubgroupBallot(isValid);
		if (laneId == 0u) { uValidCount = ballotCount(validBallot); }
		let validCount = workgroupUniformLoad(&uValidCount);
		let validPrefix = unsafeSubgroupExclusiveAdd(select(0u, 1u, isValid));

		if (isValid) { sharedTempIdx[validPrefix] = loadedIdx; }
		workgroupBarrier();
		numPrim = validCount;

		// Load bounds
		var myClusterIdx = INVALID_IDX;
		var myBoundsMin = vec3f(0.0);
		var myBoundsMax = vec3f(0.0);
		if (laneId < numPrim) {
			myClusterIdx = sharedTempIdx[laneId];
			let node = bvh2Nodes[myClusterIdx];
			myBoundsMin = node.boundsMin;
			myBoundsMax = node.boundsMax;
		}
		sharedClusterIdx[laneId] = myClusterIdx;
		sharedBoundsMin[laneId] = myBoundsMin;
		sharedBoundsMax[laneId] = myBoundsMax;
		workgroupBarrier();

		// ===== PLOC merge loop =====
		for (var mergeIter = 0u; mergeIter < MAX_MERGE_ITERS; mergeIter = mergeIter + 1u) {
			if (laneId == 0u) { uNumPrim = numPrim; }
			let uniformNumPrim = workgroupUniformLoad(&uNumPrim);
			if (uniformNumPrim <= threshold) { break; }

			// Find nearest neighbor
			var nearestIdx = INVALID_IDX;
			var nearestCost = 1e30f;
			let laneActive = laneId < uniformNumPrim;
			var myMin = vec3f(0.0);
			var myMax = vec3f(0.0);
			if (laneActive) { myMin = sharedBoundsMin[laneId]; myMax = sharedBoundsMax[laneId]; }

			for (var r = 1u; r <= SEARCH_RADIUS; r = r + 1u) {
				var costRight = 1e30f;
				if (laneActive) {
					let j = laneId + r;
					if (j < uniformNumPrim) {
						let mergedMin = min(myMin, sharedBoundsMin[j]);
						let mergedMax = max(myMax, sharedBoundsMax[j]);
						costRight = aabbArea(mergedMin, mergedMax);
						if (costRight < nearestCost) { nearestCost = costRight; nearestIdx = j; }
					}
				}
				var leftLane = 0u;
				if (laneId >= r) { leftLane = laneId - r; }
				let incomingCost = unsafeSubgroupShuffleF(costRight, leftLane);
				if (laneActive && laneId >= r && incomingCost < nearestCost) {
					nearestCost = incomingCost;
					nearestIdx = leftLane;
				}
			}
			sharedNearestNeighbor[laneId] = nearestIdx;
			workgroupBarrier();

			// Mutual nearest neighbor check
			var shouldMerge = false;
			if (laneId < numPrim && nearestIdx != INVALID_IDX && nearestIdx < numPrim) {
				let theirNearest = sharedNearestNeighbor[nearestIdx];
				if (theirNearest == laneId && laneId < nearestIdx) { shouldMerge = true; }
			}

			// Wave-aggregated node allocation
			let mergeCount = unsafeSubgroupAdd(select(0u, 1u, shouldMerge));
			let mergePrefix = unsafeSubgroupExclusiveAdd(select(0u, 1u, shouldMerge));
			var allocBase = 0u;
			if (laneId == 0u && mergeCount > 0u) { allocBase = atomicAdd(&nodeCounter, mergeCount); }
			allocBase = unsafeSubgroupShuffle(allocBase, 0u);

			// Perform merges
			let maxNodes = 2u * uniforms.primCount;
			if (shouldMerge) {
				let leftCluster = sharedClusterIdx[laneId];
				let rightCluster = sharedClusterIdx[nearestIdx];
				let mergedMin = min(sharedBoundsMin[laneId], sharedBoundsMin[nearestIdx]);
				let mergedMax = max(sharedBoundsMax[laneId], sharedBoundsMax[nearestIdx]);
				let newNodeIdx = allocBase + mergePrefix;
				if (newNodeIdx < maxNodes) {
					bvh2Nodes[newNodeIdx].boundsMin = mergedMin;
					bvh2Nodes[newNodeIdx].boundsMax = mergedMax;
					bvh2Nodes[newNodeIdx].leftChild = leftCluster;
					bvh2Nodes[newNodeIdx].rightChild = rightCluster;
					sharedClusterIdx[laneId] = newNodeIdx;
					sharedBoundsMin[laneId] = mergedMin;
					sharedBoundsMax[laneId] = mergedMax;
				}
			}
			workgroupBarrier();

			// Compaction
			var survives = false;
			if (laneId < uniformNumPrim) {
				survives = true;
				let myNearest = sharedNearestNeighbor[laneId];
				if (myNearest != INVALID_IDX && myNearest < uniformNumPrim) {
					let theirNearest = sharedNearestNeighbor[myNearest];
					if (theirNearest == laneId && myNearest < laneId) { survives = false; }
				}
			}
			// Compute subgroup sum BEFORE any conditional - subgroup ops must run on all lanes
			let localSurviveCount = unsafeSubgroupAdd(select(0u, 1u, survives));
			let survivePrefix = unsafeSubgroupExclusiveAdd(select(0u, 1u, survives));
			if (survives) {
				sharedTempIdx[survivePrefix] = sharedClusterIdx[laneId];
				sharedTempMin[survivePrefix] = sharedBoundsMin[laneId];
				sharedTempMax[survivePrefix] = sharedBoundsMax[laneId];
			}
			if (laneId == 0u) { uNumPrim = localSurviveCount; }
			let surviveCount = workgroupUniformLoad(&uNumPrim);
			if (laneId < surviveCount) {
				sharedClusterIdx[laneId] = sharedTempIdx[laneId];
				sharedBoundsMin[laneId] = sharedTempMin[laneId];
				sharedBoundsMax[laneId] = sharedTempMax[laneId];
			}
			workgroupBarrier();
			numPrim = surviveCount;
		}

		if (laneId == 0u) { uNumPrim = numPrim; }
		let finalNumPrim = workgroupUniformLoad(&uNumPrim);

		// Write results back
		if (laneId < originalLoadedCount) {
			let outIdx = select(INVALID_IDX, sharedClusterIdx[laneId], laneId < finalNumPrim);
			clusterIdx[mergeLeft + laneId] = outIdx;
		}

		if (laneId == selLane) {
			needsMerge = false;
			if (mergeFinal && finalNumPrim <= 1u) { isActive = false; }
		}
		workgroupBarrier();
	}

	// Save state
	if (!isOOB) {
		state[primIdx] = vec4u(left, right, split, select(0u, 1u, isActive));
	}

	// Subgroup-aggregated append: one global atomicAdd per workgroup (wave32 path).
	let live = isActive && !isOOB;
	let liveU = select(0u, 1u, live);
	let liveCount = unsafeSubgroupAdd(liveU);
	let livePrefix = unsafeSubgroupExclusiveAdd(liveU);

	var activeBase = 0u;
	if (laneId == 0u && liveCount > 0u) {
		activeBase = atomicAdd(&activeCountOut, liveCount);
	}
	activeBase = unsafeSubgroupShuffle(activeBase, 0u);

	if (live) {
		activeListOut[activeBase + livePrefix] = primIdx;
	}
}
`;

/**
 * H-PLOC Wave64 shader - 1-subgroup-per-workgroup design
 *
 * Optimized for GPUs with subgroup size 64 (AMD).
 * Key optimizations:
 * 1. @workgroup_size(64) = subgroup size, so entire workgroup is one subgroup
 * 2. workgroupBarrier() is essentially free (no other subgroups to wait)
 * 3. Shared memory sized to exactly 64 elements
 * 4. MERGING_THRESHOLD = 32 (64/2) per paper's constraint
 * 5. No subgroupId partitioning needed
 * 6. Uses vec4 ballot masks for 64-bit lane support
 */
export const hplocShaderWave64 = /* wgsl */ `

enable subgroups;

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupAdd(x: u32) -> u32 { return subgroupAdd(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupExclusiveAdd(x: u32) -> u32 { return subgroupExclusiveAdd(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupBallot(pred: bool) -> vec4<u32> { return subgroupBallot(pred); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupShuffle(x: u32, lane: u32) -> u32 { return subgroupShuffle(x, lane); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupShuffleF(x: f32, lane: u32) -> f32 { return subgroupShuffle(x, lane); }

struct Uniforms {
	primCount: u32,
	bitOffset: u32,
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
@group(0) @binding(1) var<storage, read> mortonCodes: array<u32>;
@group(0) @binding(2) var<storage, read_write> clusterIdx: array<u32>;
@group(0) @binding(3) var<storage, read_write> parentIdx: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> bvh2Nodes: array<BVH2Node>;
@group(0) @binding(5) var<storage, read_write> nodeCounter: atomic<u32>;
@group(0) @binding(6) var<storage, read_write> state: array<vec4u>;

const INVALID_IDX: u32 = 0xFFFFFFFFu;
const WORKGROUP_SIZE: u32 = 64u;
const SEARCH_RADIUS: u32 = 8u;
// MERGING_THRESHOLD = WORKGROUP_SIZE/2 because two combining ranges could each
// have up to MERGING_THRESHOLD clusters, and we can only load WORKGROUP_SIZE total
const MERGING_THRESHOLD: u32 = 32u;
const MAX_MERGE_ITERS: u32 = 32u;
const MAX_ROUNDS: u32 = 64u;

// Shared memory - sized to exactly WORKGROUP_SIZE (64)
var<workgroup> sharedClusterIdx: array<u32, 64>;
var<workgroup> sharedBoundsMin: array<vec3f, 64>;
var<workgroup> sharedBoundsMax: array<vec3f, 64>;
var<workgroup> sharedNearestNeighbor: array<u32, 64>;
var<workgroup> sharedTempIdx: array<u32, 64>;
var<workgroup> sharedTempMin: array<vec3f, 64>;
var<workgroup> sharedTempMax: array<vec3f, 64>;

// Broadcast variables (read via workgroupUniformLoad for uniform control flow)
var<workgroup> uHasMerge: u32;
var<workgroup> uSelLane: u32;
var<workgroup> uMergeLeft: u32;
var<workgroup> uMergeRight: u32;
var<workgroup> uMergeSplit: u32;
var<workgroup> uMergeFinal: u32;
var<workgroup> uNumPrim: u32;
var<workgroup> uValidCount: u32;

// Returns common prefix length (higher = more similar, lower = more divergent)
// Uses countLeadingZeros for canonical LBVH parent selection
fn delta(a: u32, b: u32) -> u32 {
	let mcA = mortonCodes[a];
	let mcB = mortonCodes[b];
	let xorVal = mcA ^ mcB;
	// Equal morton codes: add 32 to ensure this is always > any CLZ(xorVal)
	return select(countLeadingZeros(xorVal), 32u + countLeadingZeros(a ^ b), xorVal == 0u);
}

fn findParentId(left: u32, right: u32, primCount: u32) -> u32 {
	if (left == 0u) { return right; }
	if (right == primCount - 1u) { return left - 1u; }
	let deltaRight = delta(right, right + 1u);
	let deltaLeft = delta(left - 1u, left);
	// With CLZ-based delta: higher = longer prefix = less divergent
	// Return right when right boundary is LESS divergent (higher CLZ)
	return select(left - 1u, right, deltaRight > deltaLeft);
}

fn aabbArea(boundsMin: vec3f, boundsMax: vec3f) -> f32 {
	let extent = boundsMax - boundsMin;
	return 2.0 * (extent.x * extent.y + extent.y * extent.z + extent.z * extent.x);
}

// 64-bit ballot helpers (uses .x and .y components)
fn ballotCtz64(ballot: vec4<u32>) -> u32 {
	if (ballot.x != 0u) { return countTrailingZeros(ballot.x); }
	return 32u + countTrailingZeros(ballot.y);
}

fn ballotAny64(ballot: vec4<u32>) -> bool {
	return (ballot.x | ballot.y) != 0u;
}

fn ballotCount64(ballot: vec4<u32>) -> u32 {
	return countOneBits(ballot.x) + countOneBits(ballot.y);
}

@compute @workgroup_size(64)
fn hplocBuild(
	@builtin(global_invocation_id) globalId: vec3u,
	@builtin(local_invocation_id) localId: vec3u,
	@builtin(subgroup_invocation_id) laneId: u32,
	@builtin(subgroup_size) subgroupSize: u32
) {
	let localIdx = localId.x;
	let primIdx = globalId.x;

	// Runtime check: this shader requires subgroup size 64
	if (subgroupSize != 64u) {
		// Don't touch state - let fallback shader handle it
		return;
	}

	let isOOB = primIdx >= uniforms.primCount;

	// Load persistent state
	var stateVec = vec4u(0u);
	if (!isOOB) {
		stateVec = state[primIdx];
	}
	var left = stateVec.x;
	var right = stateVec.y;
	var split = stateVec.z;
	var isActive = stateVec.w != 0u && !isOOB;

	// ===== MULTI-STEP LBVH OPTIMIZATION =====
	var rangeSize = right - left + 1u;

	while (isActive) {
		let parentId = findParentId(left, right, uniforms.primCount);
		var previousId = INVALID_IDX;

		if (parentId == right) {
			previousId = atomicExchange(&parentIdx[right], left);
			if (previousId != INVALID_IDX) {
				split = right + 1u;
				right = previousId;
			}
		} else {
			previousId = atomicExchange(&parentIdx[left - 1u], right);
			if (previousId != INVALID_IDX) {
				split = left;
				left = previousId;
			}
		}

		if (previousId == INVALID_IDX) {
			isActive = false;
			break;
		}

		rangeSize = right - left + 1u;

		if (rangeSize > MERGING_THRESHOLD || rangeSize == uniforms.primCount) {
			break;
		}
	}

	// Determine if this thread needs a PLOC merge
	let isFinal = isActive && (rangeSize == uniforms.primCount);
	var needsMerge = isActive && ((rangeSize > MERGING_THRESHOLD) || isFinal);

	// ===== BALLOT+CTZ MERGE SELECTION =====
	// Use workgroupUniformLoad to satisfy WGSL uniform control flow requirements
	for (var round = 0u; round < MAX_ROUNDS; round = round + 1u) {
		let ballot = unsafeSubgroupBallot(needsMerge);

		// Broadcast hasMerge via workgroup variable for uniform control flow
		if (laneId == 0u) {
			uHasMerge = select(0u, 1u, ballotAny64(ballot));
		}
		let hasMerge = workgroupUniformLoad(&uHasMerge) != 0u;

		if (!hasMerge) {
			break; // Uniform across entire workgroup
		}

		// Select first lane needing merge and broadcast via workgroup variables
		if (laneId == 0u) {
			let selLane = ballotCtz64(ballot);
			uSelLane = selLane;
		}
		let selLane = workgroupUniformLoad(&uSelLane);

		// Broadcast merge parameters
		if (laneId == selLane) {
			uMergeLeft = left;
			uMergeRight = right;
			uMergeSplit = split;
			uMergeFinal = select(0u, 1u, (right - left + 1u) == uniforms.primCount);
		}
		let mergeLeft = workgroupUniformLoad(&uMergeLeft);
		let mergeRight = workgroupUniformLoad(&uMergeRight);
		let mergeSplit = workgroupUniformLoad(&uMergeSplit);
		let mergeFinal = workgroupUniformLoad(&uMergeFinal) != 0u;

		// Compute how many clusters to load from each side
		let totalLeft = mergeSplit - mergeLeft;
		let totalRight = mergeRight - mergeSplit + 1u;
		let halfWave = MERGING_THRESHOLD; // 32
		let leftCount = min(totalLeft, halfWave);
		let rightCount = min(totalRight, halfWave);
		let originalLoadedCount = leftCount + rightCount;
		var numPrim = originalLoadedCount;

		let threshold = select(MERGING_THRESHOLD, 1u, mergeFinal);

		// ===== Load cluster indices =====
		var loadedIdx = INVALID_IDX;
		if (laneId < numPrim) {
			var loadIdx: u32;
			if (laneId < leftCount) {
				loadIdx = mergeLeft + laneId;
			} else {
				loadIdx = mergeSplit + (laneId - leftCount);
			}
			loadedIdx = clusterIdx[loadIdx];
		}
		sharedClusterIdx[laneId] = loadedIdx;
		workgroupBarrier();

		// ===== Compact valid clusters (skip INVALID) =====
		let isValid = laneId < numPrim && loadedIdx != INVALID_IDX;
		let validBallot = unsafeSubgroupBallot(isValid);

		// Broadcast valid count for uniform control flow
		if (laneId == 0u) {
			uValidCount = ballotCount64(validBallot);
		}
		let validCount = workgroupUniformLoad(&uValidCount);
		let validPrefix = unsafeSubgroupExclusiveAdd(select(0u, 1u, isValid));

		if (isValid) {
			sharedTempIdx[validPrefix] = loadedIdx;
		}
		workgroupBarrier();

		numPrim = validCount;

		// Load bounds for compacted cluster list
		var myClusterIdx = INVALID_IDX;
		var myBoundsMin = vec3f(0.0);
		var myBoundsMax = vec3f(0.0);

		if (laneId < numPrim) {
			myClusterIdx = sharedTempIdx[laneId];
			let node = bvh2Nodes[myClusterIdx];
			myBoundsMin = node.boundsMin;
			myBoundsMax = node.boundsMax;
		}

		sharedClusterIdx[laneId] = myClusterIdx;
		sharedBoundsMin[laneId] = myBoundsMin;
		sharedBoundsMax[laneId] = myBoundsMax;
		workgroupBarrier();

		// ===== PLOC merge loop =====
		for (var mergeIter = 0u; mergeIter < MAX_MERGE_ITERS; mergeIter = mergeIter + 1u) {
			// Broadcast numPrim for uniform control flow
			if (laneId == 0u) {
				uNumPrim = numPrim;
			}
			let uniformNumPrim = workgroupUniformLoad(&uNumPrim);
			if (uniformNumPrim <= threshold) {
				break; // Uniform - entire workgroup breaks together
			}

			// Find nearest neighbor (right-only + propagate to left)
			var nearestIdx = INVALID_IDX;
			var nearestCost = 1e30f;

			let laneActive = laneId < uniformNumPrim;
			var myMin = vec3f(0.0);
			var myMax = vec3f(0.0);
			if (laneActive) {
				myMin = sharedBoundsMin[laneId];
				myMax = sharedBoundsMax[laneId];
			}

			for (var r = 1u; r <= SEARCH_RADIUS; r = r + 1u) {
				var costRight = 1e30f;
				if (laneActive) {
					let j = laneId + r;
					if (j < uniformNumPrim) {
						let otherMin = sharedBoundsMin[j];
						let otherMax = sharedBoundsMax[j];
						let mergedMin = min(myMin, otherMin);
						let mergedMax = max(myMax, otherMax);
						costRight = aabbArea(mergedMin, mergedMax);

						if (costRight < nearestCost) {
							nearestCost = costRight;
							nearestIdx = j;
						}
					}
				}

				var leftLane = 0u;
				if (laneId >= r) {
					leftLane = laneId - r;
				}
				let incomingCost = unsafeSubgroupShuffleF(costRight, leftLane);

				if (laneActive && laneId >= r && incomingCost < nearestCost) {
					nearestCost = incomingCost;
					nearestIdx = leftLane;
				}
			}
			sharedNearestNeighbor[laneId] = nearestIdx;
			workgroupBarrier();

			// Determine mutual nearest neighbor pairs (lower index merges)
			var shouldMerge = false;
			if (laneId < uniformNumPrim && nearestIdx != INVALID_IDX && nearestIdx < uniformNumPrim) {
				let theirNearest = sharedNearestNeighbor[nearestIdx];
				if (theirNearest == laneId && laneId < nearestIdx) {
					shouldMerge = true;
				}
			}

			// Wave-aggregated node allocation
			let mergeCount = unsafeSubgroupAdd(select(0u, 1u, shouldMerge));
			let mergePrefix = unsafeSubgroupExclusiveAdd(select(0u, 1u, shouldMerge));

			var allocBase = 0u;
			if (laneId == 0u && mergeCount > 0u) {
				allocBase = atomicAdd(&nodeCounter, mergeCount);
			}
			allocBase = unsafeSubgroupShuffle(allocBase, 0u);

			// Perform merges
			let maxNodes = 2u * uniforms.primCount;
			if (shouldMerge) {
				let leftCluster = sharedClusterIdx[laneId];
				let rightCluster = sharedClusterIdx[nearestIdx];

				let mergedMin = min(sharedBoundsMin[laneId], sharedBoundsMin[nearestIdx]);
				let mergedMax = max(sharedBoundsMax[laneId], sharedBoundsMax[nearestIdx]);

				let newNodeIdx = allocBase + mergePrefix;
				if (newNodeIdx < maxNodes) {
					bvh2Nodes[newNodeIdx].boundsMin = mergedMin;
					bvh2Nodes[newNodeIdx].boundsMax = mergedMax;
					bvh2Nodes[newNodeIdx].leftChild = leftCluster;
					bvh2Nodes[newNodeIdx].rightChild = rightCluster;

					sharedClusterIdx[laneId] = newNodeIdx;
					sharedBoundsMin[laneId] = mergedMin;
					sharedBoundsMax[laneId] = mergedMax;
				}
			}
			workgroupBarrier();

			// Compaction: determine who survives
			var survives = false;
			if (laneId < uniformNumPrim) {
				survives = true;
				let myNearest = sharedNearestNeighbor[laneId];
				if (myNearest != INVALID_IDX && myNearest < uniformNumPrim) {
					let theirNearest = sharedNearestNeighbor[myNearest];
					if (theirNearest == laneId && myNearest < laneId) {
						survives = false;
					}
				}
			}

			let localSurviveCount = unsafeSubgroupAdd(select(0u, 1u, survives));
			let survivePrefix = unsafeSubgroupExclusiveAdd(select(0u, 1u, survives));

			if (survives) {
				sharedTempIdx[survivePrefix] = sharedClusterIdx[laneId];
				sharedTempMin[survivePrefix] = sharedBoundsMin[laneId];
				sharedTempMax[survivePrefix] = sharedBoundsMax[laneId];
			}

			// Broadcast survive count for uniform control flow
			if (laneId == 0u) {
				uNumPrim = localSurviveCount;
			}
			let surviveCount = workgroupUniformLoad(&uNumPrim);

			if (laneId < surviveCount) {
				sharedClusterIdx[laneId] = sharedTempIdx[laneId];
				sharedBoundsMin[laneId] = sharedTempMin[laneId];
				sharedBoundsMax[laneId] = sharedTempMax[laneId];
			}
			workgroupBarrier();

			numPrim = surviveCount;
		}

		// Broadcast final numPrim for uniform control flow
		if (laneId == 0u) {
			uNumPrim = numPrim;
		}
		let finalNumPrim = workgroupUniformLoad(&uNumPrim);

		// ===== Write results back to global clusterIdx =====
		if (laneId < originalLoadedCount) {
			let outIdx = select(INVALID_IDX, sharedClusterIdx[laneId], laneId < finalNumPrim);
			clusterIdx[mergeLeft + laneId] = outIdx;
		}

		// Only the selected lane clears its needsMerge and updates isActive
		if (laneId == selLane) {
			needsMerge = false;
			if (mergeFinal && finalNumPrim <= 1u) {
				isActive = false;
			}
		}

		workgroupBarrier();
	}

	// Save state
	if (!isOOB) {
		state[primIdx] = vec4u(left, right, split, select(0u, 1u, isActive));
	}
}
`;

/**
 * H-PLOC Wave64 Indirect shader - single-pass indirect dispatch version
 *
 * Same as wave64 but with active list input/output for reduced workgroup launches.
 */
export const hplocShaderWave64Indirect = /* wgsl */ `

enable subgroups;

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupAdd(x: u32) -> u32 { return subgroupAdd(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupExclusiveAdd(x: u32) -> u32 { return subgroupExclusiveAdd(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupBallot(pred: bool) -> vec4<u32> { return subgroupBallot(pred); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupShuffle(x: u32, lane: u32) -> u32 { return subgroupShuffle(x, lane); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupShuffleF(x: f32, lane: u32) -> f32 { return subgroupShuffle(x, lane); }

struct Uniforms {
	primCount: u32,
	bitOffset: u32,
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
@group(0) @binding(1) var<storage, read> mortonCodes: array<u32>;
@group(0) @binding(2) var<storage, read_write> clusterIdx: array<u32>;
@group(0) @binding(3) var<storage, read_write> parentIdx: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> bvh2Nodes: array<BVH2Node>;
@group(0) @binding(5) var<storage, read_write> nodeCounter: atomic<u32>;
@group(0) @binding(6) var<storage, read_write> state: array<vec4u>;
// Indirect dispatch active list bindings
@group(0) @binding(7) var<storage, read> activeListIn: array<u32>;
@group(0) @binding(8) var<storage, read_write> activeListOut: array<u32>;
@group(0) @binding(9) var<storage, read_write> activeCountOut: atomic<u32>;
@group(0) @binding(10) var<storage, read_write> activeCountIn: atomic<u32>;

const INVALID_IDX: u32 = 0xFFFFFFFFu;
const WORKGROUP_SIZE: u32 = 64u;
const SEARCH_RADIUS: u32 = 8u;
const MERGING_THRESHOLD: u32 = 32u;
const MAX_MERGE_ITERS: u32 = 32u;
const MAX_ROUNDS: u32 = 64u;  // Must match wave64 direct (was 32, caused slow convergence)

var<workgroup> sharedClusterIdx: array<u32, 64>;
var<workgroup> sharedBoundsMin: array<vec3f, 64>;
var<workgroup> sharedBoundsMax: array<vec3f, 64>;
var<workgroup> sharedNearestNeighbor: array<u32, 64>;
var<workgroup> sharedTempIdx: array<u32, 64>;
var<workgroup> sharedTempMin: array<vec3f, 64>;
var<workgroup> sharedTempMax: array<vec3f, 64>;

var<workgroup> uHasMerge: u32;
var<workgroup> uSelLane: u32;
var<workgroup> uMergeLeft: u32;
var<workgroup> uMergeRight: u32;
var<workgroup> uMergeSplit: u32;
var<workgroup> uMergeFinal: u32;
var<workgroup> uNumPrim: u32;
var<workgroup> uValidCount: u32;
var<workgroup> uActiveCount: u32;

fn delta(a: u32, b: u32) -> u32 {
	let mcA = mortonCodes[a];
	let mcB = mortonCodes[b];
	let xorVal = mcA ^ mcB;
	return select(countLeadingZeros(xorVal), 32u + countLeadingZeros(a ^ b), xorVal == 0u);
}

fn findParentId(left: u32, right: u32, primCount: u32) -> u32 {
	if (left == 0u) { return right; }
	if (right == primCount - 1u) { return left - 1u; }
	let deltaRight = delta(right, right + 1u);
	let deltaLeft = delta(left - 1u, left);
	return select(left - 1u, right, deltaRight > deltaLeft);
}

fn aabbArea(boundsMin: vec3f, boundsMax: vec3f) -> f32 {
	let extent = boundsMax - boundsMin;
	return 2.0 * (extent.x * extent.y + extent.y * extent.z + extent.z * extent.x);
}

// 64-bit ballot helpers
fn ballot64Ctz(ballot: vec4<u32>) -> u32 {
	if (ballot.x != 0u) { return countTrailingZeros(ballot.x); }
	return 32u + countTrailingZeros(ballot.y);
}
fn ballot64Any(ballot: vec4<u32>) -> bool { return (ballot.x | ballot.y) != 0u; }
fn ballot64Count(ballot: vec4<u32>) -> u32 { return countOneBits(ballot.x) + countOneBits(ballot.y); }

@compute @workgroup_size(64)
fn hplocBuildIndirect(
	@builtin(global_invocation_id) globalId: vec3u,
	@builtin(local_invocation_id) localId: vec3u,
	@builtin(subgroup_invocation_id) laneId: u32,
	@builtin(subgroup_size) subgroupSize: u32
) {
	let localIdx = localId.x;
	let threadIdx = globalId.x;

	if (subgroupSize != 64u) { return; }

	// Read active count once per workgroup and broadcast (uniform value)
	if (laneId == 0u) {
		uActiveCount = atomicLoad(&activeCountIn);
	}
	let activeCount = workgroupUniformLoad(&uActiveCount);
	var isOOB = threadIdx >= activeCount;

	var primIdx = 0u;
	if (!isOOB) {
		primIdx = activeListIn[threadIdx];
		isOOB = primIdx >= uniforms.primCount;
	}

	var stateVec = vec4u(0u);
	if (!isOOB) { stateVec = state[primIdx]; }
	var left = stateVec.x;
	var right = stateVec.y;
	var split = stateVec.z;
	var isActive = stateVec.w != 0u && !isOOB;

	var rangeSize = right - left + 1u;

	while (isActive) {
		let parentId = findParentId(left, right, uniforms.primCount);
		var previousId = INVALID_IDX;

		if (parentId == right) {
			previousId = atomicExchange(&parentIdx[right], left);
			if (previousId != INVALID_IDX) { split = right + 1u; right = previousId; }
		} else {
			previousId = atomicExchange(&parentIdx[left - 1u], right);
			if (previousId != INVALID_IDX) { split = left; left = previousId; }
		}

		if (previousId == INVALID_IDX) { isActive = false; break; }
		rangeSize = right - left + 1u;
		if (rangeSize > MERGING_THRESHOLD || rangeSize == uniforms.primCount) { break; }
	}

	let isFinal = isActive && (rangeSize == uniforms.primCount);
	var needsMerge = isActive && ((rangeSize > MERGING_THRESHOLD) || isFinal);

	for (var round = 0u; round < MAX_ROUNDS; round = round + 1u) {
		let ballot = unsafeSubgroupBallot(needsMerge);

		if (laneId == 0u) { uHasMerge = select(0u, 1u, ballot64Any(ballot)); }
		let hasMerge = workgroupUniformLoad(&uHasMerge) != 0u;
		if (!hasMerge) { break; }

		if (laneId == 0u) { uSelLane = ballot64Ctz(ballot); }
		let selLane = workgroupUniformLoad(&uSelLane);

		if (laneId == selLane) {
			uMergeLeft = left;
			uMergeRight = right;
			uMergeSplit = split;
			uMergeFinal = select(0u, 1u, (right - left + 1u) == uniforms.primCount);
		}
		let mergeLeft = workgroupUniformLoad(&uMergeLeft);
		let mergeRight = workgroupUniformLoad(&uMergeRight);
		let mergeSplit = workgroupUniformLoad(&uMergeSplit);
		let mergeFinal = workgroupUniformLoad(&uMergeFinal) != 0u;

		let totalLeft = mergeSplit - mergeLeft;
		let totalRight = mergeRight - mergeSplit + 1u;
		let halfWave = MERGING_THRESHOLD;
		let leftCount = min(totalLeft, halfWave);
		let rightCount = min(totalRight, halfWave);
		let originalLoadedCount = leftCount + rightCount;
		var numPrim = originalLoadedCount;
		let threshold = select(MERGING_THRESHOLD, 1u, mergeFinal);

		var loadedIdx = INVALID_IDX;
		if (laneId < numPrim) {
			var loadIdx: u32;
			if (laneId < leftCount) { loadIdx = mergeLeft + laneId; }
			else { loadIdx = mergeSplit + (laneId - leftCount); }
			loadedIdx = clusterIdx[loadIdx];
		}
		sharedClusterIdx[laneId] = loadedIdx;
		workgroupBarrier();

		let isValid = laneId < numPrim && loadedIdx != INVALID_IDX;
		let validBallot = unsafeSubgroupBallot(isValid);
		if (laneId == 0u) { uValidCount = ballot64Count(validBallot); }
		let validCount = workgroupUniformLoad(&uValidCount);
		let validPrefix = unsafeSubgroupExclusiveAdd(select(0u, 1u, isValid));

		if (isValid) { sharedTempIdx[validPrefix] = loadedIdx; }
		workgroupBarrier();
		numPrim = validCount;

		var myClusterIdx = INVALID_IDX;
		var myBoundsMin = vec3f(0.0);
		var myBoundsMax = vec3f(0.0);
		if (laneId < numPrim) {
			myClusterIdx = sharedTempIdx[laneId];
			let node = bvh2Nodes[myClusterIdx];
			myBoundsMin = node.boundsMin;
			myBoundsMax = node.boundsMax;
		}
		sharedClusterIdx[laneId] = myClusterIdx;
		sharedBoundsMin[laneId] = myBoundsMin;
		sharedBoundsMax[laneId] = myBoundsMax;
		workgroupBarrier();

		for (var mergeIter = 0u; mergeIter < MAX_MERGE_ITERS; mergeIter = mergeIter + 1u) {
			if (laneId == 0u) { uNumPrim = numPrim; }
			let uniformNumPrim = workgroupUniformLoad(&uNumPrim);
			if (uniformNumPrim <= threshold) { break; }

			var nearestIdx = INVALID_IDX;
			var nearestCost = 1e30f;
			let laneActive = laneId < uniformNumPrim;
			var myMin = vec3f(0.0);
			var myMax = vec3f(0.0);
			if (laneActive) { myMin = sharedBoundsMin[laneId]; myMax = sharedBoundsMax[laneId]; }

			for (var r = 1u; r <= SEARCH_RADIUS; r = r + 1u) {
				var costRight = 1e30f;
				if (laneActive) {
					let j = laneId + r;
					if (j < uniformNumPrim) {
						let mergedMin = min(myMin, sharedBoundsMin[j]);
						let mergedMax = max(myMax, sharedBoundsMax[j]);
						costRight = aabbArea(mergedMin, mergedMax);
						if (costRight < nearestCost) { nearestCost = costRight; nearestIdx = j; }
					}
				}
				var leftLane = 0u;
				if (laneId >= r) { leftLane = laneId - r; }
				let incomingCost = unsafeSubgroupShuffleF(costRight, leftLane);
				if (laneActive && laneId >= r && incomingCost < nearestCost) {
					nearestCost = incomingCost;
					nearestIdx = leftLane;
				}
			}
			sharedNearestNeighbor[laneId] = nearestIdx;
			workgroupBarrier();

			var shouldMerge = false;
			if (laneId < numPrim && nearestIdx != INVALID_IDX && nearestIdx < numPrim) {
				let theirNearest = sharedNearestNeighbor[nearestIdx];
				if (theirNearest == laneId && laneId < nearestIdx) { shouldMerge = true; }
			}

			let mergeCount = unsafeSubgroupAdd(select(0u, 1u, shouldMerge));
			let mergePrefix = unsafeSubgroupExclusiveAdd(select(0u, 1u, shouldMerge));
			var allocBase = 0u;
			if (laneId == 0u && mergeCount > 0u) { allocBase = atomicAdd(&nodeCounter, mergeCount); }
			allocBase = unsafeSubgroupShuffle(allocBase, 0u);

			let maxNodes = 2u * uniforms.primCount;
			if (shouldMerge) {
				let leftCluster = sharedClusterIdx[laneId];
				let rightCluster = sharedClusterIdx[nearestIdx];
				let mergedMin = min(sharedBoundsMin[laneId], sharedBoundsMin[nearestIdx]);
				let mergedMax = max(sharedBoundsMax[laneId], sharedBoundsMax[nearestIdx]);
				let newNodeIdx = allocBase + mergePrefix;
				if (newNodeIdx < maxNodes) {
					bvh2Nodes[newNodeIdx].boundsMin = mergedMin;
					bvh2Nodes[newNodeIdx].boundsMax = mergedMax;
					bvh2Nodes[newNodeIdx].leftChild = leftCluster;
					bvh2Nodes[newNodeIdx].rightChild = rightCluster;
					sharedClusterIdx[laneId] = newNodeIdx;
					sharedBoundsMin[laneId] = mergedMin;
					sharedBoundsMax[laneId] = mergedMax;
				}
			}
			workgroupBarrier();

			var survives = false;
			if (laneId < uniformNumPrim) {
				survives = true;
				let myNearest = sharedNearestNeighbor[laneId];
				if (myNearest != INVALID_IDX && myNearest < uniformNumPrim) {
					let theirNearest = sharedNearestNeighbor[myNearest];
					if (theirNearest == laneId && myNearest < laneId) { survives = false; }
				}
			}
			// Compute subgroup sum BEFORE any conditional - subgroup ops must run on all lanes
			let localSurviveCount = unsafeSubgroupAdd(select(0u, 1u, survives));
			let survivePrefix = unsafeSubgroupExclusiveAdd(select(0u, 1u, survives));
			if (survives) {
				sharedTempIdx[survivePrefix] = sharedClusterIdx[laneId];
				sharedTempMin[survivePrefix] = sharedBoundsMin[laneId];
				sharedTempMax[survivePrefix] = sharedBoundsMax[laneId];
			}
			if (laneId == 0u) { uNumPrim = localSurviveCount; }
			let surviveCount = workgroupUniformLoad(&uNumPrim);
			if (laneId < surviveCount) {
				sharedClusterIdx[laneId] = sharedTempIdx[laneId];
				sharedBoundsMin[laneId] = sharedTempMin[laneId];
				sharedBoundsMax[laneId] = sharedTempMax[laneId];
			}
			workgroupBarrier();
			numPrim = surviveCount;
		}

		if (laneId == 0u) { uNumPrim = numPrim; }
		let finalNumPrim = workgroupUniformLoad(&uNumPrim);

		if (laneId < originalLoadedCount) {
			let outIdx = select(INVALID_IDX, sharedClusterIdx[laneId], laneId < finalNumPrim);
			clusterIdx[mergeLeft + laneId] = outIdx;
		}

		if (laneId == selLane) {
			needsMerge = false;
			if (mergeFinal && finalNumPrim <= 1u) { isActive = false; }
		}
		workgroupBarrier();
	}

	if (!isOOB) {
		state[primIdx] = vec4u(left, right, split, select(0u, 1u, isActive));
	}

	// Subgroup-aggregated append: one global atomicAdd per workgroup (wave64 path).
	let live = isActive && !isOOB;
	let liveU = select(0u, 1u, live);
	let liveCount = unsafeSubgroupAdd(liveU);
	let livePrefix = unsafeSubgroupExclusiveAdd(liveU);

	var activeBase = 0u;
	if (laneId == 0u && liveCount > 0u) {
		activeBase = atomicAdd(&activeCountOut, liveCount);
	}
	activeBase = unsafeSubgroupShuffle(activeBase, 0u);

	if (live) {
		activeListOut[activeBase + livePrefix] = primIdx;
	}
}
`;

export const hplocShaderSubgroup = /* wgsl */ `

enable subgroups;

// Subgroup helper functions
@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupOr(x: u32) -> u32 { return subgroupOr(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupAdd(x: u32) -> u32 { return subgroupAdd(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupExclusiveAdd(x: u32) -> u32 { return subgroupExclusiveAdd(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupBallot(pred: bool) -> vec4<u32> { return subgroupBallot(pred); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupShuffle(x: u32, lane: u32) -> u32 { return subgroupShuffle(x, lane); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupShuffleF(x: f32, lane: u32) -> f32 { return subgroupShuffle(x, lane); }

struct Uniforms {
	primCount: u32,
	bitOffset: u32,
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
@group(0) @binding(1) var<storage, read> mortonCodes: array<u32>;
@group(0) @binding(2) var<storage, read_write> clusterIdx: array<u32>;
@group(0) @binding(3) var<storage, read_write> parentIdx: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> bvh2Nodes: array<BVH2Node>;
@group(0) @binding(5) var<storage, read_write> nodeCounter: atomic<u32>;
@group(0) @binding(6) var<storage, read_write> state: array<vec4u>;

const INVALID_IDX: u32 = 0xFFFFFFFFu;
const WORKGROUP_SIZE: u32 = 128u;
const SEARCH_RADIUS: u32 = 8u;
const MAX_MERGE_ITERS: u32 = 32u;
// Upper bound on "one merge per lane" selection rounds.
// Theoretical max is subgroupSize (each round processes one merge per subgroup).
// 64 covers all practical subgroup sizes (NVIDIA=32, AMD=64, Apple=32).
const MAX_ROUNDS: u32 = 64u;

// Shared memory partitioned by subgroup (segment [waveBase .. waveBase+subgroupSize))
var<workgroup> sharedClusterIdx: array<u32, 128>;
var<workgroup> sharedBoundsMin: array<vec3f, 128>;
var<workgroup> sharedBoundsMax: array<vec3f, 128>;
var<workgroup> sharedNearestNeighbor: array<u32, 128>;

var<workgroup> sharedTempIdx: array<u32, 128>;
var<workgroup> sharedTempMin: array<vec3f, 128>;
var<workgroup> sharedTempMax: array<vec3f, 128>;

// One entry per possible subgroupId (worst case: subgroupSize=1 => subgroupId in [0..127])
var<workgroup> sharedSubgroupHasMerge: array<u32, 128>;
var<workgroup> uAnyMerge: u32;

// Returns common prefix length (higher = more similar, lower = more divergent)
// Uses countLeadingZeros for canonical LBVH parent selection
fn delta(a: u32, b: u32) -> u32 {
	let mcA = mortonCodes[a];
	let mcB = mortonCodes[b];
	let xorVal = mcA ^ mcB;
	// Equal morton codes: add 32 to ensure this is always > any CLZ(xorVal)
	return select(countLeadingZeros(xorVal), 32u + countLeadingZeros(a ^ b), xorVal == 0u);
}

fn findParentId(left: u32, right: u32, primCount: u32) -> u32 {
	if (left == 0u) { return right; }
	if (right == primCount - 1u) { return left - 1u; }
	let deltaRight = delta(right, right + 1u);
	let deltaLeft = delta(left - 1u, left);
	// With CLZ-based delta: higher = longer prefix = less divergent
	// Return right when right boundary is LESS divergent (higher CLZ)
	return select(left - 1u, right, deltaRight > deltaLeft);
}

fn aabbArea(boundsMin: vec3f, boundsMax: vec3f) -> f32 {
	let extent = boundsMax - boundsMin;
	return 2.0 * (extent.x * extent.y + extent.y * extent.z + extent.z * extent.x);
}

// Count trailing zeros in ballot (find first active lane)
fn ballotCtz(ballot: vec4<u32>) -> u32 {
	if (ballot.x != 0u) { return countTrailingZeros(ballot.x); }
	if (ballot.y != 0u) { return 32u + countTrailingZeros(ballot.y); }
	if (ballot.z != 0u) { return 64u + countTrailingZeros(ballot.z); }
	if (ballot.w != 0u) { return 96u + countTrailingZeros(ballot.w); }
	return 128u; // No bits set
}

// Check if ballot has any bits set
fn ballotAny(ballot: vec4<u32>) -> bool {
	return (ballot.x | ballot.y | ballot.z | ballot.w) != 0u;
}

// Count bits in ballot (all 4 components for subgroupSize up to 128)
fn ballotCount(ballot: vec4<u32>) -> u32 {
	return countOneBits(ballot.x) + countOneBits(ballot.y) + countOneBits(ballot.z) + countOneBits(ballot.w);
}

@compute @workgroup_size(128)
fn hplocBuild(
	@builtin(global_invocation_id) globalId: vec3u,
	@builtin(local_invocation_id) localId: vec3u,
	@builtin(subgroup_invocation_id) laneId: u32,
	@builtin(subgroup_size) subgroupSize: u32
) {
	let localIdx = localId.x;
	let primIdx = globalId.x;

	// OOB guard: threads beyond primCount are inactive and don't access state
	// IMPORTANT: Don't use select() for OOB guard - WGSL may evaluate both arguments
	let isOOB = primIdx >= uniforms.primCount;

	// Load persistent state
	var stateVec = vec4u(0u);
	if (!isOOB) {
		stateVec = state[primIdx];
	}
	var left = stateVec.x;
	var right = stateVec.y;
	var split = stateVec.z;
	var isActive = stateVec.w != 0u && !isOOB;

	// Subgroup partition indices
	// NOTE: This assumes local_invocation_id.x is assigned contiguously to lanes (same assumption as OneSweep).
	let subgroupId = localIdx / subgroupSize;
	let waveBase = subgroupId * subgroupSize;

	// FIX: Guard against unsupported subgroup layouts that would index shared arrays out of bounds.
	// This is uniform across the workgroup because subgroupSize is uniform.
	if ((WORKGROUP_SIZE % subgroupSize) != 0u || subgroupSize == 0u || subgroupSize > WORKGROUP_SIZE) {
		if (!isOOB) {
			// Save state unchanged (still valid), but skip subgroup-merge path.
			state[primIdx] = vec4u(left, right, split, select(0u, 1u, isActive));
		}
		return;
	}

	// Dynamic threshold based on subgroup size
	// Must be <= subgroupSize/2 because two combining ranges could each have
	// up to mergeThreshold clusters, and we can only load subgroupSize total.
	// Clamp to at least 1 to avoid threshold=0 on tiny subgroup sizes.
	let mergeThreshold = max(1u, subgroupSize / 2u);

	// ===== MULTI-STEP LBVH OPTIMIZATION =====
	var rangeSize = right - left + 1u;

	while (isActive) {
		let parentId = findParentId(left, right, uniforms.primCount);
		var previousId = INVALID_IDX;

		if (parentId == right) {
			previousId = atomicExchange(&parentIdx[right], left);
			if (previousId != INVALID_IDX) {
				split = right + 1u;
				right = previousId;
			}
		} else {
			previousId = atomicExchange(&parentIdx[left - 1u], right);
			if (previousId != INVALID_IDX) {
				split = left;
				left = previousId;
			}
		}

		if (previousId == INVALID_IDX) {
			isActive = false;
			break;
		}

		rangeSize = right - left + 1u;

		if (rangeSize > mergeThreshold || rangeSize == uniforms.primCount) {
			break;
		}
	}

	// Determine if this thread needs a PLOC merge
	let isFinal = isActive && (rangeSize == uniforms.primCount);
	var needsMerge = isActive && ((rangeSize > mergeThreshold) || isFinal);

	// ===== PER-SUBGROUP BALLOT+CTZ MERGE SELECTION =====
	// Each subgroup repeatedly selects one lane needing merge, performs the merge, then clears that lane's flag.
	// We synchronize at workgroup scope because WGSL only provides workgroupBarrier().

	let numSubgroups = WORKGROUP_SIZE / subgroupSize;

	for (var round = 0u; round < MAX_ROUNDS; round = round + 1u) {
		// Subgroup ballot of "needsMerge"
		let ballot = unsafeSubgroupBallot(needsMerge);
		let hasMerge = ballotAny(ballot); // uniform within subgroup

		// Publish per-subgroup activity (one lane per subgroup)
		if (laneId == 0u) {
			sharedSubgroupHasMerge[subgroupId] = select(0u, 1u, hasMerge);
		}
		workgroupBarrier();

		// Workgroup-wide OR to decide if any subgroup still has work (uniform break)
		if (localIdx == 0u) {
			var any = 0u;
			for (var s = 0u; s < numSubgroups; s = s + 1u) {
				any = any | sharedSubgroupHasMerge[s];
			}
			uAnyMerge = any;
		}
		let anyMergeAll = workgroupUniformLoad(&uAnyMerge);

		if (anyMergeAll == 0u) {
			break; // Uniform across the workgroup (safe with barriers)
		}

		// If this subgroup has no pending merge, it still must participate in the barrier pattern below.
		let doMerge = hasMerge;

		// Selected lane (valid only if doMerge==true)
		var selLane: u32 = 0u;
		var mergeLeft: u32 = 0u;
		var mergeRight: u32 = 0u;
		var mergeSplit: u32 = 0u;
		var mergeFinal: bool = false;

		// FIX: Only compute/broadcast merge parameters when doMerge is true.
		// Otherwise mergeSplit-mergeLeft could underflow and cause out-of-bounds loads.
		if (doMerge) {
			selLane = ballotCtz(ballot); // < subgroupSize because hasMerge==true
			mergeLeft = unsafeSubgroupShuffle(left, selLane);
			mergeRight = unsafeSubgroupShuffle(right, selLane);
			mergeSplit = unsafeSubgroupShuffle(split, selLane);
			mergeFinal = (mergeRight - mergeLeft + 1u) == uniforms.primCount;
		}

		// Compute how many clusters to load from each side
		var leftCount: u32 = 0u;
		var rightCount: u32 = 0u;
		var originalLoadedCount: u32 = 0u;
		var numPrim: u32 = 0u;
		var threshold: u32 = mergeThreshold;

		if (doMerge) {
			let totalLeft = mergeSplit - mergeLeft;
			let totalRight = mergeRight - mergeSplit + 1u;
			let halfWave = mergeThreshold; // subgroupSize/2
			leftCount = min(totalLeft, halfWave);
			rightCount = min(totalRight, halfWave);
			originalLoadedCount = leftCount + rightCount;
			numPrim = originalLoadedCount;

			// Merge down to 1 only for the final/root range
			threshold = select(mergeThreshold, 1u, mergeFinal);
		}

		// ===== Load cluster indices into subgroup-local shared segment =====
		var loadedIdx = INVALID_IDX;
		if (laneId < numPrim) {
			var loadIdx: u32;
			if (laneId < leftCount) {
				loadIdx = mergeLeft + laneId;
			} else {
				loadIdx = mergeSplit + (laneId - leftCount);
			}
			loadedIdx = clusterIdx[loadIdx];
		}
		sharedClusterIdx[waveBase + laneId] = loadedIdx;
		workgroupBarrier();

		// ===== Compact valid clusters (skip INVALID) =====
		let isValid = laneId < numPrim && loadedIdx != INVALID_IDX;
		let validBallot = unsafeSubgroupBallot(isValid);
		let validCount = ballotCount(validBallot);
		let validPrefix = unsafeSubgroupExclusiveAdd(select(0u, 1u, isValid));

		if (isValid) {
			sharedTempIdx[waveBase + validPrefix] = loadedIdx;
		}
		workgroupBarrier();

		// Updated numPrim after compaction
		numPrim = validCount;

		// Load bounds for compacted cluster list
		var myClusterIdx = INVALID_IDX;
		var myBoundsMin = vec3f(0.0);
		var myBoundsMax = vec3f(0.0);

		if (laneId < numPrim) {
			myClusterIdx = sharedTempIdx[waveBase + laneId];
			let node = bvh2Nodes[myClusterIdx];
			myBoundsMin = node.boundsMin;
			myBoundsMax = node.boundsMax;
		}

		sharedClusterIdx[waveBase + laneId] = myClusterIdx;
		sharedBoundsMin[waveBase + laneId] = myBoundsMin;
		sharedBoundsMax[waveBase + laneId] = myBoundsMax;
		workgroupBarrier();

		// ===== PLOC merge loop with workgroup-uniform early exit =====
		// PLOC typically converges in 3-5 iterations. Without early exit, we'd run
		// MAX_MERGE_ITERS=32 iterations with 4 barriers each = 128 barriers.
		// Early exit saves ~100+ barriers when merging converges quickly.
		for (var mergeIter = 0u; mergeIter < MAX_MERGE_ITERS; mergeIter = mergeIter + 1u) {
			let doIter = doMerge && (numPrim > threshold);

			// Early exit check: if no subgroup needs more iterations, break uniformly
			if (laneId == 0u) {
				sharedSubgroupHasMerge[subgroupId] = select(0u, 1u, doIter);
			}
			workgroupBarrier();
			if (localIdx == 0u) {
				var anyIter = 0u;
				for (var s = 0u; s < numSubgroups; s = s + 1u) {
					anyIter = anyIter | sharedSubgroupHasMerge[s];
				}
				uAnyMerge = anyIter;
			}
			let stillMerging = workgroupUniformLoad(&uAnyMerge);
			if (stillMerging == 0u) {
				break; // Uniform across workgroup - safe with barriers
			}

			// Find nearest neighbor
			var nearestIdx = INVALID_IDX;
			var nearestCost = 1e30f;

			if (doIter && laneId < numPrim) {
				let myMin = sharedBoundsMin[waveBase + laneId];
				let myMax = sharedBoundsMax[waveBase + laneId];

				let searchStart = select(0u, laneId - SEARCH_RADIUS, laneId >= SEARCH_RADIUS);
				let searchEnd = min(laneId + SEARCH_RADIUS + 1u, numPrim);

				for (var j = searchStart; j < searchEnd; j = j + 1u) {
					if (j != laneId) {
						let otherMin = sharedBoundsMin[waveBase + j];
						let otherMax = sharedBoundsMax[waveBase + j];
						let mergedMin = min(myMin, otherMin);
						let mergedMax = max(myMax, otherMax);
						let cost = aabbArea(mergedMin, mergedMax);

						if (cost < nearestCost) {
							nearestCost = cost;
							nearestIdx = j;
						}
					}
				}
				sharedNearestNeighbor[waveBase + laneId] = nearestIdx;
			} else if (doIter) {
				// Keep data defined for lanes >= numPrim
				sharedNearestNeighbor[waveBase + laneId] = INVALID_IDX;
			}
			workgroupBarrier();

			// Determine mutual nearest neighbor pairs (lower index merges)
			var shouldMerge = false;
			if (doIter && laneId < numPrim && nearestIdx != INVALID_IDX && nearestIdx < numPrim) {
				let theirNearest = sharedNearestNeighbor[waveBase + nearestIdx];
				if (theirNearest == laneId && laneId < nearestIdx) {
					shouldMerge = true;
				}
			}

			// Wave-aggregated node allocation (single atomic per subgroup per iteration)
			let mergeCount = unsafeSubgroupAdd(select(0u, 1u, shouldMerge));
			let mergePrefix = unsafeSubgroupExclusiveAdd(select(0u, 1u, shouldMerge));

			var allocBase = 0u;
			if (doIter && laneId == 0u && mergeCount > 0u) {
				allocBase = atomicAdd(&nodeCounter, mergeCount);
			}
			allocBase = unsafeSubgroupShuffle(allocBase, 0u);

			// Perform merges
			let maxNodes = 2u * uniforms.primCount;
			if (doIter && shouldMerge) {
				let leftCluster = sharedClusterIdx[waveBase + laneId];
				let rightCluster = sharedClusterIdx[waveBase + nearestIdx];

				let mergedMin = min(sharedBoundsMin[waveBase + laneId], sharedBoundsMin[waveBase + nearestIdx]);
				let mergedMax = max(sharedBoundsMax[waveBase + laneId], sharedBoundsMax[waveBase + nearestIdx]);

				let newNodeIdx = allocBase + mergePrefix;
				if (newNodeIdx < maxNodes) {
					bvh2Nodes[newNodeIdx].boundsMin = mergedMin;
					bvh2Nodes[newNodeIdx].boundsMax = mergedMax;
					bvh2Nodes[newNodeIdx].leftChild = leftCluster;
					bvh2Nodes[newNodeIdx].rightChild = rightCluster;

					sharedClusterIdx[waveBase + laneId] = newNodeIdx;
					sharedBoundsMin[waveBase + laneId] = mergedMin;
					sharedBoundsMax[waveBase + laneId] = mergedMax;
				}
			}
			workgroupBarrier();

			// Compaction: determine who survives
			var survives = false;
			if (doIter && laneId < numPrim) {
				survives = true;
				let myNearest = sharedNearestNeighbor[waveBase + laneId];
				if (myNearest != INVALID_IDX && myNearest < numPrim) {
					let theirNearest = sharedNearestNeighbor[waveBase + myNearest];
					// I was merged INTO if they chose me AND they have lower index
					if (theirNearest == laneId && myNearest < laneId) {
						survives = false;
					}
				}
			}

			let surviveCount = unsafeSubgroupAdd(select(0u, 1u, survives));
			let survivePrefix = unsafeSubgroupExclusiveAdd(select(0u, 1u, survives));

			if (doIter && survives) {
				sharedTempIdx[waveBase + survivePrefix] = sharedClusterIdx[waveBase + laneId];
				sharedTempMin[waveBase + survivePrefix] = sharedBoundsMin[waveBase + laneId];
				sharedTempMax[waveBase + survivePrefix] = sharedBoundsMax[waveBase + laneId];
			}
			workgroupBarrier();

			if (doIter && laneId < surviveCount) {
				sharedClusterIdx[waveBase + laneId] = sharedTempIdx[waveBase + laneId];
				sharedBoundsMin[waveBase + laneId] = sharedTempMin[waveBase + laneId];
				sharedBoundsMax[waveBase + laneId] = sharedTempMax[waveBase + laneId];
			}
			workgroupBarrier();

			if (doIter) {
				numPrim = surviveCount;
			}
		}

		// ===== Write results back to global clusterIdx =====
		if (doMerge && laneId < originalLoadedCount) {
			let outIdx = select(INVALID_IDX, sharedClusterIdx[waveBase + laneId], laneId < numPrim);
			clusterIdx[mergeLeft + laneId] = outIdx;
		}

		// FIX: Only the selected lane clears its own needsMerge and updates its own isActive.
		if (doMerge && laneId == selLane) {
			needsMerge = false;

			// Deactivate only when final merge reached a single root cluster
			if (mergeFinal && numPrim <= 1u) {
				isActive = false;
			}
		}

		// End-of-round sync so barriers remain ordered across the workgroup.
		workgroupBarrier();
	}

	// Save state
	if (!isOOB) {
		state[primIdx] = vec4u(left, right, split, select(0u, 1u, isActive));
	}
}
`;
