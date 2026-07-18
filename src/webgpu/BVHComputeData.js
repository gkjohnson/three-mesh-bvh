/** @import { Object3D, BufferGeometry, Vector4 } from 'three' */
import { Matrix4, Mesh, Group } from 'three';
import { StorageBufferAttribute, StructTypeNode } from 'three/webgpu';
import { storage } from 'three/tsl';
import { MeshBVH } from '../core/MeshBVH.js';
import { SkinnedMeshBVH } from '../core/SkinnedMeshBVH.js';
import { GeometryBVH } from '../core/GeometryBVH.js';
import { BYTES_PER_NODE, UINT32_PER_NODE } from '../core/Constants.js';
import { proxy, proxyFn } from './nodes/NodeProxy.js';
import {
	bvhNodeStruct,
	transformStruct,
} from './tsl/structs.js';
import { appendBVHData, appendBVHSubtree, appendIndexData, appendGeometryData, getSubtreeNodeCount, getMaxNodeDepth } from './utils/packBVHBufferUtils.js';
import { getShapecastFn } from './shapecastFns/getShapecastFn.js';
import { getRaycastFirstHitFn } from './shapecastFns/getRaycastFirstHitFn.js';
import { getSampleTrianglePointFn } from './shapecastFns/getSampleTrianglePointFn.js';
import { getClosestPointToPointFn } from './shapecastFns/getClosestPointToPointFn.js';
import { SAH } from '../core/Constants.js';
import { ClusteredBVH } from './ClusteredBVH.js';
import { BVH_STACK_DEPTH } from './tsl/constants.js';

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

function getTransformKey( compositeId, root ) {

	return `${ compositeId }_${ root }`;

}

/**
 * Packs one or more scene objects into GPU-accessible BVH buffers (TLAS + BLAS) for use
 * in WebGPU compute shaders via the Three.js TSL node system. After construction, call
 * {@link BVHComputeData#update} to populate the storage buffers, then reference
 * `this.storage` and `this.fns` in your compute shader nodes.
 *
 * @note This API is unstable and subject to change in future releases.
 *
 * @note This class requires three.js r185 or higher.
 */
export class BVHComputeData {

	/**
	 * @param {Object3D|BufferGeometry|GeometryBVH|Array} objects
	 * Scene objects to include. A single item or array of Object3D, BufferGeometry, or GeometryBVH instances are
	 * all accepted and wrapped automatically in a BVH.
	 * @param {Object} [options]
	 * @param {Record<string,string>} [options.attributes={ position: 'vec4f' }]
	 * WGSL type map for the interleaved per-vertex attribute buffer. Keys are geometry
	 * attribute names; values are WGSL type strings (e.g. `'vec3f'`, `'vec4f'`).
	 * @param {boolean} [options.autogenerateBvh=true]
	 * When true, a {@link MeshBVH} is automatically built for any object that does not
	 * already have `geometry.boundsTree` set.
	 */
	constructor( objects, options = {} ) {

		const {
			attributes = { position: 'vec4f' },
			autogenerateBvh = true,
		} = options;

		// convert the arguments to a list of objects
		if ( ! Array.isArray( objects ) ) {

			objects = [ objects ];

		}

		objects = objects.map( item => {

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

		this._bvhCache = new Map();

		this.autogenerateBvh = autogenerateBvh;
		this.attributes = attributes;
		this.objects = objects;
		this.bvh = null;

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
	 * Returns the representative root object for the scene to be constructed.
	 * @returns {Object3D}
	 */
	getRootObject() {

		// convert the arguments to a list of objects
		let { objects } = this;
		if ( objects.isObject3D ) {

			return objects;

		}

		if ( ! Array.isArray( objects ) ) {

			objects = [ objects ];

		}

		objects = objects.map( item => {

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

		const result = new Group();
		result.children = objects;
		return result;

	}

	/**
	 * Builds a WGSL shapecast function that traverses the TLAS and per-cluster BLAS in a single
	 * merged stack/loop for a custom shape type. The returned function signature is:
	 * `fn name( shape: ShapeStruct[, result: ptr<function, ResultStruct>] ) -> bool`
	 *
	 * @param {Object} options
	 * @param {string} [options.name] - Function name. Defaults to a random identifier.
	 * @param {StructTypeNode} options.shapeStruct - TSL struct or definition describing the query shape.
	 * @param {StructTypeNode|null} [options.resultStruct] - TSL struct for the accumulated result, or null.
	 * @param {Function|null} [options.prefixFn] - function node that runs before the bvh traversal - useful for resetting or initializing necessary module variables.
	 * @param {Function|null} [options.boundsOrderFn] - function node controlling left/right child traversal order.
	 * @param {Function} options.intersectsBoundsFn - function node testing the shape against a BVH node's bounds.
	 * @param {Function} options.intersectRangeFn - function node testing the shape against a leaf triangle range.
	 * @param {Function|null} [options.transformShapeFn] - function node that transforms the shape into object local space.
	 * @param {Function|null} [options.transformResultFn] - function node that transforms a hit result back to world space.
	 * @param {Function|null} [options.resetShapeFn] - function node called after each BLAS traversal to reset any per-object state set by `transformShapeFn`.
	 * @returns {Function} TSL function node for the traversal.
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

		// TODO
		// - check if the total object geometries have changed somehow. We should sort the objects to
		// a deterministic order and then check the BVH. Anything different in this case will trigger
		// a full refresh (detecting batched mesh / instance differences by geometry id + count).
		// - If the geometries are the same then we check whether they've changed (attribute versions,
		// skinned mesh bone tex versions, morph target versions). If a geometry _has_ changed then
		// the BVH needs to be refit (get BVH needs to continue to return consistent objects that are
		// of the same structure - how to confirm this? requires caching?), then it should be written
		// to the bvh nodes while refitting the TLAS.
		// - If only non-structural attributes have changed then we can just write those (eg normals)

		// TODO: we should include some kind of heuristic here for using a clustered or non-clustered
		// BVH. Something like number of leaf objects, etc?

		// "objects" may be a single item rather than an array
		const root = this.getRootObject();
		let total = 0;
		root.traverse( c => {

			// TODO: this needs to be in-sync with how clustered bvh totals count
			if ( c.isMesh ) {

				total ++;

			}

		} );

		this.bvh = new ClusteredBVH( root, {
			strategy: SAH,
			getBVH: ( object, instance ) => this.getBVH( object, instance, _range ),
			primitiveLimit: total < 3 ? Infinity : 64,
		} );

		// free any buffers from a previous update before swapping in the new ones
		this.dispose();

		const { attributes, structs, bvh } = this;

		// collect the BVHs
		const bvhInfo = [];

		// per referenced cluster subtree (deduped by bvh + root + node): { data, root, node, size, base }.
		// only these subtrees are copied into the node buffer - the upper nodes above the cluster cuts,
		// which no TLAS leaf enters, are never uploaded.
		const subtreeInfo = [];
		const subtreeMap = new Map();

		// accumulate the sizes of the bvh nodes buffer, number of objects, and geometry buffers
		let bvhNodesBufferLength = getTotalBVHByteLength( bvh );
		let indexBufferLength = 0;
		let attributesBufferLength = 0;

		// per primitive (in final tree order): the { transformSlot, subtree } for its TLAS leaf. The
		// leaf's node offset is resolved to the subtree's packed base once all subtrees are laid out.
		const primitiveInfo = [];

		// tracks the deepest packed cluster subtree for the traversal depth bound below
		let maxSubtreeDepth = 0;

		// the transform slots, derived from the same primitive buffer walk "updateTransforms" uses
		const transformMap = this._getTransformMap( bvh );

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

			// dedupe the geometry ( index + attributes ) once per bvh
			let data = bvhInfo.find( info => info.bvh === primBvh );
			if ( ! data ) {

				data = {
					index: bvhInfo.length,
					bvh: primBvh,
					range: range,

					geometryOffset: 0,

				};

				// the whole geometry is packed once per bvh; only referenced subtrees ( below ) contribute
				// to the node buffer
				indexBufferLength += data.range.count;
				attributesBufferLength += data.range.vertexCount;
				bvhInfo.push( data );

			}

			const root = bvh.getBVHRootIndex( compositeNodeId );
			const node = bvh.getBVHNodeIndex( compositeNodeId ) / UINT32_PER_NODE;

			// dedupe the referenced cluster subtree - the TLAS leaf only enters this subtree, so packing
			// just its contiguous node range skips the unreferenced upper nodes above the cut
			const subtreeKey = `${ data.index }_${ root }_${ node }`;
			let subtree = subtreeMap.get( subtreeKey );
			if ( subtree === undefined ) {

				const size = getSubtreeNodeCount( primBvh._roots[ root ], node );
				subtree = { data, root, node, size, base: 0 };
				subtreeMap.set( subtreeKey, subtree );
				subtreeInfo.push( subtree );
				bvhNodesBufferLength += size * BYTES_PER_NODE;
				maxSubtreeDepth = Math.max( maxSubtreeDepth, getMaxNodeDepth( primBvh._roots[ root ], node ) );

			}

			// nodeOffset is resolved to the subtree's packed base after the subtrees are laid out
			primitiveInfo.push( {
				transformSlot: transformMap.get( getTransformKey( compositeId, root ) ).slot,
				subtree,
			} );

		}

		// Get the max depth of the tlas traversal and infer the needed depth for the compute stack. Subtract one since
		// the TLAS leaf pushes one node instead of two.
		const tlasDepth = getMaxNodeDepth( bvh._roots[ 0 ] );
		const maxTraversalDepth = tlasDepth + maxSubtreeDepth - 1;
		if ( maxTraversalDepth > BVH_STACK_DEPTH.value ) {

			throw new Error( 'BVHComputeData: BVH depth overruns the compute stack depth.' );

		}

		//

		// @note These buffer lengths are increased to a minimum size of 2 to avoid TSL converting storage buffers
		// with length 1 being converted to a scalar value.
		// TODO: remove this when fixed in three
		const transformBufferLength = Math.max( transformMap.size, 2 );
		indexBufferLength = Math.max( indexBufferLength, 2 );
		attributesBufferLength = Math.max( attributesBufferLength, 2 );

		// construct the attribute struct
		const attributeStruct = new StructTypeNode( attributes, 'bvh_GeometryStruct' );

		// write the geometry buffer attributes & bvh data
		let attributesOffset = 0;
		let indexOffset = 0;
		const indexBuffer = new Uint32Array( indexBufferLength );
		const attributesBuffer = new ArrayBuffer( attributesBufferLength * attributeStruct.getLength() * 4 );
		const bvhNodesBuffer = new ArrayBuffer( bvhNodesBufferLength );

		// pack each unique geometry ( index + attributes ) once, recording its triangle base so the
		// referenced subtrees' leaves can be rebased into it
		bvhInfo.forEach( info => {

			info.geometryOffset = indexOffset / 3;
			appendIndexData( info.bvh, info.range, attributesOffset, indexOffset, indexBuffer );
			appendGeometryData( info.bvh, info.range, attributesOffset, attributesBuffer, attributeStruct, this );

			indexOffset += info.range.count;
			attributesOffset += info.range.vertexCount;

		} );

		// pack only the referenced cluster subtrees into the node buffer, after the TLAS region. Each
		// subtree's write base becomes the node offset written into its TLAS leaves.
		let nodeWriteOffset = getTotalBVHByteLength( bvh ) / BYTES_PER_NODE;
		subtreeInfo.forEach( subtree => {

			subtree.base = nodeWriteOffset;
			appendBVHSubtree( subtree.data.bvh._roots[ subtree.root ], subtree.node, subtree.size, subtree.data.geometryOffset, nodeWriteOffset, bvhNodesBuffer );
			nodeWriteOffset += subtree.size;

		} );

		// resolve each TLAS leaf's node offset now that the subtree bases are known, then pack the TLAS
		primitiveInfo.forEach( info => info.nodeOffset = info.subtree.base );
		appendBVHData( bvh, primitiveInfo, 0, bvhNodesBuffer );

		//

		const transformArrayBuffer = new ArrayBuffer( structs.transform.getLength() * transformBufferLength * 4 );

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

		// writes every transform
		_inverseMatrix.copy( bvh.matrixWorld ).invert();
		transformMap.forEach( info => {

			this.writeTransformData( info, _inverseMatrix, info.slot, transformArrayBuffer );

		} );

		// depends on the resolved attribute struct, so it must be built here rather than up front
		this.fns.sampleTrianglePoint = getSampleTrianglePointFn( this );

		// clear our cache for now. In the future we will need to keep this around.
		this._bvhCache.clear();

	}

	/**
	 * Refits the clustered BVH and rewrites every entry in the transform buffer from the objects'
	 * current world matrices. Call this when object transforms or visibility change but the scene
	 * topology does not. The transform slots are derived from the clustered BVH's primitive buffer,
	 * so they match those written by {@link BVHComputeData#update}.
	 */
	updateTransforms() {

		const { bvh, storage } = this;

		bvh.refit();

		// the TLAS occupies the head of the node buffer - rewrite just those nodes' bounds. A null
		// "primitiveInfo" leaves the leaf encodings, and the cluster subtrees that follow them, in place.
		const nodesAttribute = storage.nodes.proxyNode.value;
		appendBVHData( bvh, null, 0, nodesAttribute.array.buffer );
		nodesAttribute.needsUpdate = true;

		const transformsAttribute = storage.transforms.proxyNode.value;
		const transformArrayBuffer = transformsAttribute.array.buffer;
		_inverseMatrix.copy( bvh.matrixWorld ).invert();
		this._getTransformMap( bvh ).forEach( info => {

			this.writeTransformData( info, _inverseMatrix, info.slot, transformArrayBuffer );

		} );

		transformsAttribute.needsUpdate = true;

	}

	/**
	 * Writes the world/inverse-world matrices and visibility flag for one transform entry
	 * into a raw ArrayBuffer. Override this in a subclass to inject additional per-object
	 * data (e.g. material index).
	 *
	 * @private
	 * @param {Object} info - Transform entry from the internal transform map.
	 * @param {Matrix4} premultiplyMatrix - Matrix pre-multiplied onto the object's world matrix (usually the inverse TLAS root matrix).
	 * @param {number} writeOffset - Index of the transform slot to write into.
	 * @param {ArrayBuffer} targetBuffer - Destination buffer.
	 */
	writeTransformData( info, premultiplyMatrix, writeOffset, targetBuffer ) {

		const { structs } = this;
		const transformBufferF32 = new Float32Array( targetBuffer );
		const transformBufferU32 = new Uint32Array( targetBuffer );

		const { object, instanceId } = info;
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

		let visible = isObjectVisible( object );
		if ( object.isBatchedMesh ) {

			visible = visible && object.getVisibleAt( instanceId );

		}

		transformBufferU32[ writeOffset * structs.transform.getLength() + 32 ] = visible ? 1 : 0;

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

		}

	}

	// Provides a consistent, deduplicated list of the transforms from the clustered BVH
	_getTransformMap( bvh ) {

		const { primitiveBuffer, primitiveBufferStride } = bvh;
		const transformMap = new Map();

		for ( let i = 0, l = primitiveBuffer.length; i < l; i += primitiveBufferStride ) {

			const compositeId = primitiveBuffer[ i ];
			const root = bvh.getBVHRootIndex( primitiveBuffer[ i + 1 ] );
			const key = getTransformKey( compositeId, root );

			// each bvh root gets its own transform so per-group data like materials can
			// be attached. The many cluster primitives of a root all share it, so matrices
			// are not duplicated.
			if ( transformMap.has( key ) ) {

				continue;

			}

			const slot = transformMap.size;
			const object = bvh.objects[ bvh.getObjectId( compositeId ) ];
			const instanceId = bvh.getInstanceId( compositeId );
			transformMap.set( key, { object, instanceId, compositeId, root, slot } );

		}

		return transformMap;

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
