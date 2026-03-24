/**
 * Radix sort shaders for sorting Morton codes with associated values.
 * Uses 8-bit digits (4 passes for 32-bit keys).
 *
 * Stable radix sort (required for LSD radix correctness):
 * 1. Histogram: Count per-workgroup digits, store counts, accumulate totals
 * 2. Workgroup Scan: Compute exclusive prefix sum across workgroups for each digit
 * 3. Digit Scan: Simple 256-element prefix sum for digit base offsets
 * 4. Scatter: Use workgroup offset + digit base + local rank
 *
 * Stability is achieved by deterministic workgroup-order prefix sum,
 * ensuring workgroup 0's elements always come before workgroup 1's within each digit.
 */

// Histogram shader: Count digit occurrences per workgroup
export const histogramShader = /* wgsl */ `

struct Uniforms {
	primCount: u32,
	bitOffset: u32,
	workgroupCount: u32,
	pad1: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> keys: array<u32>;
@group(0) @binding(2) var<storage, read_write> groupCounts: array<u32>;
@group(0) @binding(3) var<storage, read_write> globalDigitCount: array<atomic<u32>>;

const WORKGROUP_SIZE: u32 = 256u;
const RADIX_SIZE: u32 = 256u;

var<workgroup> localHistogram: array<atomic<u32>, RADIX_SIZE>;

@compute @workgroup_size(256)
fn computeHistogram(
	@builtin(global_invocation_id) globalId: vec3u,
	@builtin(local_invocation_id) localId: vec3u,
	@builtin(workgroup_id) workgroupId: vec3u
) {
	let idx = globalId.x;
	let localIdx = localId.x;

	// Initialize local histogram
	if (localIdx < RADIX_SIZE) {
		atomicStore(&localHistogram[localIdx], 0u);
	}

	workgroupBarrier();

	// Count local occurrences
	if (idx < uniforms.primCount) {
		let key = keys[idx];
		let digit = (key >> uniforms.bitOffset) & 0xFFu;
		atomicAdd(&localHistogram[digit], 1u);
	}

	workgroupBarrier();

	// Store per-workgroup counts (not reservations - that was non-deterministic!)
	// Also accumulate global totals for digit base offset calculation
	if (localIdx < RADIX_SIZE) {
		let count = atomicLoad(&localHistogram[localIdx]);
		// Store count for workgroup scan to process in deterministic order
		groupCounts[workgroupId.x * RADIX_SIZE + localIdx] = count;
		// Accumulate global total for this digit
		atomicAdd(&globalDigitCount[localIdx], count);
	}
}
`;

// Workgroup scan shader: Compute exclusive prefix sum across workgroups for each digit
// This ensures stability: workgroup 0's elements come before workgroup 1's within each digit
export const workgroupScanShader = /* wgsl */ `

struct Uniforms {
	primCount: u32,
	bitOffset: u32,
	workgroupCount: u32,
	pad1: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> groupCounts: array<u32>;
@group(0) @binding(2) var<storage, read_write> groupPrefix: array<u32>;

const RADIX_SIZE: u32 = 256u;

@compute @workgroup_size(256)
fn workgroupScan(
	@builtin(local_invocation_id) localId: vec3u
) {
	let digit = localId.x;  // Each thread handles one digit (256 threads = 256 digits)

	// Compute exclusive prefix sum across all workgroups for this digit
	// This is O(workgroupCount) per thread, but ensures deterministic ordering
	var sum = 0u;
	for (var wg = 0u; wg < uniforms.workgroupCount; wg++) {
		let count = groupCounts[wg * RADIX_SIZE + digit];
		groupPrefix[wg * RADIX_SIZE + digit] = sum;  // Exclusive prefix
		sum += count;
	}
}
`;

// Scan shader: Simple 256-element prefix sum for digit base offsets
export const scanShader = /* wgsl */ `

@group(0) @binding(1) var<storage, read> globalDigitCount: array<u32>;
@group(0) @binding(2) var<storage, read_write> digitOffsets: array<u32>;

const RADIX_SIZE: u32 = 256u;

var<workgroup> sharedScan: array<u32, RADIX_SIZE>;

@compute @workgroup_size(256)
fn prefixScan(
	@builtin(local_invocation_id) localId: vec3u
) {
	let idx = localId.x;

	// Load digit counts
	sharedScan[idx] = globalDigitCount[idx];
	workgroupBarrier();

	// Hillis-Steele inclusive prefix sum (log2(256) = 8 iterations)
	for (var stride = 1u; stride < RADIX_SIZE; stride = stride * 2u) {
		var addVal = 0u;
		if (idx >= stride) {
			addVal = sharedScan[idx - stride];
		}
		workgroupBarrier();
		sharedScan[idx] = sharedScan[idx] + addVal;
		workgroupBarrier();
	}

	// Convert inclusive to exclusive prefix sum and store
	if (idx == 0u) {
		digitOffsets[0] = 0u;
	} else {
		digitOffsets[idx] = sharedScan[idx - 1u];
	}
}
`;

// Scatter shader: Reorder keys and values based on prefix sums
export const scatterShader = /* wgsl */ `

struct Uniforms {
	primCount: u32,
	bitOffset: u32,
	workgroupCount: u32,
	pad1: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> keysIn: array<u32>;
@group(0) @binding(2) var<storage, read_write> keysOut: array<u32>;
@group(0) @binding(3) var<storage, read> valsIn: array<u32>;
@group(0) @binding(4) var<storage, read_write> valsOut: array<u32>;
@group(0) @binding(5) var<storage, read> groupPrefix: array<u32>;
@group(0) @binding(6) var<storage, read> digitOffsets: array<u32>;

const WORKGROUP_SIZE: u32 = 256u;
const RADIX_SIZE: u32 = 256u;

var<workgroup> sharedDigits: array<u32, WORKGROUP_SIZE>;
var<workgroup> sharedRanks: array<u32, WORKGROUP_SIZE>;
var<workgroup> digitCounts: array<u32, RADIX_SIZE>;

@compute @workgroup_size(256)
fn scatter(
	@builtin(global_invocation_id) globalId: vec3u,
	@builtin(local_invocation_id) localId: vec3u,
	@builtin(workgroup_id) workgroupId: vec3u
) {
	let idx = globalId.x;
	let localIdx = localId.x;
	let valid = idx < uniforms.primCount;

	var digit = 0xFFFFFFFFu;
	if (valid) {
		let key = keysIn[idx];
		digit = (key >> uniforms.bitOffset) & 0xFFu;
	}

	sharedDigits[localIdx] = digit;
	workgroupBarrier();

	// Thread 0 computes all ranks in single O(n) pass
	// This maintains stability: threads are processed in order
	if (localIdx == 0u) {
		// Zero digit counts
		for (var d = 0u; d < RADIX_SIZE; d = d + 1u) {
			digitCounts[d] = 0u;
		}
		// Assign ranks in thread order (stable)
		for (var i = 0u; i < WORKGROUP_SIZE; i = i + 1u) {
			let d = sharedDigits[i];
			if (d < RADIX_SIZE) {
				sharedRanks[i] = digitCounts[d];
				digitCounts[d] = digitCounts[d] + 1u;
			} else {
				sharedRanks[i] = 0u;
			}
		}
	}
	workgroupBarrier();

	if (!valid) {
		return;
	}

	let localRank = sharedRanks[localIdx];
	let key = keysIn[idx];
	let val = valsIn[idx];
	let groupOffset = groupPrefix[workgroupId.x * RADIX_SIZE + digit];
	let baseOffset = digitOffsets[digit];
	let destIdx = baseOffset + groupOffset + localRank;

	keysOut[destIdx] = key;
	valsOut[destIdx] = val;
}
`;

export const radixSortShaders = {
	histogram: histogramShader,
	workgroupScan: workgroupScanShader,
	scan: scanShader,
	scatter: scatterShader,
};
