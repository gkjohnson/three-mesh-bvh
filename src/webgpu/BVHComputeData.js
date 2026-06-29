/** @import { Object3D, BufferGeometry, Vector4 } from 'three' */
import { Matrix4 } from 'three';
import { StorageBufferAttribute, StructTypeNode } from 'three/webgpu';
import { storage } from 'three/tsl';
import { MeshBVH } from '../core/MeshBVH.js';
import { SkinnedMeshBVH } from '../core/SkinnedMeshBVH.js';
import { GeometryBVH } from '../core/GeometryBVH.js';
import { ClusteredMetaBVH } from './ClusteredMetaBVH.js';
import { BYTES_PER_NODE, UINT32_PER_NODE } from '../core/Constants.js';
import { proxy, proxyFn } from './nodes/NodeProxy.js';
import {
	bvhNodeStruct,
	transformStruct,
} from './tsl/structs.js';
import { toClusteredMetaBVH } from './utils/toClusteredMetaBVH.js';
import { appendBVHData, appendIndexData, appendGeometryData } from './utils/packBVHBufferUtils.js';
import { getShapecastFn } from './shapecastFns/getShapecastFn.js';
import { getRaycastFirstHitFn } from './shapecastFns/getRaycastFirstHitFn.js';
import { getSampleTrianglePointFn } from './shapecastFns/getSampleTrianglePointFn.js';
import { getClosestPointToPointFn } from './shapecastFns/getClosestPointToPointFn.js';

// TODO: add ability to easily update a single matrix / scene rearrangement (partial update)
// TODO: add material support w/ function to easily update material
// 		- add a callback for writing a property for a geometry to a range
// TODO: Add support for other geometry types (tris, lines, custom BVHs etc)

// scratch
const _matrix = /* @__PURE__ */ new Matrix4();
const _inverseMatrix = /* @__PURE__ */ new Matrix4();
const _range = { start: 0, count: 0, vertexStart: 0, vertexCount: 0 };

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
	 * @param {ClusteredMetaBVH|Object3D|BufferGeometry|GeometryBVH|Array} bvh
	 * Scene objects to include, or a pre-built {@link ClusteredMetaBVH}. A single item or array of
	 * Object3D, BufferGeometry, or GeometryBVH instances are all accepted and wrapped
	 * automatically in a ClusteredMetaBVH.
	 * @param {Object} [options]
	 * @param {Record<string,string>} [options.attributes={ position: 'vec4f' }]
	 * WGSL type map for the interleaved per-vertex attribute buffer. Keys are geometry
	 * attribute names; values are WGSL type strings (e.g. `'vec3f'`, `'vec4f'`).
	 * @param {boolean} [options.autogenerateBvh=true]
	 * When true, a {@link MeshBVH} is automatically built for any object that does not
	 * already have `geometry.boundsTree` set.
	 */
	constructor( bvh, options = {} ) {

		const {
			attributes = { position: 'vec4f' },
			autogenerateBvh = true,
		} = options;

		this._bvhCache = new Map();

		this.autogenerateBvh = autogenerateBvh;
		this.attributes = attributes;

		// convert the bvh argument to a ClusteredMetaBVH. Supports an Object3D, BufferGeometry,
		// GeometryBVH, an array of the above, or a pre-built ClusteredMetaBVH. The meta bvh splits
		// each static mesh into clusters ( subtrees of its MeshBVH ) so dense, interpenetrating
		// geometry produces tighter top-level bounds; "getBVH" supplies the per-object MeshBVH.
		this.bvh = toClusteredMetaBVH( bvh, {
			getBVH: object => this.getBVH( object, 0, _range ),
		} );

		// storage buffers and structs are populated in "update"; their members are accessed through
		// proxy nodes so the functions below can reference them up front and keep working across rebuilds
		this.storage = new NodeProxyObject();
		this.structs = new NodeProxyObject( { transform: transformStruct } );
		this.fns = new NodeProxyObject( {
			raycastFirstHit: getRaycastFirstHitFn( this ),
			closestPointToPoint: getClosestPointToPointFn( this ),
			sampleTrianglePoint: null,
		}, proxyFn );

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

		return getShapecastFn( this, options );

	}

	/**
	 * Rebuilds all GPU storage buffers from the current scene state. Must be called at least
	 * once before using `this.storage` or `this.fns` in a shader, and again whenever the
	 * scene topology changes (objects added/removed, geometry modified).
	 */
	update() {

		// free any buffers from a previous update before swapping in the new ones
		this.dispose();

		const { attributes, structs, bvh } = this;

		// collect the BVHs
		const bvhInfo = [];
		const transformInfo = [];

		// accumulate the sizes of the bvh nodes buffer, number of objects, and geometry buffers
		let bvhNodesBufferLength = getTotalBVHByteLength( bvh );
		let indexBufferLength = 0;
		let attributesBufferLength = 0;
		const { primitiveBuffer, primitiveBufferStride } = bvh;
		for ( let i = 0, l = primitiveBuffer.length; i < l; i += primitiveBufferStride ) {

			const compositeId = primitiveBuffer[ i ];
			const compositeNodeId = primitiveBuffer[ i + 1 ];
			const object = bvh.objects[ bvh.getObjectId( compositeId ) ];
			const instanceId = bvh.getInstanceId( compositeId );
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

			// each primitive ( a single instance or cluster ) maps to one transform. A cluster points
			// at a subtree node within its object's BVH root; an instance references the whole root.
			const data = bvhInfo.find( info => primBvh === info.bvh );
			const isInstance = bvh.isInstance( object );
			const root = isInstance ? 0 : bvh.getBVHRootIndex( compositeNodeId );
			const clusterNodeOffset = isInstance ? 0 : bvh.getBVHNodeIndex( compositeNodeId ) / UINT32_PER_NODE;

			transformInfo.push( {
				data,
				root,
				clusterNodeOffset,
				object,
				instanceId,
				compositeId,
			} );

		}

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
		appendBVHData( bvh, 0, 0, bvhNodesBuffer, true );
		nodeWriteOffset += getTotalBVHByteLength( bvh ) / BYTES_PER_NODE;
		bvhInfo.forEach( info => {

			// append bvh data
			const bvhNodeOffsets = appendBVHData( info.bvh, indexOffset / 3, nodeWriteOffset, bvhNodesBuffer, false );
			info.bvhNodeOffsets = bvhNodeOffsets;

			// append geometry data
			appendIndexData( info.bvh, info.range, attributesOffset, indexOffset, indexBuffer );
			appendGeometryData( info.bvh, info.range, attributesOffset, attributesBuffer, attributeStruct, this );
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

		// depends on the resolved attribute struct, so it must be built here rather than up front
		this.fns.sampleTrianglePoint = getSampleTrianglePointFn( this );

		this._bvhCache.clear();

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

		const { object, instanceId, root, clusterNodeOffset, data } = info;
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

		// write node offset - the cluster's subtree root within the packed BLAS ( the BLAS root for
		// instances, where clusterNodeOffset is 0 )
		transformBufferU32[ writeOffset * structs.transform.getLength() + 32 ] = bvhNodeOffsets[ root ] + clusterNodeOffset;

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

			storage[ key ].value?.dispose();
			delete storage[ key ];

		}

	}

}


// A container whose string members are returned as stable proxy nodes. Assigning a member stores
// the underlying node.
// TODO: we should automatically infer a proxy node vs fn. Perhaps in r185 we won't need the difference?
class NodeProxyObject {

	constructor( initialization = {}, createProxy = proxy ) {

		const proxies = {};

		// the raw backing object holds the underlying nodes and is the proxy target. "createProxy"
		// selects the proxy variant - "proxy" for plain nodes, "proxyFn" for callable function nodes.
		return new Proxy( { ...initialization }, {

			get( target, property ) {

				if ( ! proxies[ property ] ) {

					proxies[ property ] = createProxy( property, target );

				}

				return proxies[ property ];

			},

			set( target, property, value ) {

				target[ property ] = value;
				return true;

			},

		} );

	}

}
