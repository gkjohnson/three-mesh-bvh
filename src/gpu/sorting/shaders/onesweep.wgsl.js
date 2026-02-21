export const oneSweep16Shader = `
//****************************************************************************
// GPUSorting
// OneSweep - WaveSize 16-32 variant
//
// SPDX-License-Identifier: MIT
// Copyright Thomas Smith 12/7/2024
// https://github.com/b0nes164/GPUSorting
//
// Modified for WGSL compatibility and variable subgroup sizes by Dino Metarapi, 2025
// Based on original work by Thomas Smith
//
// NOTE: This shader uses ballot.x (32 bits) for peer masks, so it only works
// for lane_count <= 32. For lane_count > 32, use the wave64 variant.
//****************************************************************************

enable subgroups;

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupInclusiveAdd(x: u32) -> u32 { return subgroupInclusiveAdd(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupExclusiveAdd(x: u32) -> u32 { return subgroupExclusiveAdd(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupShuffle(x: u32, source: u32) -> u32 { return subgroupShuffle(x, source); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupBallot(pred: bool) -> vec4<u32> { return subgroupBallot(pred); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupAdd(x: u32) -> u32 { return subgroupAdd(x); }

struct InfoStruct
{
    size: u32,
    shift: u32,
    thread_blocks: u32,
    seed: u32,
};

@group(0) @binding(0)
var<uniform> info : InfoStruct;

@group(0) @binding(1)
var<storage, read_write> bump: array<atomic<u32>>;

@group(0) @binding(2)
var<storage, read_write> sort: array<u32>;

@group(0) @binding(3)
var<storage, read_write> alt: array<u32>;

@group(0) @binding(4)
var<storage, read_write> payload: array<u32>;

@group(0) @binding(5)
var<storage, read_write> alt_payload: array<u32>;

@group(0) @binding(6)
var<storage, read_write> hist: array<atomic<u32>>;

@group(0) @binding(7)
var<storage, read_write> pass_hist: array<atomic<u32>>;

@group(0) @binding(8)
var<storage, read_write> status: array<u32>;

const SORT_PASSES = 4u;
const BLOCK_DIM = 256u;
const MIN_SUBGROUP_SIZE = 16u;
const MAX_SUBGROUP_SIZE_W16 = 32u;  // ballot.x is only 32 bits - wave16 max
const MAX_REDUCE_SIZE = BLOCK_DIM / MIN_SUBGROUP_SIZE;

const STATUS_ERR_GLOBAL_HIST = 0u;
const STATUS_ERR_SCAN = 1u;
const STATUS_ERR_PASS = 2u;
const STATUS_ERR_LANE_COUNT = 3u;

const FLAG_NOT_READY = 0u;
const FLAG_REDUCTION = 1u;
const FLAG_INCLUSIVE = 2u;
const FLAG_MASK = 3u;

const RADIX = 256u;
const ALL_RADIX = RADIX * SORT_PASSES;
const RADIX_MASK = 255u;
const RADIX_LOG = 8u;

const KEYS_PER_THREAD = 15u;
const PART_SIZE = KEYS_PER_THREAD * BLOCK_DIM;

const REDUCE_BLOCK_DIM = 128u;
const REDUCE_KEYS_PER_THREAD = 30u;
const REDUCE_HIST_SIZE = REDUCE_BLOCK_DIM / MIN_SUBGROUP_SIZE * ALL_RADIX;
const REDUCE_PART_SIZE = REDUCE_KEYS_PER_THREAD * REDUCE_BLOCK_DIM;

const MAX_SUBGROUPS_PER_BLOCK = BLOCK_DIM / MIN_SUBGROUP_SIZE;
const WARP_HIST_CAPACITY = MAX_SUBGROUPS_PER_BLOCK * RADIX;

var<workgroup> wg_globalHist: array<atomic<u32>, REDUCE_HIST_SIZE>;

@compute @workgroup_size(REDUCE_BLOCK_DIM, 1, 1)
fn global_hist(
    @builtin(local_invocation_id) threadid: vec3<u32>,
    @builtin(subgroup_invocation_id) laneid: u32,
    @builtin(subgroup_size) lane_count: u32,
    @builtin(workgroup_id) wgid: vec3<u32>) {

    if (lane_count < MIN_SUBGROUP_SIZE || (REDUCE_BLOCK_DIM % lane_count) != 0u) {
        if (threadid.x == 0u) {
            status[STATUS_ERR_GLOBAL_HIST] = 0xDEAD0001u;
        }
        return;
    }

    let sid = threadid.x / lane_count;

    //Clear shared memory
    for (var i = threadid.x; i < REDUCE_HIST_SIZE; i += REDUCE_BLOCK_DIM) {
        atomicStore(&wg_globalHist[i], 0u);
    }
    workgroupBarrier();

    let radix_shift = info.shift;
    let hist_offset = sid * ALL_RADIX;
    {
        var i = threadid.x + wgid.x * REDUCE_PART_SIZE;
        if(wgid.x < info.thread_blocks - 1) {
            for (var k = 0u; k < REDUCE_KEYS_PER_THREAD; k += 1u) {
                let key = sort[i];
                atomicAdd(&wg_globalHist[(key & RADIX_MASK) + hist_offset], 1u);
                atomicAdd(&wg_globalHist[((key >> 8u) & RADIX_MASK) + hist_offset + 256u], 1u);
                atomicAdd(&wg_globalHist[((key >> 16u) & RADIX_MASK) + hist_offset + 512u], 1u);
                atomicAdd(&wg_globalHist[((key >> 24u) & RADIX_MASK) + hist_offset + 768u], 1u);
                i += REDUCE_BLOCK_DIM;
            }
        }

        if(wgid.x == info.thread_blocks - 1) {
            for (var k = 0u; k < REDUCE_KEYS_PER_THREAD; k += 1u) {
                if (i < info.size) {
                    let key = sort[i];
                    atomicAdd(&wg_globalHist[(key & RADIX_MASK) + hist_offset], 1u);
                    atomicAdd(&wg_globalHist[((key >> 8u) & RADIX_MASK) + hist_offset + 256u], 1u);
                    atomicAdd(&wg_globalHist[((key >> 16u) & RADIX_MASK) + hist_offset + 512u], 1u);
                    atomicAdd(&wg_globalHist[((key >> 24u) & RADIX_MASK) + hist_offset + 768u], 1u);
                }
                i += REDUCE_BLOCK_DIM;
            }
        }
    }
    workgroupBarrier();

    // Merge subgroup histograms
    let subgroup_histograms = REDUCE_BLOCK_DIM / lane_count;
    for(var i = threadid.x; i < RADIX; i += REDUCE_BLOCK_DIM) {
        var reduction0 = atomicLoad(&wg_globalHist[i]);
        var reduction1 = atomicLoad(&wg_globalHist[i + 256u]);
        var reduction2 = atomicLoad(&wg_globalHist[i + 512u]);
        var reduction3 = atomicLoad(&wg_globalHist[i + 768u]);

        for (var h = 1u; h < subgroup_histograms; h += 1u) {
            let idx = h * ALL_RADIX;
            reduction0 += atomicLoad(&wg_globalHist[i + idx]);
            reduction1 += atomicLoad(&wg_globalHist[i + 256u + idx]);
            reduction2 += atomicLoad(&wg_globalHist[i + 512u + idx]);
            reduction3 += atomicLoad(&wg_globalHist[i + 768u + idx]);
        }

        atomicAdd(&hist[i], reduction0);
        atomicAdd(&hist[i + 256u], reduction1);
        atomicAdd(&hist[i + 512u], reduction2);
        atomicAdd(&hist[i + 768u], reduction3);
    }
}

//Assumes block dim 256
const SCAN_MEM_SIZE = RADIX / MIN_SUBGROUP_SIZE;
var<workgroup> wg_scan: array<u32, SCAN_MEM_SIZE>;
@compute @workgroup_size(BLOCK_DIM, 1, 1)
fn onesweep_scan(
    @builtin(local_invocation_id) threadid: vec3<u32>,
    @builtin(subgroup_invocation_id) laneid: u32,
    @builtin(subgroup_size) lane_count: u32,
    @builtin(workgroup_id) wgid: vec3<u32>) {

    if (lane_count < MIN_SUBGROUP_SIZE || (BLOCK_DIM % lane_count) != 0u) {
        if (threadid.x == 0u) {
            status[STATUS_ERR_SCAN] = 0xDEAD0002u;
        }
        return;
    }

    let sid = threadid.x / lane_count;
    let pass_plane = info.shift >> 3u;
    let hist_index = threadid.x + pass_plane * RADIX;
    let scan = atomicLoad(&hist[hist_index]);
    let red = unsafeSubgroupAdd(scan);
    if(laneid == 0u){
        wg_scan[sid] = red;
    }
    workgroupBarrier();

    //Non-divergent subgroup agnostic inclusive scan across subgroup reductions
    {
        var offset0 = 0u;
        var offset1 = 0u;
        let lane_log = u32(countTrailingZeros(lane_count));
        let spine_size = BLOCK_DIM >> lane_log;
        let aligned_size = 1u << ((u32(countTrailingZeros(spine_size)) + lane_log - 1u) / lane_log * lane_log);
        for(var j = lane_count; j <= aligned_size; j <<= lane_log){
            let i0 = ((threadid.x + offset0) << offset1) - select(0u, 1u, j != lane_count);
            let pred0 = i0 < spine_size;
            let t0 = unsafeSubgroupInclusiveAdd(select(0u, wg_scan[i0], pred0));
            if(pred0){
                wg_scan[i0] = t0;
            }
            workgroupBarrier();

            if(j != lane_count){
                let rshift = j >> lane_log;
                let i1 = threadid.x + rshift;
                if ((i1 & (j - 1u)) >= rshift){
                    let pred1 = i1 < spine_size;
                    let t1 = select(0u, wg_scan[((i1 >> offset1) << offset1) - 1u], pred1);
                    if(pred1 && ((i1 + 1u) & (rshift - 1u)) != 0u){
                        wg_scan[i1] += t1;
                    }
                }
            } else {
                offset0 += 1u;
            }
            offset1 += lane_log;
        }
    }
    workgroupBarrier();

    if (wgid.x != 0u) {
        return;
    }

    let plane_stride = info.thread_blocks * RADIX;
    let pass_index = threadid.x + pass_plane * plane_stride;
    let subgroup_prefix = unsafeSubgroupExclusiveAdd(scan);
    var spine_prefix = 0u;
    if (sid > 0u) {
        spine_prefix = wg_scan[sid - 1u];
    }
    atomicStore(&pass_hist[pass_index], ((subgroup_prefix + spine_prefix) << 2u) | FLAG_INCLUSIVE);
}

var<workgroup> wg_subgroupHist: array<atomic<u32>, WARP_HIST_CAPACITY>;
var<workgroup> wg_localHist: array<u32, RADIX>;
var<workgroup> wg_broadcast: u32;

// Wave16 WLMS: uses ballot.x (32 bits) - only valid for lane_count <= 32
fn WLMS(key: u32, shift: u32, laneid: u32, lane_count: u32, lane_mask_lt: u32, s_offset: u32, key_valid: bool) -> u32 {
    // FIX: Compute valid_mask FIRST to exclude invalid lanes from peer groups.
    // Without this, invalid lanes (key_valid=false) look like "bit=0" lanes during ballot,
    // allowing them to join peer groups with valid keys. If an invalid lane becomes
    // highest_rank_peer, the atomicAdd is skipped (gated by key_valid), causing missing
    // histogram increments → offset collisions → duplicates/missing elements.
    let valid_mask = unsafeSubgroupBallot(key_valid).x;

    var eq_mask = 0xffffffffu;
    for (var k = 0u; k < RADIX_LOG; k += 1u) {
        let curr_bit = 1u << (k + shift);
        let pred = key_valid && ((key & curr_bit) != 0u);
        let ballot = unsafeSubgroupBallot(pred);
        eq_mask &= select(~ballot.x, ballot.x, pred);
    }

    // Remove invalid lanes from the peer group (critical fix for partial last partitions)
    eq_mask &= valid_mask;

    var subgroup_mask = 0xffffffffu;
    if (lane_count != 32u) {
        subgroup_mask = (1u << lane_count) - 1u;
    }
    eq_mask &= subgroup_mask;

    if (!key_valid) {
        eq_mask = 0u;
    }
    var out = countOneBits(eq_mask & lane_mask_lt);
    let highest_rank_peer = select(lane_count - 1u, 31u - countLeadingZeros(eq_mask), eq_mask != 0u);
    var pre_inc = 0u;
    if (key_valid && eq_mask != 0u && laneid == highest_rank_peer) {
        pre_inc = atomicAdd(&wg_subgroupHist[((key >> shift) & RADIX_MASK) + s_offset], out + 1u);
    }
    workgroupBarrier();
    // Call shuffle unconditionally to maintain uniform control flow across subgroup.
    // Divergent subgroup ops (when some lanes skip due to keyValid=false) cause undefined behavior.
    let bcast = unsafeSubgroupShuffle(pre_inc, highest_rank_peer);
    // Only apply it for real keys / real peer groups
    out += select(0u, bcast, eq_mask != 0u);
    return select(0u, out, key_valid);
}

fn fake_wlms(key: u32, shift: u32, laneid: u32, lane_count: u32, lane_mask_lt: u32, s_offset: u32) -> u32 {
    return 0u;
}

@compute @workgroup_size(BLOCK_DIM, 1, 1)
fn onesweep_pass(
    @builtin(local_invocation_id) threadid: vec3<u32>,
    @builtin(subgroup_invocation_id) laneid: u32,
    @builtin(subgroup_size) lane_count: u32) {

    let shift = info.shift;
    let sid = threadid.x / lane_count;

    // CRITICAL: This wave16 shader uses ballot.x (32 bits only) for peer masks.
    // If lane_count > 32, the ballot mask would miss lanes 32+, causing corruption.
    // Also lane_mask_lt = (1u << laneid) - 1u overflows for laneid >= 32.
    if (lane_count > MAX_SUBGROUP_SIZE_W16) {
        if (threadid.x == 0u) {
            status[STATUS_ERR_LANE_COUNT] = 0xDEAD0016u | (lane_count << 16u);
        }
        return;
    }

    let subgroup_hist_size = (BLOCK_DIM / lane_count) * RADIX;
    if (subgroup_hist_size > WARP_HIST_CAPACITY) {
        if (threadid.x == 0u) {
            status[STATUS_ERR_PASS] = 0xDEAD0004u;
        }
        return;
    }

    for (var i = threadid.x; i < subgroup_hist_size; i += BLOCK_DIM) {
        atomicStore(&wg_subgroupHist[i], 0u);
    }
    workgroupBarrier();

    if (threadid.x == 0u) {
        wg_broadcast = atomicAdd(&bump[shift >> 3u], 1u);
    }
    // Explicit barrier to ensure wg_broadcast is visible to all threads
    workgroupBarrier();
    let partid = wg_broadcast;

    var keys = array<u32, KEYS_PER_THREAD>();
    var values = array<u32, KEYS_PER_THREAD>();
    var keyValid = array<bool, KEYS_PER_THREAD>();
    {
        let dev_offset = partid * PART_SIZE;
        let lane_stride = sid * lane_count * KEYS_PER_THREAD;
        var idx = laneid + lane_stride + dev_offset;
        if (partid < info.thread_blocks - 1u) {
            for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
                keys[k] = sort[idx];
                values[k] = payload[idx];
                keyValid[k] = true;
                idx += lane_count;
            }
        } else {
            for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
                if (idx < info.size) {
                    keys[k] = sort[idx];
                    values[k] = payload[idx];
                    keyValid[k] = true;
                } else {
                    keys[k] = 0xffffffffu;
                    values[k] = 0xffffffffu;
                    keyValid[k] = false;
                }
                idx += lane_count;
            }
        }
    }

    var offsets = array<u32, KEYS_PER_THREAD>();
    {
        let lane_mask_lt = (1u << laneid) - 1u;
        let hist_offset = sid * RADIX;
        for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
            offsets[k] = WLMS(keys[k], shift, laneid, lane_count, lane_mask_lt, hist_offset, keyValid[k]);
        }
    }
    workgroupBarrier();

    var local_reduction = 0u;
    if (threadid.x < RADIX) {
        local_reduction = atomicLoad(&wg_subgroupHist[threadid.x]);
        var subtotal = local_reduction;
        for (var i = threadid.x + RADIX; i < subgroup_hist_size; i += RADIX) {
            let current = atomicLoad(&wg_subgroupHist[i]);
            atomicStore(&wg_subgroupHist[i], subtotal);
            subtotal += current;
        }
        local_reduction = subtotal;

        if (partid < info.thread_blocks - 1u) {
            let pass_plane = shift >> 3u;
            let pass_index = threadid.x + pass_plane * info.thread_blocks * RADIX + (partid + 1u) * RADIX;
            atomicStore(&pass_hist[pass_index], (local_reduction << 2u) | FLAG_REDUCTION);
        }

        let lane_mask = lane_count - 1u;
        let circular_lane_shift = (laneid + lane_mask) & lane_mask;
        let t = unsafeSubgroupInclusiveAdd(local_reduction);
        wg_localHist[threadid.x] = unsafeSubgroupShuffle(t, circular_lane_shift);
    }
    workgroupBarrier();

    if (threadid.x < lane_count) {
        let pred = threadid.x < RADIX / lane_count;
        let t = unsafeSubgroupExclusiveAdd(select(0u, wg_localHist[threadid.x * lane_count], pred));
        if (pred) {
            wg_localHist[threadid.x * lane_count] = t;
        }
    }
    workgroupBarrier();

    if (threadid.x < RADIX && laneid != 0u) {
        wg_localHist[threadid.x] += wg_localHist[(threadid.x / lane_count) * lane_count];
    }
    workgroupBarrier();

    for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
        if (keyValid[k]) {
            let digit = (keys[k] >> shift) & RADIX_MASK;
            let block_prefix = wg_localHist[digit];
            if (sid == 0u) {
                offsets[k] += block_prefix;
            } else {
                let subgroup_prefix = atomicLoad(&wg_subgroupHist[digit + sid * RADIX]);
                offsets[k] += block_prefix + subgroup_prefix;
            }
        }
    }
    workgroupBarrier();

    if (threadid.x < RADIX) {
        let pass_plane = shift >> 3u;
        let base_plane = pass_plane * info.thread_blocks * RADIX;
        let bin = threadid.x;
        let block_prefix = wg_localHist[bin];
        var prev_reduction = 0u;
        var lookbackid = partid;
        loop {
            let flag_payload = atomicLoad(&pass_hist[bin + base_plane + lookbackid * RADIX]);
            if ((flag_payload & FLAG_MASK) > FLAG_NOT_READY) {
                prev_reduction += flag_payload >> 2u;
                if ((flag_payload & FLAG_MASK) == FLAG_INCLUSIVE) {
                    if (partid < info.thread_blocks - 1u) {
                        let next_idx = bin + base_plane + (partid + 1u) * RADIX;
                        atomicStore(&pass_hist[next_idx], ((prev_reduction + local_reduction) << 2u) | FLAG_INCLUSIVE);
                    }
                    wg_localHist[bin] = prev_reduction - block_prefix;
                    break;
                } else {
                    lookbackid -= 1u;
                }
            }
        }
    }
    workgroupBarrier();

    for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
        if (keyValid[k]) {
            let digit = (keys[k] >> shift) & RADIX_MASK;
            let global_offset = wg_localHist[digit] + offsets[k];
            if (global_offset < info.size) {
                alt[global_offset] = keys[k];
                alt_payload[global_offset] = values[k];
            }
        }
    }
}
`;

export const oneSweep32Shader = `
//****************************************************************************
// GPUSorting
// OneSweep - WaveSize 32 variant
//
// SPDX-License-Identifier: MIT
// Copyright Thomas Smith 12/7/2024
// https://github.com/b0nes164/GPUSorting
//
// Modified for WGSL compatibility and variable subgroup sizes by Dino Metarapi, 2025
// Based on original work by Thomas Smith
//****************************************************************************

enable subgroups;

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupInclusiveAdd(x: u32) -> u32 { return subgroupInclusiveAdd(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupExclusiveAdd(x: u32) -> u32 { return subgroupExclusiveAdd(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupShuffle(x: u32, source: u32) -> u32 { return subgroupShuffle(x, source); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupBallot(pred: bool) -> vec4<u32> { return subgroupBallot(pred); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupAdd(x: u32) -> u32 { return subgroupAdd(x); }

struct InfoStruct
{
    size: u32,
    shift: u32,
    thread_blocks: u32,
    seed: u32,
};

@group(0) @binding(0)
var<uniform> info : InfoStruct;

@group(0) @binding(1)
var<storage, read_write> bump: array<atomic<u32>>;

@group(0) @binding(2)
var<storage, read_write> sort: array<u32>;

@group(0) @binding(3)
var<storage, read_write> alt: array<u32>;

@group(0) @binding(4)
var<storage, read_write> payload: array<u32>;

@group(0) @binding(5)
var<storage, read_write> alt_payload: array<u32>;

@group(0) @binding(6)
var<storage, read_write> hist: array<atomic<u32>>;

@group(0) @binding(7)
var<storage, read_write> pass_hist: array<atomic<u32>>;

@group(0) @binding(8)
var<storage, read_write> status: array<u32>;

const SORT_PASSES = 4u;
const BLOCK_DIM = 256u;
const MIN_SUBGROUP_SIZE = 32u;
const MAX_SUBGROUP_SIZE_W32 = 32u;  // ballot.x is only 32 bits - wave32 max
const MAX_REDUCE_SIZE = BLOCK_DIM / MIN_SUBGROUP_SIZE;

const STATUS_ERR_GLOBAL_HIST = 0u;
const STATUS_ERR_SCAN = 1u;
const STATUS_ERR_PASS = 2u;
const STATUS_ERR_LANE_COUNT = 3u;

const FLAG_NOT_READY = 0u;
const FLAG_REDUCTION = 1u;
const FLAG_INCLUSIVE = 2u;
const FLAG_MASK = 3u;

const RADIX = 256u;
const ALL_RADIX = RADIX * SORT_PASSES;
const RADIX_MASK = 255u;
const RADIX_LOG = 8u;

const KEYS_PER_THREAD = 15u;
const PART_SIZE = KEYS_PER_THREAD * BLOCK_DIM;

const REDUCE_BLOCK_DIM = 128u;
const REDUCE_KEYS_PER_THREAD = 30u;
const REDUCE_HIST_SIZE = REDUCE_BLOCK_DIM / MIN_SUBGROUP_SIZE * ALL_RADIX;
const REDUCE_PART_SIZE = REDUCE_KEYS_PER_THREAD * REDUCE_BLOCK_DIM;

const MAX_SUBGROUPS_PER_BLOCK = BLOCK_DIM / MIN_SUBGROUP_SIZE;
const WARP_HIST_CAPACITY = MAX_SUBGROUPS_PER_BLOCK * RADIX;

var<workgroup> wg_globalHist: array<atomic<u32>, REDUCE_HIST_SIZE>;

@compute @workgroup_size(REDUCE_BLOCK_DIM, 1, 1)
fn global_hist(
    @builtin(local_invocation_id) threadid: vec3<u32>,
    @builtin(subgroup_invocation_id) laneid: u32,
    @builtin(subgroup_size) lane_count: u32,
    @builtin(workgroup_id) wgid: vec3<u32>) {

    if (lane_count < MIN_SUBGROUP_SIZE || (REDUCE_BLOCK_DIM % lane_count) != 0u) {
        if (threadid.x == 0u) {
            status[STATUS_ERR_GLOBAL_HIST] = 0xDEAD0001u;
        }
        return;
    }

    let sid = threadid.x / lane_count;

    //Clear shared memory
    for (var i = threadid.x; i < REDUCE_HIST_SIZE; i += REDUCE_BLOCK_DIM) {
        atomicStore(&wg_globalHist[i], 0u);
    }
    workgroupBarrier();

    let radix_shift = info.shift;
    let hist_offset = sid * ALL_RADIX;
    {
        var i = threadid.x + wgid.x * REDUCE_PART_SIZE;
        if(wgid.x < info.thread_blocks - 1) {
            for (var k = 0u; k < REDUCE_KEYS_PER_THREAD; k += 1u) {
                let key = sort[i];
                atomicAdd(&wg_globalHist[(key & RADIX_MASK) + hist_offset], 1u);
                atomicAdd(&wg_globalHist[((key >> 8u) & RADIX_MASK) + hist_offset + 256u], 1u);
                atomicAdd(&wg_globalHist[((key >> 16u) & RADIX_MASK) + hist_offset + 512u], 1u);
                atomicAdd(&wg_globalHist[((key >> 24u) & RADIX_MASK) + hist_offset + 768u], 1u);
                i += REDUCE_BLOCK_DIM;
            }
        }

        if(wgid.x == info.thread_blocks - 1) {
            for (var k = 0u; k < REDUCE_KEYS_PER_THREAD; k += 1u) {
                if (i < info.size) {
                    let key = sort[i];
                    atomicAdd(&wg_globalHist[(key & RADIX_MASK) + hist_offset], 1u);
                    atomicAdd(&wg_globalHist[((key >> 8u) & RADIX_MASK) + hist_offset + 256u], 1u);
                    atomicAdd(&wg_globalHist[((key >> 16u) & RADIX_MASK) + hist_offset + 512u], 1u);
                    atomicAdd(&wg_globalHist[((key >> 24u) & RADIX_MASK) + hist_offset + 768u], 1u);
                }
                i += REDUCE_BLOCK_DIM;
            }
        }
    }
    workgroupBarrier();

    // Merge subgroup histograms
    let subgroup_histograms = REDUCE_BLOCK_DIM / lane_count;
    for(var i = threadid.x; i < RADIX; i += REDUCE_BLOCK_DIM) {
        var reduction0 = atomicLoad(&wg_globalHist[i]);
        var reduction1 = atomicLoad(&wg_globalHist[i + 256u]);
        var reduction2 = atomicLoad(&wg_globalHist[i + 512u]);
        var reduction3 = atomicLoad(&wg_globalHist[i + 768u]);

        for (var h = 1u; h < subgroup_histograms; h += 1u) {
            let idx = h * ALL_RADIX;
            reduction0 += atomicLoad(&wg_globalHist[i + idx]);
            reduction1 += atomicLoad(&wg_globalHist[i + 256u + idx]);
            reduction2 += atomicLoad(&wg_globalHist[i + 512u + idx]);
            reduction3 += atomicLoad(&wg_globalHist[i + 768u + idx]);
        }

        atomicAdd(&hist[i], reduction0);
        atomicAdd(&hist[i + 256u], reduction1);
        atomicAdd(&hist[i + 512u], reduction2);
        atomicAdd(&hist[i + 768u], reduction3);
    }
}

//Assumes block dim 256
const SCAN_MEM_SIZE = RADIX / MIN_SUBGROUP_SIZE;
var<workgroup> wg_scan: array<u32, SCAN_MEM_SIZE>;
@compute @workgroup_size(BLOCK_DIM, 1, 1)
fn onesweep_scan(
    @builtin(local_invocation_id) threadid: vec3<u32>,
    @builtin(subgroup_invocation_id) laneid: u32,
    @builtin(subgroup_size) lane_count: u32,
    @builtin(workgroup_id) wgid: vec3<u32>) {

    if (lane_count < MIN_SUBGROUP_SIZE || (BLOCK_DIM % lane_count) != 0u) {
        if (threadid.x == 0u) {
            status[STATUS_ERR_SCAN] = 0xDEAD0002u;
        }
        return;
    }

    let sid = threadid.x / lane_count;
    let pass_plane = info.shift >> 3u;
    let hist_index = threadid.x + pass_plane * RADIX;
    let scan = atomicLoad(&hist[hist_index]);
    let red = unsafeSubgroupAdd(scan);
    if(laneid == 0u){
        wg_scan[sid] = red;
    }
    workgroupBarrier();

    //Non-divergent subgroup agnostic inclusive scan across subgroup reductions
    {
        var offset0 = 0u;
        var offset1 = 0u;
        let lane_log = u32(countTrailingZeros(lane_count));
        let spine_size = BLOCK_DIM >> lane_log;
        let aligned_size = 1u << ((u32(countTrailingZeros(spine_size)) + lane_log - 1u) / lane_log * lane_log);
        for(var j = lane_count; j <= aligned_size; j <<= lane_log){
            let i0 = ((threadid.x + offset0) << offset1) - select(0u, 1u, j != lane_count);
            let pred0 = i0 < spine_size;
            let t0 = unsafeSubgroupInclusiveAdd(select(0u, wg_scan[i0], pred0));
            if(pred0){
                wg_scan[i0] = t0;
            }
            workgroupBarrier();

            if(j != lane_count){
                let rshift = j >> lane_log;
                let i1 = threadid.x + rshift;
                if ((i1 & (j - 1u)) >= rshift){
                    let pred1 = i1 < spine_size;
                    let t1 = select(0u, wg_scan[((i1 >> offset1) << offset1) - 1u], pred1);
                    if(pred1 && ((i1 + 1u) & (rshift - 1u)) != 0u){
                        wg_scan[i1] += t1;
                    }
                }
            } else {
                offset0 += 1u;
            }
            offset1 += lane_log;
        }
    }
    workgroupBarrier();

    if (wgid.x != 0u) {
        return;
    }

    let plane_stride = info.thread_blocks * RADIX;
    let pass_index = threadid.x + pass_plane * plane_stride;
    let subgroup_prefix = unsafeSubgroupExclusiveAdd(scan);
    var spine_prefix = 0u;
    if (sid > 0u) {
        spine_prefix = wg_scan[sid - 1u];
    }
    atomicStore(&pass_hist[pass_index], ((subgroup_prefix + spine_prefix) << 2u) | FLAG_INCLUSIVE);
}

var<workgroup> wg_subgroupHist: array<atomic<u32>, WARP_HIST_CAPACITY>;
var<workgroup> wg_localHist: array<u32, RADIX>;
var<workgroup> wg_broadcast: u32;

// Wave32 WLMS: uses ballot.x (32 bits) - only valid for lane_count <= 32
fn WLMS(key: u32, shift: u32, laneid: u32, lane_count: u32, lane_mask_lt: u32, s_offset: u32, key_valid: bool) -> u32 {
    // FIX: Compute valid_mask FIRST to exclude invalid lanes from peer groups.
    // Without this, invalid lanes (key_valid=false) look like "bit=0" lanes during ballot,
    // allowing them to join peer groups with valid keys. If an invalid lane becomes
    // highest_rank_peer, the atomicAdd is skipped (gated by key_valid), causing missing
    // histogram increments → offset collisions → duplicates/missing elements.
    let valid_mask = unsafeSubgroupBallot(key_valid).x;

    var eq_mask = 0xffffffffu;
    for (var k = 0u; k < RADIX_LOG; k += 1u) {
        let curr_bit = 1u << (k + shift);
        let pred = key_valid && ((key & curr_bit) != 0u);
        let ballot = unsafeSubgroupBallot(pred);
        eq_mask &= select(~ballot.x, ballot.x, pred);
    }

    // Remove invalid lanes from the peer group (critical fix for partial last partitions)
    eq_mask &= valid_mask;

    var subgroup_mask = 0xffffffffu;
    if (lane_count != 32u) {
        subgroup_mask = (1u << lane_count) - 1u;
    }
    eq_mask &= subgroup_mask;

    if (!key_valid) {
        eq_mask = 0u;
    }
    var out = countOneBits(eq_mask & lane_mask_lt);
    let highest_rank_peer = select(lane_count - 1u, 31u - countLeadingZeros(eq_mask), eq_mask != 0u);
    var pre_inc = 0u;
    if (key_valid && eq_mask != 0u && laneid == highest_rank_peer) {
        pre_inc = atomicAdd(&wg_subgroupHist[((key >> shift) & RADIX_MASK) + s_offset], out + 1u);
    }
    workgroupBarrier();
    // Call shuffle unconditionally to maintain uniform control flow across subgroup.
    // Divergent subgroup ops (when some lanes skip due to keyValid=false) cause undefined behavior.
    let bcast = unsafeSubgroupShuffle(pre_inc, highest_rank_peer);
    // Only apply it for real keys / real peer groups
    out += select(0u, bcast, eq_mask != 0u);
    return select(0u, out, key_valid);
}

fn fake_wlms(key: u32, shift: u32, laneid: u32, lane_count: u32, lane_mask_lt: u32, s_offset: u32) -> u32 {
    return 0u;
}

@compute @workgroup_size(BLOCK_DIM, 1, 1)
fn onesweep_pass(
    @builtin(local_invocation_id) threadid: vec3<u32>,
    @builtin(subgroup_invocation_id) laneid: u32,
    @builtin(subgroup_size) lane_count: u32) {

    let shift = info.shift;
    let sid = threadid.x / lane_count;

    // CRITICAL: This wave32 shader uses ballot.x (32 bits only) for peer masks.
    // If lane_count > 32, the ballot mask would miss lanes 32+, causing corruption.
    // Also lane_mask_lt = (1u << laneid) - 1u overflows for laneid >= 32.
    if (lane_count > MAX_SUBGROUP_SIZE_W32) {
        if (threadid.x == 0u) {
            status[STATUS_ERR_LANE_COUNT] = 0xDEAD0032u | (lane_count << 16u);
        }
        return;
    }

    let subgroup_hist_size = (BLOCK_DIM / lane_count) * RADIX;
    if (subgroup_hist_size > WARP_HIST_CAPACITY) {
        if (threadid.x == 0u) {
            status[STATUS_ERR_PASS] = 0xDEAD0004u;
        }
        return;
    }

    for (var i = threadid.x; i < subgroup_hist_size; i += BLOCK_DIM) {
        atomicStore(&wg_subgroupHist[i], 0u);
    }
    workgroupBarrier();

    if (threadid.x == 0u) {
        wg_broadcast = atomicAdd(&bump[shift >> 3u], 1u);
    }
    // Explicit barrier to ensure wg_broadcast is visible to all threads
    workgroupBarrier();
    let partid = wg_broadcast;

    var keys = array<u32, KEYS_PER_THREAD>();
    var values = array<u32, KEYS_PER_THREAD>();
    var keyValid = array<bool, KEYS_PER_THREAD>();
    {
        let dev_offset = partid * PART_SIZE;
        let lane_stride = sid * lane_count * KEYS_PER_THREAD;
        var idx = laneid + lane_stride + dev_offset;
        if (partid < info.thread_blocks - 1u) {
            for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
                keys[k] = sort[idx];
                values[k] = payload[idx];
                keyValid[k] = true;
                idx += lane_count;
            }
        } else {
            for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
                if (idx < info.size) {
                    keys[k] = sort[idx];
                    values[k] = payload[idx];
                    keyValid[k] = true;
                } else {
                    keys[k] = 0xffffffffu;
                    values[k] = 0xffffffffu;
                    keyValid[k] = false;
                }
                idx += lane_count;
            }
        }
    }

    var offsets = array<u32, KEYS_PER_THREAD>();
    {
        let lane_mask_lt = (1u << laneid) - 1u;
        let hist_offset = sid * RADIX;
        for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
            offsets[k] = WLMS(keys[k], shift, laneid, lane_count, lane_mask_lt, hist_offset, keyValid[k]);
        }
    }
    workgroupBarrier();

    var local_reduction = 0u;
    if (threadid.x < RADIX) {
        local_reduction = atomicLoad(&wg_subgroupHist[threadid.x]);
        var subtotal = local_reduction;
        for (var i = threadid.x + RADIX; i < subgroup_hist_size; i += RADIX) {
            let current = atomicLoad(&wg_subgroupHist[i]);
            atomicStore(&wg_subgroupHist[i], subtotal);
            subtotal += current;
        }
        local_reduction = subtotal;

        if (partid < info.thread_blocks - 1u) {
            let pass_plane = shift >> 3u;
            let pass_index = threadid.x + pass_plane * info.thread_blocks * RADIX + (partid + 1u) * RADIX;
            atomicStore(&pass_hist[pass_index], (local_reduction << 2u) | FLAG_REDUCTION);
        }

        let lane_mask = lane_count - 1u;
        let circular_lane_shift = (laneid + lane_mask) & lane_mask;
        let t = unsafeSubgroupInclusiveAdd(local_reduction);
        wg_localHist[threadid.x] = unsafeSubgroupShuffle(t, circular_lane_shift);
    }
    workgroupBarrier();

    if (threadid.x < lane_count) {
        let pred = threadid.x < RADIX / lane_count;
        let t = unsafeSubgroupExclusiveAdd(select(0u, wg_localHist[threadid.x * lane_count], pred));
        if (pred) {
            wg_localHist[threadid.x * lane_count] = t;
        }
    }
    workgroupBarrier();

    if (threadid.x < RADIX && laneid != 0u) {
        wg_localHist[threadid.x] += wg_localHist[(threadid.x / lane_count) * lane_count];
    }
    workgroupBarrier();

    for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
        if (keyValid[k]) {
            let digit = (keys[k] >> shift) & RADIX_MASK;
            let block_prefix = wg_localHist[digit];
            if (sid == 0u) {
                offsets[k] += block_prefix;
            } else {
                let subgroup_prefix = atomicLoad(&wg_subgroupHist[digit + sid * RADIX]);
                offsets[k] += block_prefix + subgroup_prefix;
            }
        }
    }
    workgroupBarrier();

    if (threadid.x < RADIX) {
        let pass_plane = shift >> 3u;
        let base_plane = pass_plane * info.thread_blocks * RADIX;
        let bin = threadid.x;
        let block_prefix = wg_localHist[bin];
        var prev_reduction = 0u;
        var lookbackid = partid;
        loop {
            let flag_payload = atomicLoad(&pass_hist[bin + base_plane + lookbackid * RADIX]);
            if ((flag_payload & FLAG_MASK) > FLAG_NOT_READY) {
                prev_reduction += flag_payload >> 2u;
                if ((flag_payload & FLAG_MASK) == FLAG_INCLUSIVE) {
                    if (partid < info.thread_blocks - 1u) {
                        let next_idx = bin + base_plane + (partid + 1u) * RADIX;
                        atomicStore(&pass_hist[next_idx], ((prev_reduction + local_reduction) << 2u) | FLAG_INCLUSIVE);
                    }
                    wg_localHist[bin] = prev_reduction - block_prefix;
                    break;
                } else {
                    lookbackid -= 1u;
                }
            }
        }
    }
    workgroupBarrier();

    for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
        if (keyValid[k]) {
            let digit = (keys[k] >> shift) & RADIX_MASK;
            let global_offset = wg_localHist[digit] + offsets[k];
            if (global_offset < info.size) {
                alt[global_offset] = keys[k];
                alt_payload[global_offset] = values[k];
            }
        }
    }
}
`;

export const oneSweep64Shader = `
//****************************************************************************
// GPUSorting
// OneSweep - WaveSize 64 variant
//
// SPDX-License-Identifier: MIT
// Copyright Thomas Smith 12/7/2024
// https://github.com/b0nes164/GPUSorting
//
// Modified for WGSL compatibility and variable subgroup sizes by Dino Metarapi, 2025
// Based on original work by Thomas Smith
//****************************************************************************

enable subgroups;

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupInclusiveAdd(x: u32) -> u32 { return subgroupInclusiveAdd(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupExclusiveAdd(x: u32) -> u32 { return subgroupExclusiveAdd(x); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupShuffle(x: u32, source: u32) -> u32 { return subgroupShuffle(x, source); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupBallot(pred: bool) -> vec4<u32> { return subgroupBallot(pred); }

@diagnostic(off, subgroup_uniformity)
fn unsafeSubgroupAdd(x: u32) -> u32 { return subgroupAdd(x); }

struct InfoStruct
{
    size: u32,
    shift: u32,
    thread_blocks: u32,
    seed: u32,
};

@group(0) @binding(0)
var<uniform> info : InfoStruct;

@group(0) @binding(1)
var<storage, read_write> bump: array<atomic<u32>>;

@group(0) @binding(2)
var<storage, read_write> sort: array<u32>;

@group(0) @binding(3)
var<storage, read_write> alt: array<u32>;

@group(0) @binding(4)
var<storage, read_write> payload: array<u32>;

@group(0) @binding(5)
var<storage, read_write> alt_payload: array<u32>;

@group(0) @binding(6)
var<storage, read_write> hist: array<atomic<u32>>;

@group(0) @binding(7)
var<storage, read_write> pass_hist: array<atomic<u32>>;

@group(0) @binding(8)
var<storage, read_write> status: array<u32>;

const SORT_PASSES = 4u;
const BLOCK_DIM = 256u;
const MIN_SUBGROUP_SIZE = 64u;
const MAX_REDUCE_SIZE = BLOCK_DIM / MIN_SUBGROUP_SIZE;

const STATUS_ERR_GLOBAL_HIST = 0u;
const STATUS_ERR_SCAN = 1u;
const STATUS_ERR_PASS = 2u;

const FLAG_NOT_READY = 0u;
const FLAG_REDUCTION = 1u;
const FLAG_INCLUSIVE = 2u;
const FLAG_MASK = 3u;

const RADIX = 256u;
const ALL_RADIX = RADIX * SORT_PASSES;
const RADIX_MASK = 255u;
const RADIX_LOG = 8u;

const KEYS_PER_THREAD = 15u;
const PART_SIZE = KEYS_PER_THREAD * BLOCK_DIM;

const REDUCE_BLOCK_DIM = 128u;
const REDUCE_KEYS_PER_THREAD = 30u;
const REDUCE_HIST_SIZE = REDUCE_BLOCK_DIM / MIN_SUBGROUP_SIZE * ALL_RADIX;
const REDUCE_PART_SIZE = REDUCE_KEYS_PER_THREAD * REDUCE_BLOCK_DIM;

const MAX_SUBGROUPS_PER_BLOCK = BLOCK_DIM / MIN_SUBGROUP_SIZE;
const WARP_HIST_CAPACITY = MAX_SUBGROUPS_PER_BLOCK * RADIX;

var<workgroup> wg_globalHist: array<atomic<u32>, REDUCE_HIST_SIZE>;

@compute @workgroup_size(REDUCE_BLOCK_DIM, 1, 1)
fn global_hist(
    @builtin(local_invocation_id) threadid: vec3<u32>,
    @builtin(subgroup_invocation_id) laneid: u32,
    @builtin(subgroup_size) lane_count: u32,
    @builtin(workgroup_id) wgid: vec3<u32>) {

    if (lane_count < MIN_SUBGROUP_SIZE || (REDUCE_BLOCK_DIM % lane_count) != 0u) {
        if (threadid.x == 0u) {
            status[STATUS_ERR_GLOBAL_HIST] = 0xDEAD0001u;
        }
        return;
    }

    let sid = threadid.x / lane_count;

    //Clear shared memory
    for (var i = threadid.x; i < REDUCE_HIST_SIZE; i += REDUCE_BLOCK_DIM) {
        atomicStore(&wg_globalHist[i], 0u);
    }
    workgroupBarrier();

    let radix_shift = info.shift;
    let hist_offset = sid * ALL_RADIX;
    {
        var i = threadid.x + wgid.x * REDUCE_PART_SIZE;
        if(wgid.x < info.thread_blocks - 1u) {
            for (var k = 0u; k < REDUCE_KEYS_PER_THREAD; k += 1u) {
                let key = sort[i];
                atomicAdd(&wg_globalHist[(key & RADIX_MASK) + hist_offset], 1u);
                atomicAdd(&wg_globalHist[((key >> 8u) & RADIX_MASK) + hist_offset + 256u], 1u);
                atomicAdd(&wg_globalHist[((key >> 16u) & RADIX_MASK) + hist_offset + 512u], 1u);
                atomicAdd(&wg_globalHist[((key >> 24u) & RADIX_MASK) + hist_offset + 768u], 1u);
                i += REDUCE_BLOCK_DIM;
            }
        }

        if(wgid.x == info.thread_blocks - 1u) {
            for (var k = 0u; k < REDUCE_KEYS_PER_THREAD; k += 1u) {
                if (i < info.size) {
                    let key = sort[i];
                    atomicAdd(&wg_globalHist[(key & RADIX_MASK) + hist_offset], 1u);
                    atomicAdd(&wg_globalHist[((key >> 8u) & RADIX_MASK) + hist_offset + 256u], 1u);
                    atomicAdd(&wg_globalHist[((key >> 16u) & RADIX_MASK) + hist_offset + 512u], 1u);
                    atomicAdd(&wg_globalHist[((key >> 24u) & RADIX_MASK) + hist_offset + 768u], 1u);
                }
                i += REDUCE_BLOCK_DIM;
            }
        }
    }
    workgroupBarrier();

    // Merge subgroup histograms
    let subgroup_histograms = REDUCE_BLOCK_DIM / lane_count;
    for(var i = threadid.x; i < RADIX; i += REDUCE_BLOCK_DIM) {
        var reduction0 = atomicLoad(&wg_globalHist[i]);
        var reduction1 = atomicLoad(&wg_globalHist[i + 256u]);
        var reduction2 = atomicLoad(&wg_globalHist[i + 512u]);
        var reduction3 = atomicLoad(&wg_globalHist[i + 768u]);

        for (var h = 1u; h < subgroup_histograms; h += 1u) {
            let idx = h * ALL_RADIX;
            reduction0 += atomicLoad(&wg_globalHist[i + idx]);
            reduction1 += atomicLoad(&wg_globalHist[i + 256u + idx]);
            reduction2 += atomicLoad(&wg_globalHist[i + 512u + idx]);
            reduction3 += atomicLoad(&wg_globalHist[i + 768u + idx]);
        }

        atomicAdd(&hist[i], reduction0);
        atomicAdd(&hist[i + 256u], reduction1);
        atomicAdd(&hist[i + 512u], reduction2);
        atomicAdd(&hist[i + 768u], reduction3);
    }
}

//Assumes block dim 256
const SCAN_MEM_SIZE = RADIX / MIN_SUBGROUP_SIZE;
var<workgroup> wg_scan: array<u32, SCAN_MEM_SIZE>;
@compute @workgroup_size(BLOCK_DIM, 1, 1)
fn onesweep_scan(
    @builtin(local_invocation_id) threadid: vec3<u32>,
    @builtin(subgroup_invocation_id) laneid: u32,
    @builtin(subgroup_size) lane_count: u32,
    @builtin(workgroup_id) wgid: vec3<u32>) {

    if (lane_count < MIN_SUBGROUP_SIZE || (BLOCK_DIM % lane_count) != 0u) {
        if (threadid.x == 0u) {
            status[STATUS_ERR_SCAN] = 0xDEAD0002u;
        }
        return;
    }

    let sid = threadid.x / lane_count;
    let pass_plane = info.shift >> 3u;
    let hist_index = threadid.x + pass_plane * RADIX;
    let scan = atomicLoad(&hist[hist_index]);
    let red = unsafeSubgroupAdd(scan);
    if(laneid == 0u){
        wg_scan[sid] = red;
    }
    workgroupBarrier();

    //Non-divergent subgroup agnostic inclusive scan across subgroup reductions
    {
        var offset0 = 0u;
        var offset1 = 0u;
        let lane_log = u32(countTrailingZeros(lane_count));
        let spine_size = BLOCK_DIM >> lane_log;
        let aligned_size = 1u << ((u32(countTrailingZeros(spine_size)) + lane_log - 1u) / lane_log * lane_log);
        for(var j = lane_count; j <= aligned_size; j <<= lane_log){
            let i0 = ((threadid.x + offset0) << offset1) - select(0u, 1u, j != lane_count);
            let pred0 = i0 < spine_size;
            let t0 = unsafeSubgroupInclusiveAdd(select(0u, wg_scan[i0], pred0));
            if(pred0){
                wg_scan[i0] = t0;
            }
            workgroupBarrier();

            if(j != lane_count){
                let rshift = j >> lane_log;
                let i1 = threadid.x + rshift;
                if ((i1 & (j - 1u)) >= rshift){
                    let pred1 = i1 < spine_size;
                    let t1 = select(0u, wg_scan[((i1 >> offset1) << offset1) - 1u], pred1);
                    if(pred1 && ((i1 + 1u) & (rshift - 1u)) != 0u){
                        wg_scan[i1] += t1;
                    }
                }
            } else {
                offset0 += 1u;
            }
            offset1 += lane_log;
        }
    }
    workgroupBarrier();

    if (wgid.x != 0u) {
        return;
    }

    let plane_stride = info.thread_blocks * RADIX;
    let pass_index = threadid.x + pass_plane * plane_stride;
    let subgroup_prefix = unsafeSubgroupExclusiveAdd(scan);
    var spine_prefix = 0u;
    if (sid > 0u) {
        spine_prefix = wg_scan[sid - 1u];
    }
    atomicStore(&pass_hist[pass_index], ((subgroup_prefix + spine_prefix) << 2u) | FLAG_INCLUSIVE);
}

var<workgroup> wg_subgroupHist: array<atomic<u32>, WARP_HIST_CAPACITY>;
var<workgroup> wg_localHist: array<u32, RADIX>;
var<workgroup> wg_broadcast: u32;

fn lowMask(bits: u32) -> u32 {
    if (bits == 0u) {
        return 0u;
    }
    if (bits >= 32u) {
        return 0xffffffffu;
    }
    return (1u << bits) - 1u;
}

fn laneMaskLessThan(laneid: u32) -> vec4<u32> {
    if (laneid >= 32u) {
        return vec4<u32>(0xffffffffu, lowMask(laneid - 32u), 0u, 0u);
    }
    return vec4<u32>(lowMask(laneid), 0u, 0u, 0u);
}

fn subgroupMaskForSize(size: u32) -> vec4<u32> {
    if (size <= 32u) {
        return vec4<u32>(lowMask(size), 0u, 0u, 0u);
    }
    return vec4<u32>(0xffffffffu, lowMask(size - 32u), 0u, 0u);
}

fn maskAnd(a: vec4<u32>, b: vec4<u32>) -> vec4<u32> {
    return vec4<u32>(a.x & b.x, a.y & b.y, 0u, 0u);
}

fn maskFilter(ballot: vec4<u32>, pred: bool) -> vec4<u32> {
    let keep = vec4<u32>(ballot.x, ballot.y, 0u, 0u);
    let reject = vec4<u32>(~ballot.x, ~ballot.y, 0u, 0u);
    let cond = vec4<bool>(pred, pred, pred, pred);
    return select(reject, keep, cond);
}

fn maskBitCount(mask: vec4<u32>) -> u32 {
    return countOneBits(mask.x) + countOneBits(mask.y);
}

fn maskHasBits(mask: vec4<u32>) -> bool {
    return (mask.x | mask.y) != 0u;
}

fn maskHighestLane(mask: vec4<u32>) -> u32 {
    if (mask.y != 0u) {
        return 32u + (31u - countLeadingZeros(mask.y));
    }
    return 31u - countLeadingZeros(mask.x);
}

fn WLMS(key: u32, shift: u32, laneid: u32, lane_count: u32, s_offset: u32, key_valid: bool) -> u32 {
    // FIX: Compute valid_mask FIRST to exclude invalid lanes from peer groups.
    // Without this, invalid lanes (key_valid=false) look like "bit=0" lanes during ballot,
    // allowing them to join peer groups with valid keys. If an invalid lane becomes
    // highest_rank_peer, the atomicAdd is skipped (gated by key_valid), causing missing
    // histogram increments → offset collisions → duplicates/missing elements.
    let valid_ballot = unsafeSubgroupBallot(key_valid);
    let valid_mask = vec4<u32>(valid_ballot.x, valid_ballot.y, 0u, 0u);

    var eq_mask = vec4<u32>(0xffffffffu, 0xffffffffu, 0u, 0u);
    for (var k = 0u; k < RADIX_LOG; k += 1u) {
        let curr_bit = 1u << (k + shift);
        let pred = key_valid && ((key & curr_bit) != 0u);
        let ballot = unsafeSubgroupBallot(pred);
        eq_mask = maskAnd(eq_mask, maskFilter(ballot, pred));
    }

    // Remove invalid lanes from the peer group (critical fix for partial last partitions)
    eq_mask = maskAnd(eq_mask, valid_mask);

    if (!key_valid) {
        eq_mask = vec4<u32>(0u);
    }
    eq_mask = maskAnd(eq_mask, subgroupMaskForSize(lane_count));
    let lane_mask_lt = laneMaskLessThan(laneid);
    var out = maskBitCount(maskAnd(eq_mask, lane_mask_lt));
    let has_peers = maskHasBits(eq_mask);
    let highest_rank_peer = select(lane_count - 1u, maskHighestLane(eq_mask), has_peers);
    var pre_inc = 0u;
    if (key_valid && has_peers && laneid == highest_rank_peer) {
        pre_inc = atomicAdd(&wg_subgroupHist[((key >> shift) & RADIX_MASK) + s_offset], out + 1u);
    }
    workgroupBarrier();
    // Call shuffle unconditionally to maintain uniform control flow across subgroup.
    // Divergent subgroup ops (when some lanes skip due to keyValid=false) cause undefined behavior.
    let bcast = unsafeSubgroupShuffle(pre_inc, highest_rank_peer);
    // Only apply it for real keys / real peer groups
    out += select(0u, bcast, has_peers);
    return select(0u, out, key_valid);
}

fn fake_wlms(key: u32, shift: u32, laneid: u32, lane_count: u32, s_offset: u32) -> u32 {
    return 0u;
}

@compute @workgroup_size(BLOCK_DIM, 1, 1)
fn onesweep_pass(
    @builtin(local_invocation_id) threadid: vec3<u32>,
    @builtin(subgroup_invocation_id) laneid: u32,
    @builtin(subgroup_size) lane_count: u32) {

    let shift = info.shift;
    let sid = threadid.x / lane_count;

    let subgroup_hist_size = (BLOCK_DIM / lane_count) * RADIX;
    if (subgroup_hist_size > WARP_HIST_CAPACITY) {
        if (threadid.x == 0u) {
            status[STATUS_ERR_PASS] = 0xDEAD0004u;
        }
        return;
    }

    for (var i = threadid.x; i < subgroup_hist_size; i += BLOCK_DIM) {
        atomicStore(&wg_subgroupHist[i], 0u);
    }
    workgroupBarrier();

    if (threadid.x == 0u) {
        wg_broadcast = atomicAdd(&bump[shift >> 3u], 1u);
    }
    // Explicit barrier to ensure wg_broadcast is visible to all threads
    workgroupBarrier();
    let partid = wg_broadcast;

    var keys = array<u32, KEYS_PER_THREAD>();
    var values = array<u32, KEYS_PER_THREAD>();
    var keyValid = array<bool, KEYS_PER_THREAD>();
    {
        let dev_offset = partid * PART_SIZE;
        let lane_stride = sid * lane_count * KEYS_PER_THREAD;
        var idx = laneid + lane_stride + dev_offset;
        if (partid < info.thread_blocks - 1u) {
            for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
                keys[k] = sort[idx];
                values[k] = payload[idx];
                keyValid[k] = true;
                idx += lane_count;
            }
        } else {
            for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
                if (idx < info.size) {
                    keys[k] = sort[idx];
                    values[k] = payload[idx];
                    keyValid[k] = true;
                } else {
                    keys[k] = 0xffffffffu;
                    values[k] = 0xffffffffu;
                    keyValid[k] = false;
                }
                idx += lane_count;
            }
        }
    }

    var offsets = array<u32, KEYS_PER_THREAD>();
    {
        let hist_offset = sid * RADIX;
        for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
            offsets[k] = WLMS(keys[k], shift, laneid, lane_count, hist_offset, keyValid[k]);
        }
    }
    workgroupBarrier();

    var local_reduction = 0u;
    if (threadid.x < RADIX) {
        local_reduction = atomicLoad(&wg_subgroupHist[threadid.x]);
        var subtotal = local_reduction;
        for (var i = threadid.x + RADIX; i < subgroup_hist_size; i += RADIX) {
            let current = atomicLoad(&wg_subgroupHist[i]);
            atomicStore(&wg_subgroupHist[i], subtotal);
            subtotal += current;
        }
        local_reduction = subtotal;

        if (partid < info.thread_blocks - 1u) {
            let pass_plane = shift >> 3u;
            let pass_index = threadid.x + pass_plane * info.thread_blocks * RADIX + (partid + 1u) * RADIX;
            atomicStore(&pass_hist[pass_index], (local_reduction << 2u) | FLAG_REDUCTION);
        }

        let lane_mask = lane_count - 1u;
        let circular_lane_shift = (laneid + lane_mask) & lane_mask;
        let t = unsafeSubgroupInclusiveAdd(local_reduction);
        wg_localHist[threadid.x] = unsafeSubgroupShuffle(t, circular_lane_shift);
    }
    workgroupBarrier();

    if (threadid.x < lane_count) {
        let pred = threadid.x < RADIX / lane_count;
        let t = unsafeSubgroupExclusiveAdd(select(0u, wg_localHist[threadid.x * lane_count], pred));
        if (pred) {
            wg_localHist[threadid.x * lane_count] = t;
        }
    }
    workgroupBarrier();

    if (threadid.x < RADIX && laneid != 0u) {
        wg_localHist[threadid.x] += wg_localHist[(threadid.x / lane_count) * lane_count];
    }
    workgroupBarrier();

    for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
        if (keyValid[k]) {
            let digit = (keys[k] >> shift) & RADIX_MASK;
            let block_prefix = wg_localHist[digit];
            if (sid == 0u) {
                offsets[k] += block_prefix;
            } else {
                let subgroup_prefix = atomicLoad(&wg_subgroupHist[digit + sid * RADIX]);
                offsets[k] += block_prefix + subgroup_prefix;
            }
        }
    }
    workgroupBarrier();

    if (threadid.x < RADIX) {
        let pass_plane = shift >> 3u;
        let base_plane = pass_plane * info.thread_blocks * RADIX;
        let bin = threadid.x;
        let block_prefix = wg_localHist[bin];
        var prev_reduction = 0u;
        var lookbackid = partid;
        loop {
            let flag_payload = atomicLoad(&pass_hist[bin + base_plane + lookbackid * RADIX]);
            if ((flag_payload & FLAG_MASK) > FLAG_NOT_READY) {
                prev_reduction += flag_payload >> 2u;
                if ((flag_payload & FLAG_MASK) == FLAG_INCLUSIVE) {
                    if (partid < info.thread_blocks - 1u) {
                        let next_idx = bin + base_plane + (partid + 1u) * RADIX;
                        atomicStore(&pass_hist[next_idx], ((prev_reduction + local_reduction) << 2u) | FLAG_INCLUSIVE);
                    }
                    wg_localHist[bin] = prev_reduction - block_prefix;
                    break;
                } else {
                    lookbackid -= 1u;
                }
            }
        }
    }
    workgroupBarrier();

    for (var k = 0u; k < KEYS_PER_THREAD; k += 1u) {
        if (keyValid[k]) {
            let digit = (keys[k] >> shift) & RADIX_MASK;
            let global_offset = wg_localHist[digit] + offsets[k];
            if (global_offset < info.size) {
                alt[global_offset] = keys[k];
                alt_payload[global_offset] = values[k];
            }
        }
    }
}
`;

export const subgroupDetectShader = `
enable subgroups;

@group(0) @binding(0)
var<storage, read_write> outSize : array<u32, 1>;

@compute @workgroup_size(1)
fn main(@builtin(subgroup_size) subgroupSize : u32) {
    outSize[0] = subgroupSize;
}
`;
