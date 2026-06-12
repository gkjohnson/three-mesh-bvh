import { Matrix4, Vector4 } from 'three';
import { Mesh, StorageBufferAttribute, StructTypeNode } from 'three/webgpu';
import { storage, float, uint } from 'three/tsl';
import { wgslTagCode, wgslTagFn } from './nodes/WGSLTagFnNode.js';
import { MeshBVH } from '../core/MeshBVH.js';
import { SkinnedMeshBVH } from '../core/SkinnedMeshBVH.js';
import { GeometryBVH } from '../core/GeometryBVH.js';
import { ObjectBVH } from '../core/ObjectBVH.js';
import { SAH } from '../core/Constants.js';

// TODO: add ability to easily update a single matrix / scene rearrangement (partial update)
// TODO: add material support w/ function to easily update material
// 		- add a callback for writing a property for a geometry to a range
// TODO: Add support for other geometry types (tris, lines, custom BVHs etc)

// temporary shim so StructTypeNodes can be passed to storage functions until
// this is fixed in three.js
Object.defineProperty( StructTypeNode.prototype, 'layout', {

	get() {

		return this;

	}

} );
StructTypeNode.prototype.isStruct = true;

//

// BVH node struct definitions for use with wgslTagFn template interpolation
const bvhNodeBoundsStruct = new StructTypeNode( {
	min: 'array<f32, 3>',
	max: 'array<f32, 3>',
}, 'BVHBoundingBox' );
bvhNodeBoundsStruct.getLength = () => 6;

const bvhNodeStruct = new StructTypeNode( {
	bounds: 'BVHBoundingBox',
	rightChildOrTriangleOffset: 'uint',
	splitAxisOrTriangleCount: 'uint',
}, 'BVHNode' );
bvhNodeStruct.getLength = () => bvhNodeBoundsStruct.getLength() + 2;

const rayStruct = new StructTypeNode( {
	origin: 'vec3f',
	direction: 'vec3f',
}, 'Ray' );

const BVH_STACK_DEPTH = uint( 60 );

//

const isVisible = object => {

	let curr = object;
	while ( curr ) {

		if ( curr.visible === false ) {

			return false;

		}

		curr = curr.parent;

	}

	return true;

};

const applyBoneTransform = ( () => {

	// a vec4-compatible version of SkinnedMesh.applyBoneTransform to support directions, positions
	const _base = new Vector4();
	const _skinIndex = new Vector4();
	const _skinWeight = new Vector4();
	const _matrix4 = new Matrix4();
	const _vector4 = new Vector4();
	return function applyBoneTransform( mesh, index, target ) {

		const skeleton = mesh.skeleton;
		const geometry = mesh.geometry;

		_skinIndex.fromBufferAttribute( geometry.attributes.skinIndex, index );
		_skinWeight.fromBufferAttribute( geometry.attributes.skinWeight, index );

		if ( target.isVector4 ) {

			_base.copy( target );
			target.set( 0, 0, 0, 0 );

		} else {

			_base.set( ...target, 1 );
			target.set( 0, 0, 0 );

		}

		_base.applyMatrix4( mesh.bindMatrix );

		for ( let i = 0; i < 4; i ++ ) {

			const weight = _skinWeight.getComponent( i );

			if ( weight !== 0 ) {

				const boneIndex = _skinIndex.getComponent( i );

				_matrix4.multiplyMatrices( skeleton.bones[ boneIndex ].matrixWorld, skeleton.boneInverses[ boneIndex ] );

				target.addScaledVector( _vector4.copy( _base ).applyMatrix4( _matrix4 ), weight );

			}

		}

		if ( target.isVector4 ) {

			target.w = _base.w;

		}

		return target.applyMatrix4( mesh.bindMatrixInverse );

	};

} )();


//

// structs
const transformStruct = new StructTypeNode( {
	matrixWorld: 'mat4x4f',
	inverseMatrixWorld: 'mat4x4f',
	nodeOffset: 'uint',
	visible: 'uint',
	_alignment0: 'uint',
	_alignment1: 'uint',
}, 'TransformStruct' );

export const intersectionResultStruct = new StructTypeNode( {
	indices: 'vec4u',
	normal: 'vec3f',
	didHit: 'bool',
	barycoord: 'vec3f',
	objectIndex: 'uint',
	side: 'float',
	dist: 'float',
}, 'IntersectionResult' );

//

// node constants
const BYTES_PER_NODE = 6 * 4 + 4 + 4;
const UINT32_PER_NODE = BYTES_PER_NODE / 4;
const IS_LEAFNODE_FLAG = 0xFFFF;

// scratch
const _def = /* @__PURE__ */ new Vector4();
const _vec = /* @__PURE__ */ new Vector4();
const _matrix = /* @__PURE__ */ new Matrix4();
const _inverseMatrix = /* @__PURE__ */ new Matrix4();

// functions
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

export const intersectsTriangle = wgslTagFn/* wgsl */ `
	// fn
	fn intersectsTriangle( ray: ${ rayStruct }, a: vec3f, b: vec3f, c: vec3f ) -> ${ intersectionResultStruct } {

		// TODO: see if we can remove the "DIST" epsilon and account for it on ray origin bounce positioning
		const DET_EPSILON = 1e-15;
		const DIST_EPSILON = 1e-5;

		var result: ${ intersectionResultStruct };
		result.didHit = false;

		let edge1 = b - a;
		let edge2 = c - a;
		let n = cross( edge1, edge2 );

		let det = - dot( ray.direction, n );
		if ( abs( det ) < DET_EPSILON ) {

			return result;

		}

		let invdet = 1.0 / det;

		let AO = ray.origin - a;
		let DAO = cross( AO, ray.direction );

		let u = dot( edge2, DAO ) * invdet;
		if ( u < 0.0 || u > 1.0 ) {

			return result;

		}

		let v = - dot( edge1, DAO ) * invdet;
		if ( v < 0.0 || u + v > 1.0 ) {

			return result;

		}

		let t = dot( AO, n ) * invdet;
		let w = 1.0 - u - v;
		if ( t < DIST_EPSILON ) {

			return result;

		}

		result.didHit = true;
		result.barycoord = vec3f( w, u, v );
		result.dist = t;
		result.side = sign( det );
		result.normal = result.side * normalize( n );

		return result;

	}
`;

export class BVHComputeData {

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
		};

	}

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

					}

				` ) }

				return didHit;

			}
		`;

		tlasFn.outputType = resultStruct;
		tlasFn.functionName = name;

		return tlasFn;

	}

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

		// NOTE: These buffer lengths are increased to a minimum size of 2 to avoid the TSL of converting storage buffers
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

							applyBoneTransform( mesh, i + vertexStart, _vec );

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
			resultStruct: intersectionResultStruct,

			boundsOrderFn: wgslTagFn/* wgsl */`
				fn getBoundsOrder( ray: ${ rayStruct }, splitAxis: u32, node: ${ bvhNodeStruct } ) -> bool {

					return ray.direction[ splitAxis ] >= 0.0;

				}
			`,
			intersectsBoundsFn: wgslTagFn/* wgsl */`
				fn rayIntersectsBounds( ray: ${ rayStruct }, bounds: ${ bvhNodeBoundsStruct }, result: ptr<function, ${ intersectionResultStruct }> ) -> u32 {

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
				fn intersectRange( ray: ${ rayStruct }, offset: u32, count: u32, result: ptr<function, ${ intersectionResultStruct }> ) -> bool {

					var didHit = false;
					for ( var ti = offset; ti < offset + count; ti = ti + 1u ) {

						let i0 = ${ storage.index }[ ti * 3u ];
						let i1 = ${ storage.index }[ ti * 3u + 1u ];
						let i2 = ${ storage.index }[ ti * 3u + 2u ];

						let a = ${ storage.attributes }[ i0 ].position.xyz;
						let b = ${ storage.attributes }[ i1 ].position.xyz;
						let c = ${ storage.attributes }[ i2 ].position.xyz;

						var triResult = ${ intersectsTriangle }( ray, a, b, c );
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
				fn transformResult( hit: ptr<function, ${ intersectionResultStruct }>, objectIndex: u32 ) -> void {

					let toLocal = ${ storage.transforms }[ objectIndex ].inverseMatrixWorld;
					hit.normal = normalize( ( transpose( toLocal ) * vec4f( hit.normal, 0.0 ) ).xyz );
					hit.objectIndex = objectIndex;

				}
			`,
		} );

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

	}

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

		let visible = isVisible( object );
		if ( object.isBatchedMesh ) {

			visible = visible && object.getVisibleAt( instanceId );

		}

		transformBufferU32[ writeOffset * structs.transform.getLength() + 33 ] = visible ? 1 : 0;

	}

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

	dispose() {

		// TODO: dispose buffers

	}

}
