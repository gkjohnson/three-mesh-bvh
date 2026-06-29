/** @import { StructTypeNode } from 'three/webgpu' */
/** @import { BVHComputeData } from '../BVHComputeData.js' */
import { Vector4 } from 'three';
import { BYTES_PER_NODE, UINT32_PER_NODE, IS_LEAFNODE_FLAG } from '../../core/Constants.js';

// scratch
const _def = /* @__PURE__ */ new Vector4();
const _vec = /* @__PURE__ */ new Vector4();

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
 * Copies the packed nodes of a BVH into the shared node buffer, rewriting leaf offsets / counts and
 * tagging leaves as mesh (`0xFFFF`) or TLAS (`0xFF00`) leaves. Returns the write offset of each root.
 *
 * @private
 * @param {Object} bvh
 * @param {number} geometryOffset
 * @param {Array|null} primitiveInfo - Per-primitive `{ transformSlot, nodeOffset }` used to encode TLAS leaves; `null` for BLAS data.
 * @param {number} nodeWriteOffset
 * @param {ArrayBuffer} target
 * @param {boolean} [tlas=false]
 * @returns {Array<number>}
 */
export function appendBVHData( bvh, geometryOffset, primitiveInfo, nodeWriteOffset, target, tlas = false ) {

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

			// write bounds
			const view = new Float32Array( root, i * BYTES_PER_NODE, 6 );
			if ( i === 0 ) {

				// if we're copying the root then check for cases where there are no primitives and therefore
				// be a bounds of [ Infinity, - Infinity ]. Convert this to [ 1, - 1 ] for reliable GPU behavior.
				for ( let i = 0; i < 3; i ++ ) {

					const vMin = view[ i + 0 ];
					const vMax = view[ i + 3 ];
					if ( vMin > vMax ) {

						targetF32[ n32 + i + 0 ] = 1;
						targetF32[ n32 + i + 3 ] = - 1;

					} else {

						targetF32[ n32 + i + 0 ] = vMin;
						targetF32[ n32 + i + 3 ] = vMax;

					}

				}

			} else {

				targetF32.set( view, n32 );

			}

			const isLeaf = IS_LEAFNODE_FLAG === rootBuffer16[ r16 + 15 ];
			if ( isLeaf ) {

				if ( tlas ) {

					// TLAS leaf - stores the placement / transform slot ( low 24 bits, tagged with
					// 0xFF in the top byte ) and the cluster's BLAS-relative node offset. The GPU adds
					// that offset to the placement's BLAS base ( transform.nodeOffset ) to reach the
					// cluster subtree.
					const offset = rootBuffer32[ r32 + 6 ];
					const count = rootBuffer16[ r16 + 14 ];
					if ( count !== 1 ) {

						throw new Error( 'packBVHBufferUtils: a TLAS leaf must contain exactly one primitive.' );

					}

					const { transformSlot, nodeOffset } = primitiveInfo[ offset ];
					if ( transformSlot > 0x00ffffff ) {

						throw new Error( `packBVHBufferUtils: transform slot ${ transformSlot } exceeds the 24-bit TLAS leaf limit.` );

					}

					targetU32[ n32 + 6 ] = nodeOffset;
					targetU32[ n32 + 7 ] = 0xFF000000 | ( transformSlot & 0x00ffffff );

				} else {

					// mesh leaf ( 0xFFFF )
					targetU32[ n32 + 6 ] = rootBuffer32[ r32 + 6 ] + geometryOffset;
					targetU16[ n16 + 14 ] = rootBuffer16[ r16 + 14 ];
					targetU16[ n16 + 15 ] = IS_LEAFNODE_FLAG;

				}

			} else {

				targetU32[ n32 + 6 ] = rootBuffer32[ r32 + 6 ];
				targetU32[ n32 + 7 ] = rootBuffer32[ r32 + 7 ];

			}

			nodeWriteOffset ++;

		}

	} );

	return result;

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
