/** @import { StructTypeNode } from 'three/webgpu' */
/** @import { BVHComputeData } from '../BVHComputeData.js' */
import { Vector4 } from 'three';
import { BYTES_PER_NODE, UINT32_PER_NODE, IS_LEAFNODE_FLAG } from '../../core/Constants.js';

// marks a composite primitive as an object / instance rather than a triangle
const OBJECT_PRIMITIVE_FLAG = 0xffffffff;

// top-level composite leaf type tags ( the high byte of "splitAxisOrTriangleCount" )
const TRIANGLE_LEAF_TAG = 0xFE;
const OBJECT_LEAF_TAG = 0xFF;

// scratch
const _def = /* @__PURE__ */ new Vector4();
const _vec = /* @__PURE__ */ new Vector4();

// copy a node's min / max bounds into the target buffer, fixing up empty [ Inf, -Inf ] bounds
function writeNodeBounds( root, i, targetF32, n32 ) {

	const view = new Float32Array( root, i * BYTES_PER_NODE, 6 );
	if ( i === 0 ) {

		// the root may have empty bounds when there are no primitives - convert [ Inf, -Inf ] to
		// [ 1, -1 ] for reliable GPU behavior.
		for ( let c = 0; c < 3; c ++ ) {

			const vMin = view[ c + 0 ];
			const vMax = view[ c + 3 ];
			if ( vMin > vMax ) {

				targetF32[ n32 + c + 0 ] = 1;
				targetF32[ n32 + c + 3 ] = - 1;

			} else {

				targetF32[ n32 + c + 0 ] = vMin;
				targetF32[ n32 + c + 3 ] = vMax;

			}

		}

	} else {

		targetF32.set( view, n32 );

	}

}

/**
 * Copies a BVH's packed nodes into the node buffer starting at `nodeWriteOffset`. Bounds and
 * internal nodes are copied as-is; each leaf's payload is written by `writeLeaf`. Returns the write
 * offset of each root.
 *
 * @private
 * @param {Object} bvh
 * @param {number} nodeWriteOffset
 * @param {ArrayBuffer} target
 * @param {( targetU16: Uint16Array, targetU32: Uint32Array, primitiveOffset: number, count: number, n16: number, n32: number ) => void} writeLeaf
 * @returns {Array<number>}
 */
function appendNodes( bvh, nodeWriteOffset, target, writeLeaf ) {

	const targetU16 = new Uint16Array( target );
	const targetU32 = new Uint32Array( target );
	const targetF32 = new Float32Array( target );

	const result = [];
	bvh._roots.forEach( root => {

		const rootBuffer16 = new Uint16Array( root );
		const rootBuffer32 = new Uint32Array( root );
		result.push( nodeWriteOffset );
		for ( let i = 0, l = root.byteLength / BYTES_PER_NODE; i < l; i ++ ) {

			const r32 = i * UINT32_PER_NODE;
			const r16 = r32 * 2;
			const n32 = nodeWriteOffset * UINT32_PER_NODE;
			const n16 = n32 * 2;

			writeNodeBounds( root, i, targetF32, n32 );

			if ( IS_LEAFNODE_FLAG === rootBuffer16[ r16 + 15 ] ) {

				writeLeaf( targetU16, targetU32, rootBuffer32[ r32 + 6 ], rootBuffer16[ r16 + 14 ], n16, n32 );

			} else {

				// internal node - the tree is copied 1:1 so the relative child offset stays valid
				targetU32[ n32 + 6 ] = rootBuffer32[ r32 + 6 ];
				targetU32[ n32 + 7 ] = rootBuffer32[ r32 + 7 ];

			}

			nodeWriteOffset ++;

		}

	} );

	return result;

}

/**
 * Copies the single-level composite top-level tree into the node buffer at offset 0, encoding each
 * leaf as a triangle leaf ( `splitAxisOrTriangleCount = [ 0xFE | objectIndex:16 | count:8 ]`,
 * `rightChildOrTriangleOffset = triangle offset` ) or an object leaf ( `[ 0xFF00 | count:16 ]`,
 * `rightChildOrTriangleOffset = transform range start` ).
 *
 * @private
 * @param {Object} bvh - The CompositeBVH ( single root ).
 * @param {Uint32Array} primitiveBuffer
 * @param {number} stride - The primitive buffer stride ( 1 or 2 ).
 * @param {number} idMask - The BVH's object id mask, to recover an object index from a composite id.
 * @param {Array} transformInfo - The transform entries ( used to expand object leaves by root, as in the TLAS ).
 * @param {Array<number>} objectTransformSlot - object index -> transform slot, for triangle leaves.
 * @param {ArrayBuffer} target
 */
export function appendCompositeNodes( bvh, primitiveBuffer, stride, idMask, transformInfo, objectTransformSlot, target ) {

	// running transform index for object leaves - the object transforms occupy the first slots, in
	// primitive order, so object leaves are encountered in the same order they were written.
	let tlasOffset = 0;
	appendNodes( bvh, 0, target, ( targetU16, targetU32, primitiveOffset, count, n16, n32 ) => {

		const word1 = stride === 2 ? primitiveBuffer[ primitiveOffset * stride + 1 ] : OBJECT_PRIMITIVE_FLAG;

		if ( word1 !== OBJECT_PRIMITIVE_FLAG ) {

			// triangle leaf - all triangles belong to one object ( the leaf's first primitive's word0 )
			const objectIndex = objectTransformSlot[ primitiveBuffer[ primitiveOffset * stride ] & idMask ];
			targetU32[ n32 + 6 ] = primitiveOffset;
			targetU32[ n32 + 7 ] = ( TRIANGLE_LEAF_TAG << 24 ) | ( ( objectIndex & 0xffff ) << 8 ) | ( count & 0xff );

		} else {

			// object leaf - expand each object primitive into its BLAS roots ( the original TLAS encoding )
			targetU32[ n32 + 6 ] = tlasOffset;
			targetU16[ n16 + 15 ] = OBJECT_LEAF_TAG << 8;

			let rootsCount = 0;
			for ( let o = 0; o < count; o ++ ) {

				const roots = transformInfo[ tlasOffset ].data.bvh._roots.length;
				tlasOffset += roots;
				rootsCount += roots;

			}

			targetU16[ n16 + 14 ] = rootsCount;

		}

	} );

}

// writes the three vertex indices of a triangle ( rebased into the packed attribute buffer ) into
// the index buffer at the given offset
export function writeTriangleIndices( geometry, triangleIndex, vertexStart, target, writeOffset ) {

	const index = geometry.index;
	const i3 = triangleIndex * 3;
	for ( let k = 0; k < 3; k ++ ) {

		const vi = index ? index.getX( i3 + k ) : i3 + k;
		target[ writeOffset + k ] = vi + vertexStart;

	}

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
 * Copies a geometry BVH's packed nodes ( a BLAS subtree ) into the node buffer, rebasing each leaf's
 * triangle offset by `geometryOffset` and tagging it as a mesh leaf ( `0xFFFF` ). Returns the write
 * offset of each root.
 *
 * @private
 * @param {Object} bvh
 * @param {number} geometryOffset
 * @param {number} nodeWriteOffset
 * @param {ArrayBuffer} target
 * @returns {Array<number>}
 */
export function appendBVHData( bvh, geometryOffset, nodeWriteOffset, target ) {

	return appendNodes( bvh, nodeWriteOffset, target, ( targetU16, targetU32, triangleOffset, count, n16, n32 ) => {

		targetU32[ n32 + 6 ] = triangleOffset + geometryOffset;
		targetU16[ n16 + 14 ] = count;
		targetU16[ n16 + 15 ] = IS_LEAFNODE_FLAG;

	} );

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
