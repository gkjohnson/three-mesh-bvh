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
	objectRecordStruct,
} from './tsl/structs.js';
import { appendBVHData, appendBVHSubtree, appendIndexData, appendGeometryData, getAttributeLayout, getSubtreeNodeCount, getRootPrimitiveRange, getMaxNodeDepth, GPU_BYTES_PER_NODE } from './utils/packBVHBufferUtils.js';
import { getShapecastFn } from './shapecastFns/getShapecastFn.js';
import { getRaycastAnyHitFn } from './shapecastFns/getRaycastAnyHitFn.js';
import { getRaycastFirstHitFn } from './shapecastFns/getRaycastFirstHitFn.js';
import { getSampleTrianglePointFn } from './shapecastFns/getSampleTrianglePointFn.js';
import { getTriangleIndicesFn, getVertexFn, getVertexPositionFn } from './shapecastFns/getVertexFn.js';
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

function getTotalBVHNodeCount( bvh ) {

	return bvh._roots.reduce( ( v, root ) => v + root.byteLength / BYTES_PER_NODE, 0 );

}

function getTransformKey( compositeId, root ) {

	return `${ compositeId }_${ root }`;

}

/**
 * Where an object is packed in the storage buffers, as returned by `BVHComputeData.getObjectInfo` and
 * `BVHComputeData.getAllObjectInfo`.
 *
 * @typedef {Object} ObjectInfo
 * @property {Object3D} object - The mesh.
 * @property {number} instanceId - Instance index (relevant for InstancedMesh / BatchedMesh).
 * @property {number} group - Index of the geometry group, each of which is packed as its own object.
 * @property {number} objectIndex - Index of the object's record in `storage.objects`. Hits report it as `objectIndex`.
 * @property {number} indexOffset - Where the index data of the object's geometry starts in `storage.geometry`,
 *   in 32-bit words. Shared by the objects of a geometry's groups.
 * @property {number} attributesOffset - Where the vertex attributes of the object's geometry start in
 *   `storage.geometry`, in 32-bit words.
 * @property {number} primitiveOffset - The object's first primitive, counted from the start of its geometry's
 *   index data. Non-zero for a geometry group after the first.
 * @property {number} primitiveCount - The number of primitives in the object.
 */

/**
 * Packs one or more scene objects into GPU-accessible BVH buffers (TLAS + BLAS) for use
 * in WebGPU compute shaders via the Three.js TSL node system. After construction, call
 * {@link BVHComputeData#update} to populate the storage buffers, then reference
 * `this.storage` and `this.fns` in your compute shader nodes.
 *
 * `this.fns` provides the following WGSL functions:
 * - `raycastFirstHit( ray, &hit ) -> bool`: finds the closest ray / triangle intersection.
 * - `raycastAnyHit( ray ) -> bool`: occlusion query that returns as soon as any triangle is hit.
 * - `closestPointToPoint`: finds the closest point on the scene's triangles to a point.
 * - `getTriangleIndices( triIndex, indexOffset ) -> vec3u`: reads the vertex indices of a triangle.
 * - `getVertex( index, attributesOffset ) -> bvh_GeometryStruct`: reads the attributes of a vertex. The index and
 *   attribute data share one internal buffer whose packing may change, so read them through these.
 * - `getVertexPosition( index, attributesOffset ) -> vec3f`: reads only the position of a vertex, for custom traversal.
 * - `sampleTrianglePoint( barycoord, indices, attributesOffset ) -> bvh_GeometryStruct`: interpolates a triangle's attributes.
 *
 * Triangle and vertex indices, including those of a hit, are relative to the geometry of the object
 * they belong to. The offsets to read them with are the `indexOffset` and `attributesOffset` of the
 * object's record in `storage.objects`, eg `objects[ hit.objectIndex ].attributesOffset`.
 *
 * `this.attributeLayout` describes how a vertex is packed in `storage.geometry` once `update` has run: the
 * vertex `stride` and the `offset` and `size` of each attribute, in 32-bit words.
 *
 * Ray queries expect a normalized, scene-space `ray.direction` and treat triangles as two-sided.
 * A positive `ray.maxDist` excludes hits at or beyond that distance; zero means unbounded.
 * No alpha or material tests are applied.
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
	 * Type map for the interleaved per-vertex attribute buffer. Keys are geometry attribute names;
	 * values are `'f32'`, `'vec2f'`, `'vec3f'` or `'vec4f'`, or one of the packed types: `'oct16'` stores
	 * a direction and the sign of w in one word (normals, tangents) and always unpacks to a `vec4f` unit
	 * vector with w = ±1, `'2x16float'` stores two half floats in one word (uvs) and unpacks to a `vec2f`,
	 * and `'4x16float'` stores four half floats in two words (colors) and unpacks to a `vec4f`.
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

		// the packed layout of a vertex in the geometry buffer, set in "update"
		this.attributeLayout = null;

		// storage buffers and structs are populated in "update"; their members are accessed through
		// proxy nodes so the functions below can reference them up front and keep working across rebuilds
		this.storage = new NodeProxyObject();
		this.structs = new NodeProxyObject( { objectRecord: objectRecordStruct } );
		this.fns = new NodeProxyObject( {
			sampleTrianglePoint: null,
			getTriangleIndices: null,
			getVertex: null,
			getVertexPosition: null,
		}, proxyFn );

		// what "update" packed for every object record, for "getObjectInfo"
		this._packedObjects = [];

		// this needs no layout from "update"
		this.fns.getTriangleIndices = getTriangleIndicesFn( this );

		// these read through "fns.getTriangleIndices" and "fns.getVertexPosition", so "fns" must exist first
		this.fns.raycastFirstHit = getRaycastFirstHitFn( this );
		this.fns.raycastAnyHit = getRaycastAnyHitFn( this );
		this.fns.closestPointToPoint = getClosestPointToPointFn( this );

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
	 * @param {Function} options.intersectRangeFn - function node testing a leaf triangle range.
	 * Returns `NOT_INTERSECTED` (0), `INTERSECTED` (1), or `STOP_TRAVERSAL` (3, a hit that ends the entire traversal
	 * after running `transformResultFn` and `resetShapeFn`). Boolean returns remain supported: false misses and true hits without stopping.
	 * @param {Function|null} [options.transformShapeFn] - function node that transforms the shape into object local space.
	 * Returns whether to traverse the object. When returning false the shape and any per-object state must be left
	 * untouched, since `resetShapeFn` is not called for a skipped object.
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
			getBVH: ( object, instance ) => this._getBVHSync( object, instance, _range ),
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
		let bvhNodesBufferLength = getTotalBVHNodeCount( bvh ) * GPU_BYTES_PER_NODE;
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
			const primBvh = this._getBVHSync( object, instanceId, range );

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

					// where the geometry's index and attributes start in the geometry buffer, in 32-bit words
					indexOffset: 0,
					attributesOffset: 0,

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
				bvhNodesBufferLength += size * GPU_BYTES_PER_NODE;
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

		// construct the attribute struct, which is what getVertex returns. The buffer itself is packed
		// without the struct's alignment padding.
		const attributeLayout = getAttributeLayout( attributes );
		this.attributeLayout = attributeLayout;
		const attributeStruct = new StructTypeNode( Object.fromEntries( attributeLayout.members.map( m => [ m.name, m.structType ] ) ), 'bvh_GeometryStruct' );

		// Write the geometry buffer & bvh data. Every geometry gets one block, its index data followed by
		// its attributes, so the index and attributes take one storage binding and a geometry can be
		// rewritten or moved on its own. The indices are relative to the block's attributes and the leaf
		// triangle offsets to its index data.
		const attributesWordLength = attributesBufferLength * attributeLayout.stride;
		const geometryBuffer = new Uint32Array( Math.max( indexBufferLength + attributesWordLength, 2 ) );
		const bvhNodesBuffer = new ArrayBuffer( bvhNodesBufferLength );

		// pack each unique geometry ( index + attributes ) once
		let geometryWriteOffset = 0;
		bvhInfo.forEach( info => {

			const { bvh, range } = info;
			const attributesLength = range.vertexCount * attributeLayout.stride;
			info.indexOffset = geometryWriteOffset;
			info.attributesOffset = geometryWriteOffset + range.count;

			const attributesBuffer = new Float32Array( geometryBuffer.buffer, info.attributesOffset * 4, attributesLength );
			appendIndexData( bvh, range, 0, info.indexOffset, geometryBuffer );
			appendGeometryData( bvh, range, 0, attributesBuffer, attributeLayout, this );

			geometryWriteOffset += range.count + attributesLength;

		} );

		// pack only the referenced cluster subtrees into the node buffer, after the TLAS region. Each
		// subtree's write base becomes the node offset written into its TLAS leaves.
		let nodeWriteOffset = getTotalBVHNodeCount( bvh );
		subtreeInfo.forEach( subtree => {

			// A non-indirect bvh built over a sub-range stores leaf offsets from the start of the whole
			// geometry, so shift them back by the range's triangle start.
			const { bvh, range } = subtree.data;
			const triangleOffset = bvh.indirect ? 0 : - range.start / 3;
			subtree.base = nodeWriteOffset;
			appendBVHSubtree( bvh._roots[ subtree.root ], subtree.node, subtree.size, triangleOffset, nodeWriteOffset, bvhNodesBuffer );
			nodeWriteOffset += subtree.size;

		} );

		// resolve each TLAS leaf's node offset now that the subtree bases are known, then pack the TLAS
		primitiveInfo.forEach( info => info.nodeOffset = info.subtree.base );
		appendBVHData( bvh, primitiveInfo, 0, bvhNodesBuffer );

		//

		const transformArrayBuffer = new ArrayBuffer( structs.objectRecord.getLength() * transformBufferLength * 4 );

		//

		// set up the storage buffers
		// if itemSize for StorageBufferAttribute == arraySize,
		// then buffer is treated not as array of structs, but as a single struct
		// And that breaks code. For now itemSize = 1 does not seem to break anything
		const bvhNodesStorage = storage( new StorageBufferAttribute( new Uint32Array( bvhNodesBuffer ), 1 ), bvhNodeStruct ).toReadOnly().setName( 'bvh_nodes' );
		const transformsBuffer = new StorageBufferAttribute( new Uint32Array( transformArrayBuffer ), 1 );
		const objectsStorage = storage( transformsBuffer, structs.objectRecord ).toReadOnly().setName( 'bvh_objects' );
		const geometryStorage = storage( new StorageBufferAttribute( geometryBuffer, 1 ), 'uint' ).toReadOnly().setName( 'bvh_geometry' );

		this.storage.objects = objectsStorage;
		this.storage.nodes = bvhNodesStorage;
		this.storage.geometry = geometryStorage;
		this.structs.attributes = attributeStruct;

		// record what was packed for every object record, for "writeObjectRecord" and "getObjectInfo"
		const packedObjects = [];
		transformMap.forEach( ( { object, instanceId, root, slot } ) => {

			packedObjects[ slot ] = { object, instanceId, root, data: null, primitiveRange: null };

		} );

		primitiveInfo.forEach( info => {

			packedObjects[ info.transformSlot ].data = info.subtree.data;

		} );

		this._packedObjects = packedObjects;

		// writes every object record
		_inverseMatrix.copy( bvh.matrixWorld ).invert();
		transformMap.forEach( info => {

			this.writeObjectRecord( info, _inverseMatrix, info.slot, transformArrayBuffer );

		} );

		// these depend on the resolved attribute layout, so they must be built here rather than up front
		this.fns.getVertex = getVertexFn( this, attributeLayout );
		this.fns.getVertexPosition = getVertexPositionFn( this, attributeLayout );
		this.fns.sampleTrianglePoint = getSampleTrianglePointFn( this );

		// clear our cache for now. In the future we will need to keep this around.
		this._bvhCache.clear();

	}

	/**
	 * Like {@link BVHComputeData#update} but awaits {@link BVHComputeData#getBVH} for every
	 * object and instance first, so an override may build the BVHs asynchronously as long as it
	 * returns the built BVH synchronously afterward. The BVHs are all requested at once.
	 * @returns {Promise<void>}
	 */
	async updateAsync() {

		const promises = [];
		this.getRootObject().traverse( object => {

			if ( ! object.isMesh ) {

				return;

			}

			let instanceCount = 1;
			if ( object.isInstancedMesh ) {

				instanceCount = object.count;

			} else if ( object.isBatchedMesh ) {

				instanceCount = object.instanceCount;

			}

			for ( let instanceId = 0; instanceId < instanceCount; instanceId ++ ) {

				promises.push( this.getBVH( object, instanceId, _range ) );

			}

		} );

		await Promise.all( promises );
		this.update();

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

		const transformsAttribute = storage.objects.proxyNode.value;
		const transformArrayBuffer = transformsAttribute.array.buffer;
		_inverseMatrix.copy( bvh.matrixWorld ).invert();
		this._getTransformMap( bvh ).forEach( info => {

			this.writeObjectRecord( info, _inverseMatrix, info.slot, transformArrayBuffer );

		} );

		transformsAttribute.needsUpdate = true;

	}

	/**
	 * Writes one object record into a raw ArrayBuffer: the world/inverse-world matrices, the
	 * visibility flag, and where the object's geometry starts in `storage.geometry`. Override this
	 * in a subclass to write additional per-object data (e.g. material index) into members added
	 * after the base record's.
	 *
	 * @param {{object:Object3D,instanceId:number,compositeId:number,root:number,slot:number}} info - The object, its instance index, and the slot its record is written to.
	 * @param {Matrix4} premultiplyMatrix - Matrix pre-multiplied onto the object's world matrix (usually the inverse TLAS root matrix).
	 * @param {number} writeOffset - Index of the record to write into.
	 * @param {ArrayBuffer} targetBuffer - Destination buffer.
	 */
	writeObjectRecord( info, premultiplyMatrix, writeOffset, targetBuffer ) {

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
		_matrix.toArray( transformBufferF32, writeOffset * structs.objectRecord.getLength() );

		// write inverse transform
		_matrix.invert();
		_matrix.toArray( transformBufferF32, writeOffset * structs.objectRecord.getLength() + 16 );

		let visible = isObjectVisible( object );
		if ( object.isBatchedMesh ) {

			visible = visible && object.getVisibleAt( instanceId );

		}

		transformBufferU32[ writeOffset * structs.objectRecord.getLength() + 32 ] = visible ? 1 : 0;

		// write where the object's geometry starts in the geometry buffer
		// TODO: the member offsets are hardcoded since three.js's StructTypeNode doesn't expose or cache
		// them, and computing them per record is too slow. Use them once three.js provides them.
		const { indexOffset, attributesOffset } = this._packedObjects[ writeOffset ].data;
		transformBufferU32[ writeOffset * structs.objectRecord.getLength() + 33 ] = indexOffset;
		transformBufferU32[ writeOffset * structs.objectRecord.getLength() + 34 ] = attributesOffset;

	}

	/**
	 * Returns the BVH for a given object/instance, populating `rangeTarget` with the
	 * corresponding index and vertex ranges within the packed geometry buffers. Override
	 * to support custom BVH types or caching strategies. With {@link BVHComputeData#updateAsync}
	 * an override may return a promise while the BVH is being built, and the BVH itself once
	 * it is.
	 *
	 * @param {Object3D} object - The object to generate a BVH for.
	 * @param {number} instanceId - Instance index (relevant for InstancedMesh / BatchedMesh).
	 * @param {{start:number,count:number,vertexStart:number,vertexCount:number}} rangeTarget - Populated with the object's geometry range.
	 * @returns {MeshBVH|SkinnedMeshBVH|null|Promise<MeshBVH|SkinnedMeshBVH|null>}
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
	 * Returns where an object was packed by the last {@link BVHComputeData#update}, or null if it was not.
	 *
	 * @param {Object3D} object - The mesh.
	 * @param {number} [instanceId=0] - Instance index (relevant for InstancedMesh / BatchedMesh).
	 * @param {number} [group=0] - Index of the geometry group, each of which is packed as its own object.
	 * @returns {ObjectInfo|null}
	 */
	getObjectInfo( object, instanceId = 0, group = 0 ) {

		const objectIndex = this._packedObjects.findIndex( packed => {

			return packed.object === object && packed.instanceId === instanceId && packed.root === group;

		} );

		if ( objectIndex === - 1 ) {

			return null;

		}

		return this._getObjectInfoAt( objectIndex );

	}

	/**
	 * Returns where every object was packed by the last {@link BVHComputeData#update}, in object index order.
	 *
	 * @returns {Array<ObjectInfo>}
	 */
	getAllObjectInfo() {

		return this._packedObjects.map( ( _, objectIndex ) => this._getObjectInfoAt( objectIndex ) );

	}

	_getObjectInfoAt( objectIndex ) {

		const packed = this._packedObjects[ objectIndex ];
		const { object, instanceId, root } = packed;
		const { bvh, range, indexOffset, attributesOffset } = packed.data;
		if ( packed.primitiveRange === null ) {

			packed.primitiveRange = getRootPrimitiveRange( bvh._roots[ root ] );

		}

		// A non-indirect bvh built over a sub-range stores leaf offsets from the start of the whole
		// geometry, which are shifted back by the range's triangle start when packed.
		const primitiveShift = bvh.indirect ? 0 : - range.start / 3;
		return {
			object,
			instanceId,
			group: root,
			objectIndex,
			indexOffset,
			attributesOffset,
			primitiveOffset: packed.primitiveRange.offset + primitiveShift,
			primitiveCount: packed.primitiveRange.count,
		};

	}

	/**
	 * Returns the default vec4 value written to the attribute buffer for vertices that lack
	 * a given attribute. Override to change per-attribute defaults.
	 *
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

	// "getBVH" with a check that an async override has finished building
	_getBVHSync( object, instanceId, rangeTarget ) {

		const bvh = this.getBVH( object, instanceId, rangeTarget );
		if ( bvh instanceof Promise ) {

			throw new Error( 'BVHComputeData: "getBVH" returned a promise. Use "updateAsync" instead.' );

		}

		return bvh;

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
