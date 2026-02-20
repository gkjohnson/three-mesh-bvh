/**
 * Flatten shader: Converts H-PLOC BVH2 format to traversal-compatible layout.
 *
 * H-PLOC produces nodes with absolute child indices.
 * Traversal expects: left child at index+1, right child as relative offset.
 *
 * This shader performs a sequential two-pass DFS:
 * 1) Compute subtree sizes.
 * 2) Emit nodes in pre-order with correct relative offsets.
 */

export const flattenShader = /* wgsl */ `

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

// Output format matching three-mesh-bvh WebGPU traversal
struct BVHNode {
	boundsMinX: f32,
	boundsMinY: f32,
	boundsMinZ: f32,
	boundsMaxX: f32,
	boundsMaxY: f32,
	boundsMaxZ: f32,
	rightChildOrTriangleOffset: u32,
	splitAxisOrTriangleCount: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> bvh2Nodes: array<BVH2Node>;
@group(0) @binding(2) var<storage, read_write> clusterIdx: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read> nodeCounter: u32;
@group(0) @binding(4) var<storage, read_write> subtreeSizes: array<u32>;
@group(0) @binding(5) var<storage, read_write> stackNodes: array<u32>;
@group(0) @binding(6) var<storage, read_write> stackOut: array<u32>;
@group(0) @binding(7) var<storage, read_write> outputNodes: array<BVHNode>;

const INVALID_IDX: u32 = 0xFFFFFFFFu;
const LEAF_FLAG: u32 = 0xFFFF0000u;

// Check if node is a leaf
fn isLeaf(node: BVH2Node) -> bool {
	return node.leftChild == INVALID_IDX;
}

// Compute split axis from child bounds (simplified: use largest extent axis)
fn computeSplitAxis(node: BVH2Node) -> u32 {
	let extent = node.boundsMax - node.boundsMin;

	if (extent.x >= extent.y && extent.x >= extent.z) {
		return 0u;
	} else if (extent.y >= extent.z) {
		return 1u;
	} else {
		return 2u;
	}
}

@compute @workgroup_size(1)
fn computeSubtreeSizes(
	@builtin(global_invocation_id) globalId: vec3u
) {
	if (globalId.x != 0u) {
		return;
	}

	if (nodeCounter == 0u) {
		return;
	}

	let rootIdx = atomicLoad(&clusterIdx[0]);
	var sp: i32 = 0;

	stackNodes[0] = rootIdx;
	stackOut[0] = 0u; // state: 0 = first visit, 1 = post-visit

	loop {
		if (sp < 0) {
			break;
		}

		let nodeIdx = stackNodes[u32(sp)];
		let state = stackOut[u32(sp)];
		sp = sp - 1;

		let node = bvh2Nodes[nodeIdx];
		if (state == 0u) {
			if (isLeaf(node)) {
				subtreeSizes[nodeIdx] = 1u;
				continue;
			}

			sp = sp + 1;
			stackNodes[u32(sp)] = nodeIdx;
			stackOut[u32(sp)] = 1u;

			sp = sp + 1;
			stackNodes[u32(sp)] = node.rightChild;
			stackOut[u32(sp)] = 0u;

			sp = sp + 1;
			stackNodes[u32(sp)] = node.leftChild;
			stackOut[u32(sp)] = 0u;
		} else {
			let leftSize = subtreeSizes[node.leftChild];
			let rightSize = subtreeSizes[node.rightChild];
			subtreeSizes[nodeIdx] = 1u + leftSize + rightSize;
		}
	}
}

@compute @workgroup_size(1)
fn flattenTree(
	@builtin(global_invocation_id) globalId: vec3u
) {
	if (globalId.x != 0u) {
		return;
	}

	if (nodeCounter == 0u) {
		return;
	}

	let rootIdx = atomicLoad(&clusterIdx[0]);
	var sp: i32 = 0;

	stackNodes[0] = rootIdx;
	stackOut[0] = 0u;

	loop {
		if (sp < 0) {
			break;
		}

		let nodeIdx = stackNodes[u32(sp)];
		let outIdx = stackOut[u32(sp)];
		sp = sp - 1;

		let srcNode = bvh2Nodes[nodeIdx];
		var dstNode: BVHNode;

		// Copy bounds
		dstNode.boundsMinX = srcNode.boundsMin.x;
		dstNode.boundsMinY = srcNode.boundsMin.y;
		dstNode.boundsMinZ = srcNode.boundsMin.z;
		dstNode.boundsMaxX = srcNode.boundsMax.x;
		dstNode.boundsMaxY = srcNode.boundsMax.y;
		dstNode.boundsMaxZ = srcNode.boundsMax.z;

		if (isLeaf(srcNode)) {
			dstNode.rightChildOrTriangleOffset = srcNode.rightChild;
			dstNode.splitAxisOrTriangleCount = LEAF_FLAG | 1u;
		} else {
			let leftChild = srcNode.leftChild;
			let rightChild = srcNode.rightChild;

			let leftOutIdx = outIdx + 1u;
			let rightOutIdx = outIdx + 1u + subtreeSizes[leftChild];
			let relativeOffset = rightOutIdx - outIdx;

			dstNode.rightChildOrTriangleOffset = relativeOffset;
			dstNode.splitAxisOrTriangleCount = computeSplitAxis(srcNode);

			// Push right then left so left is processed first
			sp = sp + 1;
			stackNodes[u32(sp)] = rightChild;
			stackOut[u32(sp)] = rightOutIdx;

			sp = sp + 1;
			stackNodes[u32(sp)] = leftChild;
			stackOut[u32(sp)] = leftOutIdx;
		}

		outputNodes[outIdx] = dstNode;
	}
}
`;
