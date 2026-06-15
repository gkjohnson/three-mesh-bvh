/** @import { Object3D, BufferGeometry } from 'three' */
import { Matrix4, Vector4 } from 'three';
import { Mesh, StorageBufferAttribute, StructTypeNode } from 'three/webgpu';
import { storage, float, mat4 } from 'three/tsl';
import { wgslTagCode, wgslTagFn } from './nodes/WGSLTagFnNode.js';
import { MeshBVH } from '../core/MeshBVH.js';
import { SkinnedMeshBVH } from '../core/SkinnedMeshBVH.js';
import { GeometryBVH } from '../core/GeometryBVH.js';
import { ObjectBVH } from '../core/ObjectBVH.js';
import { SAH, BYTES_PER_NODE, UINT32_PER_NODE, IS_LEAFNODE_FLAG } from '../core/Constants.js';
import {
	bvhNodeBoundsStruct,
	bvhNodeStruct,
	rayStruct,
	transformStruct,
	rayIntersectionResultStruct,
	pointQueryResultStruct,
} from './tsl/structs.js';
import { intersectRayTriangle, closestPointToTriangle } from './tsl/fns.js';
import { BVH_STACK_DEPTH } from './tsl/constants.js';

// TODO: add ability to easily update a single matrix / scene rearrangement (partial update)
// TODO: add material support w/ function to easily update material
// 		- add a callback for writing a property for a geometry to a range
// TODO: Add support for other geometry types (tris, lines, custom BVHs etc)

// scratch
const _def = /* @__PURE__ */ new Vector4();
const _vec = /* @__PURE__ */ new Vector4();
const _matrix = /* @__PURE__ */ new Matrix4();
const _inverseMatrix = /* @__PURE__ */ new Matrix4();

// functions
function isObjectVisible( object ) {

	let curr = object;
	while ( curr ) {

		if ( curr.visible === false ) {

			return false;

		}

		curr = curr.parent;

	}

	return true;

}

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

function getTotalBVHByteLength( bvh ) {

	return bvh._roots.reduce( ( v, root ) => v + root.byteLength, 0 );

}

/**
 * Packs one or more scene objects into GPU-accessible BVH buffers (TLAS + BLAS) for use
 * in WebGPU compute shaders via the Three.js TSL node system. After construction, call
 * {@link BVHComputeData#update} to populate the storage buffers, then reference
 * `this.storage` and `this.fns` in your compute shader nodes.
 *
 * @note This API is unstable and subject to change in future releases.
 */
export class BVHComputeData {

	/**
	 * @param {ObjectBVH|Object3D|BufferGeometry|GeometryBVH|Array} bvh
	 * Scene objects to include, or a pre-built {@link ObjectBVH}. A single item or array of
	 * Object3D, BufferGeometry, or GeometryBVH instances are all accepted and wrapped
	 * automatically in an ObjectBVH.
	 * @param {Object} [options]
	 * @param {Record<string,string>} [options.attributes={ position: 'vec4f' }]
	 * WGSL type map for the interleaved per-vertex attribute buffer. Keys are geometry
	 * attribute names; values are WGSL type strings (e.g. `'vec3f'`, `'vec4f'`).
	 * @param {boolean} [options.autogenerateBvh=true]
	 * When true, a {@link MeshBVH} is automatically built for any object that does not
	 * already have `geometry.boundsTree` set.
	 */
	constructor( bvh, options = {} ) {

		// convert the bvh argument to an ObjectBVH. Supports the following as arguments
		// - Object3D
		// - BufferGeometry
		// - GeometryBVH
		// - Array of the above
		if ( ! ( bvh instanceof ObjectBVH ) ) {

			if ( ! Array.isArray( bvh ) ) {

				bvh = [ bvh ];

			}

			const objects = bvh.map( item => {

				if ( item.isObject3D ) {

					return item;

				} else if ( item.isBufferGeometry ) {

					return new Mesh( item );

				} else if ( item instanceof GeometryBVH ) {

					const dummy = new Mesh();
					dummy.geometry.boundsTree = item;
					return dummy;

				}

			} );

			bvh = new ObjectBVH( objects, { strategy: SAH, maxLeafSize: 1 } );

		}

		const {
			attributes = { position: 'vec4f' },
			autogenerateBvh = true,
		} = options;

		this._bvhCache = new Map();

		this.autogenerateBvh = autogenerateBvh;
		this.attributes = attributes;
		this.bvh = bvh;

		this.storage = {
			index: null,
			attributes: null,
			nodes: null,
			transforms: null,
		};

		this.structs = {
			transform: transformStruct,
			attributes: null,
		};

		this.fns = {
			raycastFirstHit: null,
			sampleTrianglePoint: null,
			closestPointToPoint: null,
		};

	}

	/**
	 * Builds a pair of WGSL shapecast functions (BLAS + TLAS traversal) for a custom shape
	 * type. The returned TLAS function signature is:
	 * `fn name( shape: ShapeStruct[, result: ptr<function, ResultStruct>] ) -> bool`
	 *
	 * @param {Object} options
	 * @param {string} [options.name] - Function name. Defaults to a random identifier.
	 * @param {StructTypeNode} options.shapeStruct - TSL struct or definition describing the query shape.
	 * @param {StructTypeNode|null} [options.resultStruct] - TSL struct for the accumulated result, or null.
	 * @param {Function|null} [options.boundsOrderFn] - function node controlling left/right child traversal order.
	 * @param {Function} options.intersectsBoundsFn - function node testing the shape against a BVH node's bounds.
	 * @param {Function} options.intersectRangeFn - function node testing the shape against a leaf triangle range.
	 * @param {Function|null} [options.transformShapeFn] - function node that transforms the shape into object local space.
	 * @param {Function|null} [options.transformResultFn] - function node that transforms a hit result back to world space.
	 * @param {Function|null} [options.resetShapeFn] - function node called after each BLAS traversal to reset any per-object state set by `transformShapeFn`.
	 * @returns {Function} TSL function node for the TLAS traversal.
	 */
	getShapecastFn( options ) {

		// TODO: test with and verify use with TSL Fn - both passing them as arguments,
		// calling the function from a TSL Fn.
		// TODO: revisit the semantics and mental model of "transformShapeFn" and "transformResultFn".
		// Are they "before" and "after" hooks? Should they include words implying a direction of transform?
		// eg "toLocal" / "toWorld"?
		const {
			name = `bvh_shapecast_fn_${ Math.random().toString( 36 ).substring( 2, 7 ) }`,
			shapeStruct,
			resultStruct = null,

			boundsOrderFn = null,
			intersectsBoundsFn,
			intersectRangeFn,
			transformShapeFn = null,
			transformResultFn = null,
			resetShapeFn = null,
		} = options;

		const { storage } = this;

		// handle optional functions
		let transformResultSnippet = '';
		if ( transformResultFn ) {

			transformResultSnippet = wgslTagCode/* wgsl */`${ transformResultFn }( result, i );`;

		}

		let transformShapeSnippet = '';
		if ( transformShapeFn ) {

			transformShapeSnippet = wgslTagCode/* wgsl */`${ transformShapeFn }( &localShape, i );`;

		}

		let resetShapeSnippet = '';
		if ( resetShapeFn ) {

			resetShapeSnippet = wgslTagCode/* wgsl */`${ resetShapeFn }( i );`;

		}

		let leftToRightSnippet = '';
		if ( boundsOrderFn ) {

			leftToRightSnippet = wgslTagCode/* wgsl */`
				let leftToRight = ${ boundsOrderFn }( shape, splitAxis, node );
				c1 = select( rightIndex, leftIndex, leftToRight );
				c2 = select( leftIndex, rightIndex, leftToRight );
			`;

		}

		const resultPtrSnippet = resultStruct ? wgslTagCode/* wgsl */`result: ptr<function, ${ resultStruct }>` : '';
		const resultArg = resultStruct ? 'result' : '';

		const getFnBody = leafSnippet => {

			// returns a function with a snippet inserted for the leaf intersection test
			return wgslTagCode/* wgsl */`

				var pointer: i32 = 0;
				var stack: array<u32, ${ BVH_STACK_DEPTH }>;
				stack[ 0 ] = rootNodeIndex;

				loop {

					if ( pointer < 0 || pointer >= i32( ${ BVH_STACK_DEPTH } ) ) {

						break;

					}

					let nodeIndex = stack[ pointer ];
					let node = ${ storage.nodes }[ nodeIndex ];
					pointer = pointer - 1;

					if ( ${ intersectsBoundsFn }( shape, node.bounds, ${ resultArg } ) == 0u ) {

						continue;

					}

					let infoX = node.splitAxisOrTriangleCount;
					let infoY = node.rightChildOrTriangleOffset;
					let isLeaf = ( infoX & 0xffff0000u ) != 0u;

					if ( isLeaf ) {

						let count = infoX & 0x0000ffffu;
						let offset = infoY;
						${ leafSnippet }

					} else {

						let leftIndex = nodeIndex + 1u;
						let splitAxis = infoX & 0x0000ffffu;
						let rightIndex = nodeIndex + infoY;

						var c1 = rightIndex;
						var c2 = leftIndex;
						${ leftToRightSnippet }

						pointer = pointer + 1;
						stack[ pointer ] = c2;

						pointer = pointer + 1;
						stack[ pointer ] = c1;

					}

				}

			`;

		};

		const blasFn = wgslTagFn/* wgsl */`
			// fn
			fn ${ name }_blas( shape: ${ shapeStruct }, rootNodeIndex: u32, ${ resultPtrSnippet } ) -> bool {

				var didHit = false;
				${ getFnBody( wgslTagCode/* wgsl */`

					didHit = ${ intersectRangeFn }( shape, offset, count, ${ resultArg } ) || didHit;

				` ) }

				return didHit;

			}
		`;

		const tlasFn = wgslTagFn/* wgsl */`
			// fn
			fn ${ name }( shape: ${ shapeStruct }, ${ resultPtrSnippet } ) -> bool {

				const rootNodeIndex = 0u;
				var didHit = false;
				${ getFnBody( wgslTagCode/* wgsl */`

					for ( var i = offset; i < offset + count; i ++ ) {

						let transform = ${ storage.transforms }[ i ];
						if ( transform.visible == 0u ) {

							continue;

						}

						// Transform shape into object local space
						var localShape = shape;
						${ transformShapeSnippet }

						if ( ${ blasFn }( localShape, transform.nodeOffset, ${ resultArg } ) ) {

							${ transformResultSnippet }
							didHit = true;

						}

						${ resetShapeSnippet }

					}

				` ) }

				return didHit;

			}
		`;

		tlasFn.outputType = resultStruct;
		tlasFn.functionName = name;

		return tlasFn;

	}

	/**
	 * Rebuilds all GPU storage buffers from the current scene state. Must be called at least
	 * once before using `this.storage` or `this.fns` in a shader, and again whenever the
	 * scene topology changes (objects added/removed, geometry modified).
	 */
	update() {

		const self = this;
		const { attributes, structs, bvh } = this;

		// collect the BVHs
		const bvhInfo = [];
		const transformInfo = [];

		// accumulate the sizes of the bvh nodes buffer, number of objects, and geometry buffers
		let bvhNodesBufferLength = getTotalBVHByteLength( bvh );
		let indexBufferLength = 0;
		let attributesBufferLength = 0;
		bvh.primitiveBuffer.forEach( compositeId => {

			const object = bvh.getObjectFromId( compositeId );
			const instanceId = bvh.getInstanceFromId( compositeId );
			const range = { start: 0, count: 0, vertexStart: 0, vertexCount: 0 };
			const primBvh = this.getBVH( object, instanceId, range );

			if ( ! primBvh ) {

				throw new Error( 'BVHComputeData: BVH not found.' );

			}

			// if we haven't added this bvh, yet
			if ( ! bvhInfo.find( info => info.bvh === primBvh ) ) {

				// save the geometry info to write later and increment the buffer sizes
				const info = {
					index: bvhInfo.length,
					bvh: primBvh,
					range: range,

					bvhNodeOffsets: null,
					indexBufferOffset: null,

				};

				// increase the buffer sizes for bvh and geometry
				bvhNodesBufferLength += getTotalBVHByteLength( primBvh );
				indexBufferLength += info.range.count;
				attributesBufferLength += info.range.vertexCount;
				bvhInfo.push( info );

			}

			// save the index of the bvh associated with this transform
			const data = bvhInfo.find( info => primBvh === info.bvh );
			primBvh._roots.forEach( ( root, i ) => {

				transformInfo.push( {
					data,
					root: i,
					object,
					instanceId,
					compositeId,
				} );

			} );

		} );

		//

		// @note These buffer lengths are increased to a minimum size of 2 to avoid TSL converting storage buffers
		// with length 1 being converted to a scalar value.
		// TODO: remove this when fixed in three
		const transformBufferLength = Math.max( transformInfo.length, 2 );
		indexBufferLength = Math.max( indexBufferLength, 2 );
		attributesBufferLength = Math.max( attributesBufferLength, 2 );

		// construct the attribute struct
		const attributeStruct = new StructTypeNode( attributes, 'bvh_GeometryStruct' );

		// write the geometry buffer attributes & bvh data
		let attributesOffset = 0;
		let indexOffset = 0;
		let nodeWriteOffset = 0;
		const indexBuffer = new Uint32Array( indexBufferLength );
		const attributesBuffer = new ArrayBuffer( attributesBufferLength * attributeStruct.getLength() * 4 );
		const bvhNodesBuffer = new ArrayBuffer( bvhNodesBufferLength );

		// append TLAS data
		appendBVHData( bvh, 0, transformInfo, 0, bvhNodesBuffer, true );
		nodeWriteOffset += getTotalBVHByteLength( bvh ) / BYTES_PER_NODE;
		bvhInfo.forEach( info => {

			// append bvh data
			const bvhNodeOffsets = appendBVHData( info.bvh, indexOffset / 3, transformInfo, nodeWriteOffset, bvhNodesBuffer, false );
			info.bvhNodeOffsets = bvhNodeOffsets;

			// append geometry data
			appendIndexData( info.bvh, info.range, attributesOffset, indexOffset, indexBuffer );
			appendGeometryData( info.bvh, info.range, attributesOffset, attributesBuffer );
			info.indexBufferOffset = indexOffset;

			// step the write offsets forward
			indexOffset += info.range.count;
			attributesOffset += info.range.vertexCount;
			nodeWriteOffset += getTotalBVHByteLength( info.bvh ) / BYTES_PER_NODE;

		} );

		//

		// write the transforms
		const transformArrayBuffer = new ArrayBuffer( structs.transform.getLength() * transformBufferLength * 4 );
		transformInfo.forEach( ( info, i ) => {

			_inverseMatrix.copy( bvh.matrixWorld ).invert();
			this.writeTransformData( info, _inverseMatrix, i, transformArrayBuffer );

		} );

		//

		// set up the storage buffers
		// if itemSize for StorageBufferAttribute == arraySize,
		// then buffer is treated not as array of structs, but as a single struct
		// And that breaks code. For now itemSize = 1 does not seem to break anything
		const bvhNodesStorage = storage( new StorageBufferAttribute( new Uint32Array( bvhNodesBuffer ), 1 ), bvhNodeStruct ).toReadOnly().setName( 'bvh_nodes' );
		const transformsBuffer = new StorageBufferAttribute( new Uint32Array( transformArrayBuffer ), 1 );
		const transformsStorage = storage( transformsBuffer, structs.transform ).toReadOnly().setName( 'bvh_transforms' );
		const indexStorage = storage( new StorageBufferAttribute( indexBuffer, 1 ), 'uint' ).toReadOnly().setName( 'bvh_index' );
		const attributesStorage = storage( new StorageBufferAttribute( new Uint32Array( attributesBuffer ), attributeStruct.getLength() ), attributeStruct ).toReadOnly().setName( 'bvh_attributes' );

		this.storage.transforms = transformsStorage;
		this.storage.nodes = bvhNodesStorage;
		this.storage.index = indexStorage;
		this.storage.attributes = attributesStorage;
		this.structs.attributes = attributeStruct;

		this._initFns();
		this._bvhCache.clear();

		function appendBVHData( bvh, geometryOffset, transformInfo, nodeWriteOffset, target, tlas = false ) {

			const targetU16 = new Uint16Array( target );
			const targetU32 = new Uint32Array( target );
			const targetF32 = new Float32Array( target );

			const result = [];
			let tlasOffset = 0;
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

							// 0xFFFF == mesh leaf, 0xFF00 == TLAS leaf
							targetU32[ n32 + 6 ] = tlasOffset;
							targetU16[ n16 + 15 ] = 0xFF00;

							const count = rootBuffer16[ r16 + 14 ];
							// const offset = rootBuffer32[ r32 + 6 ];

							// each root is expanded into a separate transform so we need to expand
							// the embedded offsets and counts.
							let rootsCount = 0;
							for ( let o = 0; o < count; o ++ ) {

								const roots = transformInfo[ tlasOffset ].data.bvh._roots.length;
								tlasOffset += roots;
								rootsCount += roots;

							}

							targetU16[ n16 + 14 ] = rootsCount;

						} else {

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

		function appendIndexData( bvh, range, valueOffset, writeOffset, target ) {

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

		function appendGeometryData( bvh, range, writeOffset, target ) {

			// if "mesh" is present then it is assumed to be a SkinnedMeshBVH
			const { geometry, mesh = null } = bvh;
			const { vertexStart, vertexCount } = range;
			const attributesBufferF32 = new Float32Array( target );
			const attrStructLength = attributeStruct.getLength();
			attributeStruct.membersLayout.forEach( ( { name }, interleavedOffset ) => {

				// TODO: we should be able to have access to memory layout offsets here via the struct
				// API but it's not currently available.
				const attr = geometry.attributes[ name ];
				self.getDefaultAttributeValue( name, _def );

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

	}

	_initFns() {

		const { storage, structs, fns } = this;

		// raycast first hit
		const scratchRayScalar = float( 1.0 ).toVar( `bvh_rayScalar_${ Math.random().toString( 36 ).substring( 2, 7 ) }` );
		fns.raycastFirstHit = this.getShapecastFn( {
			name: 'bvh_RaycastFirstHit',
			shapeStruct: rayStruct,
			resultStruct: rayIntersectionResultStruct,

			boundsOrderFn: wgslTagFn/* wgsl */`
				fn getBoundsOrder( ray: ${ rayStruct }, splitAxis: u32, node: ${ bvhNodeStruct } ) -> bool {

					return ray.direction[ splitAxis ] >= 0.0;

				}
			`,
			intersectsBoundsFn: wgslTagFn/* wgsl */`
				fn rayIntersectsBounds( ray: ${ rayStruct }, bounds: ${ bvhNodeBoundsStruct }, result: ptr<function, ${ rayIntersectionResultStruct }> ) -> u32 {

					let boundsMin = vec3( bounds.min[0], bounds.min[1], bounds.min[2] );
					let boundsMax = vec3( bounds.max[0], bounds.max[1], bounds.max[2] );

					let invDir = 1.0 / ray.direction;
					let tMinPlane = ( boundsMin - ray.origin ) * invDir;
					let tMaxPlane = ( boundsMax - ray.origin ) * invDir;

					let tMinHit = vec3f(
						min( tMinPlane.x, tMaxPlane.x ),
						min( tMinPlane.y, tMaxPlane.y ),
						min( tMinPlane.z, tMaxPlane.z )
					);

					let tMaxHit = vec3f(
						max( tMinPlane.x, tMaxPlane.x ),
						max( tMinPlane.y, tMaxPlane.y ),
						max( tMinPlane.z, tMaxPlane.z )
					);

					let t0 = max( max( tMinHit.x, tMinHit.y ), tMinHit.z );
					let t1 = min( min( tMaxHit.x, tMaxHit.y ), tMaxHit.z );

					let dist = max( t0, 0.0 );
					if ( t1 < dist ) {

						return 0u;

					} else if ( result.didHit && dist * ${ scratchRayScalar } >= result.dist ) {

						return 0u;

					} else {

						return 1u;

					}

				}

			`,
			intersectRangeFn: wgslTagFn/* wgsl */`
				fn intersectRange( ray: ${ rayStruct }, offset: u32, count: u32, result: ptr<function, ${ rayIntersectionResultStruct }> ) -> bool {

					var didHit = false;
					for ( var ti = offset; ti < offset + count; ti = ti + 1u ) {

						let i0 = ${ storage.index }[ ti * 3u ];
						let i1 = ${ storage.index }[ ti * 3u + 1u ];
						let i2 = ${ storage.index }[ ti * 3u + 2u ];

						let a = ${ storage.attributes }[ i0 ].position.xyz;
						let b = ${ storage.attributes }[ i1 ].position.xyz;
						let c = ${ storage.attributes }[ i2 ].position.xyz;

						var triResult = ${ intersectRayTriangle }( ray, a, b, c, 0.0 );
						triResult.dist *= ${ scratchRayScalar };
						if ( triResult.didHit && ( ! result.didHit || triResult.dist < result.dist ) ) {

							result.didHit = true;
							result.dist = triResult.dist;
							result.normal = triResult.normal;
							result.side = triResult.side;
							result.barycoord = triResult.barycoord;
							result.indices = vec4u( i0, i1, i2, ti );

							didHit = true;

						}

					}

					return didHit;

				}
			`,
			transformShapeFn: wgslTagFn/* wgsl */`
				fn transformRay( ray: ptr<function, ${ rayStruct }>, objectIndex: u32 ) -> void {

					let toLocal = ${ storage.transforms }[ objectIndex ].inverseMatrixWorld;
					ray.origin = ( toLocal * vec4f( ray.origin, 1.0 ) ).xyz;
					ray.direction = ( toLocal * vec4f( ray.direction, 0.0 ) ).xyz;

					let len = length( ray.direction );
					ray.direction /= len;
					${ scratchRayScalar } = 1.0 / len;

				}
			`,
			transformResultFn: wgslTagFn/* wgsl */`
				fn transformResult( hit: ptr<function, ${ rayIntersectionResultStruct }>, objectIndex: u32 ) -> void {

					let toLocal = ${ storage.transforms }[ objectIndex ].inverseMatrixWorld;
					hit.normal = normalize( ( transpose( toLocal ) * vec4f( hit.normal, 0.0 ) ).xyz );
					hit.objectIndex = objectIndex;

				}
			`,
			resetShapeFn: wgslTagFn/* wgsl */`
				fn resetRayScalar( objectIndex: u32 ) -> void {

					${ scratchRayScalar } = 1.0;

				}
			`,
		} );

		// attribute interpolation function
		const interpolateBody = structs
			.attributes
			.membersLayout
			.map( ( { name } ) => {

				return `result.${ name } = a0.${ name } * barycoord.x + a1.${ name } * barycoord.y + a2.${ name } * barycoord.z;`;

			} ).join( '\n' );
		fns.sampleTrianglePoint = wgslTagFn/* wgsl */`
			// fn
			fn bvh_sampleTrianglePoint( barycoord: vec3f, indices: vec3u ) -> ${ structs.attributes } {

				var result: ${ structs.attributes };
				var a0 = ${ storage.attributes }[ indices.x ];
				var a1 = ${ storage.attributes }[ indices.y ];
				var a2 = ${ storage.attributes }[ indices.z ];
				${ interpolateBody }
				return result;

			}
		`;

		// closest point to point
		const scratchToWorldMat = mat4().toVar( 'bvh_toWorldMat' );
		fns.closestPointToPoint = this.getShapecastFn( {
			name: 'bvh_ClosestPointToPoint',
			shapeStruct: 'vec3f',
			resultStruct: pointQueryResultStruct,

			boundsOrderFn: wgslTagFn/* wgsl */`
				fn cppBoundsOrder( shape: vec3f, splitAxis: u32, node: ${ bvhNodeStruct } ) -> bool {

					let toWorld = ${ scratchToWorldMat };

					// get center
					let bMin = vec3f( node.bounds.min[ 0 ], node.bounds.min[ 1 ], node.bounds.min[ 2 ] );
					let bMax = vec3f( node.bounds.max[ 0 ], node.bounds.max[ 1 ], node.bounds.max[ 2 ] );
					let center = bMin * 0.5 + bMax * 0.5;

					// determine the order in world space
					let worldCenter = ( toWorld * vec4f( center, 1.0 ) ).xyz;
					let worldAxis = normalize( toWorld[ splitAxis ].xyz );
					return dot( shape - worldCenter, worldAxis ) <= 0.0;

				}
			`,

			intersectsBoundsFn: wgslTagFn/* wgsl */`
				fn cppIntersectsBounds( shape: vec3f, bounds: ${ bvhNodeBoundsStruct }, result: ptr<function, ${ pointQueryResultStruct }> ) -> u32 {

					// return 1u;
					// we need to check this no matter what if the result has not been found yet
					if ( ! result.found ) {

						return 1u;

					}

					let toWorld = ${ scratchToWorldMat };

					// transform to world space
					let bMin = vec3f( bounds.min[ 0 ], bounds.min[ 1 ], bounds.min[ 2 ] );
					let bMax = vec3f( bounds.max[ 0 ], bounds.max[ 1 ], bounds.max[ 2 ] );
					let center = ( bMin + bMax ) * 0.5;
					let halfExtent = ( bMax - bMin ) * 0.5;
					let worldCenter = ( toWorld * vec4f( center, 1.0 ) ).xyz;
					let worldHalfExtent =
						abs( toWorld[ 0 ].xyz ) * halfExtent.x +
					    abs( toWorld[ 1 ].xyz ) * halfExtent.y +
					    abs( toWorld[ 2 ].xyz ) * halfExtent.z;
					let worldMin = worldCenter - worldHalfExtent;
					let worldMax = worldCenter + worldHalfExtent;

					// intersect if the distance to the bounds is not bigger than the already found
					let d = shape - clamp( shape, worldMin, worldMax );
					return select( 0u, 1u, dot( d, d ) < result.distanceSq );

				}
			`,

			intersectRangeFn: wgslTagFn /* wgsl */`
				fn cppIntersectsRange( shape: vec3f, offset: u32, count: u32, result: ptr<function, ${ pointQueryResultStruct }> ) -> bool {

					var didHit = false;
					let toWorld = ${ scratchToWorldMat };

					for ( var i = offset; i < offset + count; i ++ ) {

						// transform the triangle to world space
						let i0 = ${ storage.index }[ i * 3u + 0u ];
						let i1 = ${ storage.index }[ i * 3u + 1u ];
						let i2 = ${ storage.index }[ i * 3u + 2u ];
						let a = ( toWorld * vec4f( ${ storage.attributes }[ i0 ].position.xyz, 1.0 ) ).xyz;
						let b = ( toWorld * vec4f( ${ storage.attributes }[ i1 ].position.xyz, 1.0 ) ).xyz;
						let c = ( toWorld * vec4f( ${ storage.attributes }[ i2 ].position.xyz, 1.0 ) ).xyz;

						let barycoord = ${ closestPointToTriangle }( shape, a, b, c );
						let closestPoint = barycoord.x * a + barycoord.y * b + barycoord.z * c;
						let delta = shape - closestPoint;
						let distSq = dot( delta, delta );

						// copy the content over
						if ( ! result.found || distSq < result.distanceSq ) {

							let normal = normalize( cross( a - b, b - c ) );

							result.closestPoint = closestPoint;
							result.barycoord = barycoord;
							result.distanceSq = distSq;
							result.faceNormal = normal;
							result.side = sign( dot( normal, delta ) );
							result.faceIndices = vec4u( i0, i1, i2, i );
							result.found = true;
							didHit = true;

						}

					}

					return didHit;

				}
			`,

			transformShapeFn: wgslTagFn/* wgsl */`
				fn cppTransformShape( shape: ptr<function, vec3f>, objectIndex: u32 ) -> void {

					${ scratchToWorldMat } = ${ storage.transforms }[ objectIndex ].matrixWorld;

				}
			`,

			transformResultFn: wgslTagFn/* wgsl */`
				fn cppTransformResult( result: ptr<function, ${ pointQueryResultStruct }>, objectIndex: u32 ) -> void {

					result.objectIndex = objectIndex;

				}
			`,
		} );

	}

	/**
	 * Writes the world/inverse-world matrices, node offset, and visibility flag for one
	 * transform entry into a raw ArrayBuffer. Override this in a subclass to inject
	 * additional per-object data (e.g. material index).
	 *
	 * @private
	 * @param {Object3D} info - Transform entry from the internal transform info array.
	 * @param {Matrix4} premultiplyMatrix - Matrix pre-multiplied onto the object's world matrix (usually the inverse TLAS root matrix).
	 * @param {number} writeOffset - Index of the transform slot to write into.
	 * @param {ArrayBuffer} targetBuffer - Destination buffer.
	 */
	writeTransformData( info, premultiplyMatrix, writeOffset, targetBuffer ) {

		const { structs } = this;
		const transformBufferF32 = new Float32Array( targetBuffer );
		const transformBufferU32 = new Uint32Array( targetBuffer );

		const { object, instanceId, root, data } = info;
		const { bvhNodeOffsets } = data;
		if ( object.isInstancedMesh || object.isBatchedMesh ) {

			object.getMatrixAt( instanceId, _matrix );
			_matrix.premultiply( object.matrixWorld );

		} else {

			_matrix.copy( object.matrixWorld );

		}

		// write transform
		_matrix.premultiply( premultiplyMatrix );
		_matrix.toArray( transformBufferF32, writeOffset * structs.transform.getLength() );

		// write inverse transform
		_matrix.invert();
		_matrix.toArray( transformBufferF32, writeOffset * structs.transform.getLength() + 16 );

		// write node offset
		transformBufferU32[ writeOffset * structs.transform.getLength() + 32 ] = bvhNodeOffsets[ root ];

		let visible = isObjectVisible( object );
		if ( object.isBatchedMesh ) {

			visible = visible && object.getVisibleAt( instanceId );

		}

		transformBufferU32[ writeOffset * structs.transform.getLength() + 33 ] = visible ? 1 : 0;

	}

	/**
	 * Returns the BVH for a given object/instance, populating `rangeTarget` with the
	 * corresponding index and vertex ranges within the packed geometry buffers. Override
	 * to support custom BVH types or caching strategies.
	 *
	 * @private
	 * @param {Object3D} object - The object to generate a BVH for.
	 * @param {number} instanceId - Instance index (relevant for InstancedMesh / BatchedMesh).
	 * @param {{start:number,count:number,vertexStart:number,vertexCount:number}} rangeTarget - Populated with the object's geometry range.
	 * @returns {MeshBVH|SkinnedMeshBVH|null}
	 */
	getBVH( object, instanceId, rangeTarget ) {

		const { autogenerateBvh, _bvhCache } = this;

		let bvh = null;
		if ( object.boundsTree || object.isSkinnedMesh ) {

			// this is a case where a mesh has morph targets and skinned meshes
			const geometry = object.geometry;
			rangeTarget.count = geometry.index ? geometry.index.count : geometry.attributes.position.count;
			rangeTarget.vertexCount = geometry.attributes.position.count;
			bvh = object.boundsTree || null;

			if ( bvh === null && autogenerateBvh ) {

				const id = object.uuid;
				bvh = _bvhCache.get( id ) || new SkinnedMeshBVH( object );
				_bvhCache.set( id, bvh );

			}

		} else if ( object.isBatchedMesh ) {

			const geometryId = object.getGeometryIdAt( instanceId );
			const range = object.getGeometryRangeAt( geometryId );
			Object.assign( rangeTarget, range );
			bvh = object.boundsTrees[ geometryId ] || null;

			if ( bvh === null && autogenerateBvh ) {

				const id = `batched_${ object.geometry.uuid }_${ range.start }_${ range.count }`;
				bvh = _bvhCache.get( id ) || new MeshBVH( object.geometry, { range: { ...rangeTarget } } );
				_bvhCache.set( id, bvh );

			}

		} else {

			const geometry = object.geometry;
			rangeTarget.count = geometry.index ? geometry.index.count : geometry.attributes.position.count;
			rangeTarget.vertexCount = geometry.attributes.position.count;
			bvh = object.geometry.boundsTree || null;

			if ( bvh === null && autogenerateBvh ) {

				const id = geometry.uuid;
				bvh = _bvhCache.get( id ) || new MeshBVH( geometry );
				_bvhCache.set( id, bvh );

			}

		}

		return bvh;

	}

	/**
	 * Returns the default vec4 value written to the attribute buffer for vertices that lack
	 * a given attribute. Override to change per-attribute defaults.
	 *
	 * @private
	 * @param {string} key - Attribute name (e.g. `'position'`, `'normal'`).
	 * @param {Vector4} target - Receives the default value.
	 * @returns {Vector4}
	 */
	getDefaultAttributeValue( key, target ) {

		switch ( key ) {

			case 'position':
			case 'color':
				target.set( 1, 1, 1, 1 );
				break;

			default:
				target.set( 0, 0, 0, 0 );

		}

		return target;

	}

	/**
	 * Releases GPU resources held by this instance.
	 */
	dispose() {

		const { storage } = this;
		for ( const key in storage ) {

			if ( storage[ key ] !== null ) {

				storage[ key ]?.value?.dispose();
				storage[ key ] = null;

			}

		}

		this.fns.raycastFirstHit = null;
		this.fns.sampleTrianglePoint = null;
		this.fns.closestPointToPoint = null;

	}

}
