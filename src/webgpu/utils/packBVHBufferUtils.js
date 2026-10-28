/** @import { StructTypeNode } from 'three/webgpu' */
/** @import { BVHComputeData } from '../BVHComputeData.js' */
import { Vector4 } from 'three';
import { BYTES_PER_NODE, UINT32_PER_NODE, IS_LEAFNODE_FLAG } from '../../core/Constants.js';
import { IS_LEAF, LEFT_NODE, RIGHT_NODE } from '../../core/utils/nodeBufferUtils.js';

// the GPU node: both children's bounds, then the right child offset or triangle offset, then the
// split axis or leaf count, padded to 64 bytes
export const GPU_BYTES_PER_NODE = 64;
export const GPU_UINT32_PER_NODE = GPU_BYTES_PER_NODE / 4;

// scratch
const _def = /* @__PURE__ */ new Vector4();
const _vec = /* @__PURE__ */ new Vector4();

// writes the bounds of a source node into "target" at float offset "t32", turning the
// [ Infinity, - Infinity ] bounds of an empty leaf into [ 1, - 1 ] so the GPU never enters it
function writeBounds( rootF32, srcNode, targetF32, t32 ) {

	const r32 = srcNode * UINT32_PER_NODE;
	for ( let c = 0; c < 3; c ++ ) {

		const vMin = rootF32[ r32 + c ];
		const vMax = rootF32[ r32 + c + 3 ];
		if ( vMin > vMax ) {

			targetF32[ t32 + c ] = 1;
			targetF32[ t32 + c + 3 ] = - 1;

		} else {

			targetF32[ t32 + c ] = vMin;
			targetF32[ t32 + c + 3 ] = vMax;

		}

	}

}

// writes both children's bounds of an internal source node into the GPU node at "n32"
function writeChildBounds( rootF32, rootU32, srcNode, targetF32, n32 ) {

	const r32 = srcNode * UINT32_PER_NODE;
	writeBounds( rootF32, srcNode + 1, targetF32, n32 );
	writeBounds( rootF32, srcNode + rootU32[ r32 + 6 ], targetF32, n32 + 6 );

}

// resolve an indirect buffer into a flat triangle index array
function dereferenceIndex( indexAttr, indirectBuffer ) {

	const indexArray = indexAttr ? indexAttr.array : null;
	const result = new Uint32Array( indirectBuffer.length * 3 );
	for ( let i = 0, l = indirectBuffer.length; i < l; i ++ ) {

		const i3 = 3 * i;
		const v3 = 3 * indirectBuffer[ i ];
		for ( let c = 0; c < 3; c ++ ) {

			result[ i3 + c ] = indexArray ? indexArray[ v3 + c ] : v3 + c;

		}

	}

	return result;

}

/**
 * Copies the packed nodes of the TLAS into the shared node buffer, encoding each leaf as a TLAS leaf
 * (`0xFF00` tag) from its `primitiveInfo` entry.
 *
 * @private
 * @param {Object} bvh
 * @param {Array|null} primitiveInfo - Per-primitive `{ transformSlot, nodeOffset }` used to encode TLAS
 * leaves. Pass null to write only the node bounds and leave the existing node data in place, as when
 * refreshing a refit tree whose topology is unchanged.
 * @param {number} nodeWriteOffset
 * @param {ArrayBuffer} target
 */
export function appendBVHData( bvh, primitiveInfo, nodeWriteOffset, target ) {

	const targetU32 = new Uint32Array( target );
	const targetF32 = new Float32Array( target );

	bvh._roots.forEach( root => {

		const rootBuffer16 = new Uint16Array( root );
		const rootBuffer32 = new Uint32Array( root );
		const rootBufferF32 = new Float32Array( root );
		for ( let i = 0, l = root.byteLength / BYTES_PER_NODE; i < l; i ++ ) {

			const r32 = i * UINT32_PER_NODE;
			const r16 = r32 * 2;
			const n32 = nodeWriteOffset * GPU_UINT32_PER_NODE;
			const isLeaf = IS_LEAF( r16, rootBuffer16 );

			// write the children's bounds - a leaf's bounds are held by its parent
			if ( ! isLeaf ) {

				writeChildBounds( rootBufferF32, rootBuffer32, i, targetF32, n32 );

			}

			// a refit only moves bounds, so the node data written on the first pass remains valid
			if ( primitiveInfo === null ) {

				nodeWriteOffset ++;
				continue;

			}

			if ( isLeaf ) {

				// TLAS leaf - stores the placement / transform slot (low 24 bits, tagged with
				// 0xFF in the top byte) and the cluster subtree's absolute node offset, which the
				// GPU enters directly as the BLAS entry node.
				const offset = rootBuffer32[ r32 + 6 ];
				const count = rootBuffer16[ r16 + 14 ];

				// an empty bvh produces a single primitiveless leaf with no primitiveInfo entry; its
				// degenerate bounds keep the GPU from traversing into it, so write an empty placeholder.
				const { transformSlot, nodeOffset } = count === 0 ? { transformSlot: 0, nodeOffset: 0 } : primitiveInfo[ offset ];
				if ( transformSlot > 0x00ffffff ) {

					throw new Error( `packBVHBufferUtils: transform slot ${ transformSlot } exceeds the 24-bit TLAS leaf limit.` );

				}

				targetU32[ n32 + 12 ] = nodeOffset;
				targetU32[ n32 + 13 ] = 0xFF000000 | ( transformSlot & 0x00ffffff );

			} else {

				targetU32[ n32 + 12 ] = rootBuffer32[ r32 + 6 ];
				targetU32[ n32 + 13 ] = rootBuffer32[ r32 + 7 ];

			}

			nodeWriteOffset ++;

		}

	} );

}

/**
 * Counts the nodes in the contiguous (depth-first) subtree rooted at "nodeIndex". A subtree's node
 * count is `rightOffset + subtreeSize(rightChild)`, unwinding down the right spine.
 *
 * @private
 * @param {ArrayBuffer} root - A single BVH root's packed node buffer.
 * @param {number} nodeIndex - Node index (in node units) of the subtree root.
 * @returns {number}
 */
export function getSubtreeNodeCount( root, nodeIndex ) {

	return spanOf( new Uint16Array( root ), new Uint32Array( root ), nodeIndex );

}

// exact contiguous span ( node count ) of the subtree rooted at "nodeIndex"
function spanOf( rootBuffer16, rootBuffer32, nodeIndex ) {

	const isLeaf = IS_LEAF( nodeIndex * UINT32_PER_NODE * 2, rootBuffer16 );
	if ( isLeaf ) {

		return 1;

	}

	const rightOffset = rootBuffer32[ nodeIndex * UINT32_PER_NODE + 6 ];
	return rightOffset + spanOf( rootBuffer16, rootBuffer32, nodeIndex + rightOffset );

}

/**
 * Returns the number of nodes along the deepest root-to-leaf path of the subtree rooted at
 * node index "start". A lone leaf has a depth of 1.
 *
 * @private
 * @param {ArrayBuffer} root - A single BVH root's packed node buffer.
 * @param {number} start - Node index of the subtree root.
 * @returns {number}
 */
export function getMaxNodeDepth( root, start = 0 ) {

	const rootBuffer16 = new Uint16Array( root );
	const rootBuffer32 = new Uint32Array( root );
	let maxDepth = 0;

	traverse( start * UINT32_PER_NODE, 1 );
	return maxDepth;

	function traverse( node, depth ) {

		const n32 = node;
		const n16 = node * 2;
		const isLeaf = IS_LEAF( n16, rootBuffer16 );
		if ( isLeaf ) {

			maxDepth = Math.max( depth, maxDepth );

		} else {

			const right = RIGHT_NODE( n32, rootBuffer32 );
			const left = LEFT_NODE( n32 );
			traverse( left, depth + 1 );
			traverse( right, depth + 1 );

		}

	}

}

/**
 * Copies a single contiguous subtree (`[ subtreeStart, subtreeStart + subtreeSize )`) of a BVH root
 * into the shared node buffer, rebasing leaf triangle offsets by "geometryOffset". Internal nodes'
 * child offsets are relative and so remain valid on the contiguous copy.
 *
 * @private
 * @param {ArrayBuffer} root - The BVH root's packed node buffer.
 * @param {number} subtreeStart - Node index of the subtree root.
 * @param {number} subtreeSize - Number of nodes in the subtree.
 * @param {number} geometryOffset - Triangle base added to leaf offsets.
 * @param {number} nodeWriteOffset - Node index in "target" to write the subtree root to.
 * @param {ArrayBuffer} target
 */
export function appendBVHSubtree( root, subtreeStart, subtreeSize, geometryOffset, nodeWriteOffset, target ) {

	const targetU16 = new Uint16Array( target );
	const targetU32 = new Uint32Array( target );
	const targetF32 = new Float32Array( target );
	const rootBuffer16 = new Uint16Array( root );
	const rootBuffer32 = new Uint32Array( root );
	const rootBufferF32 = new Float32Array( root );

	for ( let k = 0; k < subtreeSize; k ++ ) {

		const src = subtreeStart + k;
		const r32 = src * UINT32_PER_NODE;
		const r16 = r32 * 2;
		const n32 = nodeWriteOffset * GPU_UINT32_PER_NODE;
		const n16 = n32 * 2;

		const isLeaf = IS_LEAF( r16, rootBuffer16 );
		if ( isLeaf ) {

			// mesh leaf ( 0xFFFF ) - rebase the triangle offset into the packed index buffer
			targetU32[ n32 + 12 ] = rootBuffer32[ r32 + 6 ] + geometryOffset;
			targetU16[ n16 + 26 ] = rootBuffer16[ r16 + 14 ];
			targetU16[ n16 + 27 ] = IS_LEAFNODE_FLAG;

		} else {

			// internal node - the children's bounds are stored here and the right-child offset is
			// relative, so it is valid as-is on the copy
			writeChildBounds( rootBufferF32, rootBuffer32, src, targetF32, n32 );
			targetU32[ n32 + 12 ] = rootBuffer32[ r32 + 6 ];
			targetU32[ n32 + 13 ] = rootBuffer32[ r32 + 7 ];

		}

		nodeWriteOffset ++;

	}

}

/**
 * Writes the triangle index data for a BVH's geometry into the shared index buffer, rebasing the
 * indices into the packed attribute buffer.
 *
 * @private
 * @param {Object} bvh
 * @param {{start:number,count:number,vertexStart:number}} range
 * @param {number} valueOffset
 * @param {number} writeOffset
 * @param {Uint32Array} target
 */
export function appendIndexData( bvh, range, valueOffset, writeOffset, target ) {

	const { geometry } = bvh;
	const { start, count, vertexStart } = range;
	if ( bvh.indirect ) {

		const dereferencedIndex = dereferenceIndex( geometry.index, bvh._indirectBuffer );
		for ( let i = 0; i < dereferencedIndex.length; i ++ ) {

			target[ i + writeOffset ] = dereferencedIndex[ i ] - vertexStart + valueOffset;

		}

	} else if ( geometry.index ) {

		for ( let i = 0; i < count; i ++ ) {

			target[ i + writeOffset ] = geometry.index.getX( i + start ) - vertexStart + valueOffset;

		}

	} else {

		for ( let i = 0; i < count; i ++ ) {

			target[ i + writeOffset ] = i + start + valueOffset;

		}

	}

}

/**
 * Writes a BVH's interleaved per-vertex attributes into the shared attribute buffer, filling missing
 * attributes with their defaults and applying bone transforms for skinned meshes.
 *
 * @private
 * @param {Object} bvh
 * @param {{vertexStart:number,vertexCount:number}} range
 * @param {number} writeOffset
 * @param {ArrayBuffer} target
 * @param {StructTypeNode} attributeStruct
 * @param {BVHComputeData} bvhData - Provides per-attribute defaults via `getDefaultAttributeValue`.
 */
export function appendGeometryData( bvh, range, writeOffset, target, attributeStruct, bvhData ) {

	// if "mesh" is present then it is assumed to be a SkinnedMeshBVH
	const { geometry, mesh = null } = bvh;
	const { vertexStart, vertexCount } = range;
	const attributesBufferF32 = new Float32Array( target );
	const attrStructLength = attributeStruct.getLength();
	attributeStruct.membersLayout.forEach( ( { name }, interleavedOffset ) => {

		// TODO: we should be able to have access to memory layout offsets here via the struct
		// API but it's not currently available.
		const attr = geometry.attributes[ name ];
		bvhData.getDefaultAttributeValue( name, _def );

		for ( let i = 0; i < vertexCount; i ++ ) {

			if ( attr ) {

				_vec.fromBufferAttribute( attr, i + vertexStart );

				switch ( attr.itemSize ) {

					case 1:
						_vec.y = _def.y;
						_vec.z = _def.z;
						_vec.w = _def.w;
						break;
					case 2:
						_vec.z = _def.z;
						_vec.w = _def.w;
						break;
					case 3:
						_vec.w = _def.w;
						break;

				}

				if ( mesh && ( name === 'position' || name === 'normal' || name === 'tangent' ) ) {

					mesh.applyBoneTransform( i + vertexStart, _vec );

				}

			} else {

				_vec.copy( _def );

			}

			_vec.toArray( attributesBufferF32, ( writeOffset + i ) * attrStructLength + interleavedOffset * 4 );

		}

	} );

}
