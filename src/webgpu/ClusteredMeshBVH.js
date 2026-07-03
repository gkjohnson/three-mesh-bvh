import { Matrix4, Box3, Sphere, BufferGeometry, Vector3 } from 'three';
import { BVH } from '../core/BVH.js';
import { BVHTraversalHelper } from '../core/BVHTraversalHelper.js';
import { UINT32_PER_NODE } from '../core/Constants.js';
import { arrayToBox } from '../utils/ArrayBoxUtilities.js';

// the second primitive word packs the owning bvh root index above the node index, which occupies
// the low NODE_INDEX_BITS bits.
const NODE_INDEX_BITS = 24;
const NODE_INDEX_MASK = ( 1 << NODE_INDEX_BITS ) - 1;
const ROOT_INDEX_BITS = 31 - NODE_INDEX_BITS;
const ROOT_INDEX_MASK = ( 1 << ROOT_INDEX_BITS ) - 1;

const _inverseMatrix = /* @__PURE__ */ new Matrix4();
const _box =/* @__PURE__ */ new Box3();
const _geometry = /* @__PURE__ */ new BufferGeometry();
const _matrix = /* @__PURE__ */ new Matrix4();
const _sphere = /* @__PURE__ */ new Sphere();
const _vec = /* @__PURE__ */ new Vector3();
const _geometryRange = {};

export class ClusteredMeshBVH extends BVH {

	constructor( root, options ) {

		super();

		options = {
			getBVH: () => {

				throw new Error();

			},
			isInstance: object => {

				return object.isSkinnedMesh || object.isInstancedMesh || object.isBatchedMesh;

			},
			primitiveLimit: 64,
			matrixWorld: Array.isArray( root ) ? new Matrix4() : root.matrixWorld,
			includeInstances: true,
			precise: false,

			// force 1 object per leaf
			_strictLeafSize: 1,

			...options,
		};

		const objects = Array.from( collectObjects( root ) );
		const idBits = Math.ceil( Math.log2( objects.length ) );
		const idMask = ( 1 << idBits ) - 1;

		this.getBVH = options.getBVH;
		this.isInstance = options.isInstance;
		this.objects = objects;
		this.bvhMap = new WeakMap();
		this.primitiveBufferStride = 2;
		this.primitiveLimit = options.primitiveLimit;
		this.matrixWorld = options.matrixWorld;
		this.precise = options.precise;

		this.idBits = idBits;
		this.idMask = idMask;

		this.init( options );

	}

	init( options ) {

		let total = 0;
		const { objects, bvhMap, matrixWorld } = this;

		// pre-cache the inverse matrix for use in the "getPrimitiveBoundingBox" function
		_inverseMatrix.copy( matrixWorld ).invert();

		objects.forEach( object => {

			// resolve and retain a bvh per instance - InstancedMesh instances share one, while
			// BatchedMesh instances may each differ. A falsy entry excludes that instance from the tree.
			const bvhList = [];
			for ( let instance = 0, count = this._getInstanceCount( object ); instance < count; instance ++ ) {

				const bvh = this.getBVH( object, instance );
				bvhList.push( bvh );
				if ( bvh ) {

					// "instance" objects are referenced whole, everything else is subdivided into clusters
					total += this.isInstance( object ) ? bvh._roots.length : this._countRelevantLeafNodes( bvh );

				}

			}

			bvhMap.set( object, bvhList );

		} );

		this.primitiveBuffer = new Uint32Array( total * 2 );
		this._fillPrimitiveBuffer( this.primitiveBuffer );

		super.init( options );

	}

	getRootRanges() {

		return [ { offset: 0, count: this.primitiveBuffer.length / this.primitiveBufferStride } ];

	}

	refit( ...args ) {

		// pre-cache the inverse matrix for use in the "getPrimitiveBoundingBox" function
		_inverseMatrix.copy( this.matrixWorld ).invert();

		super.refit( ...args );

	}

	writePrimitiveBounds( i, targetBuffer, writeOffset ) {

		const { primitiveBuffer, bvhMap, objects } = this;

		const compositeId = primitiveBuffer[ 2 * i + 0 ];
		const compositeNodeId = primitiveBuffer[ 2 * i + 1 ];
		const object = objects[ this.getObjectId( compositeId ) ];
		const instanceId = this.getInstanceId( compositeId );
		const bvh = bvhMap.get( object )[ instanceId ];

		// word1 packs the owning bvh root index and the cluster node index
		const root = this.getBVHRootIndex( compositeNodeId );
		const node32Index = this.getBVHNodeIndex( compositeNodeId );

		// the world matrix of this instance - InstancedMesh / BatchedMesh use their per-instance
		// matrix - brought into the meta-bvh frame
		if ( object.isInstancedMesh || object.isBatchedMesh ) {

			object.getMatrixAt( instanceId, _matrix );
			_matrix.premultiply( object.matrixWorld );

		} else {

			_matrix.copy( object.matrixWorld );

		}

		_matrix.premultiply( _inverseMatrix );

		// the cluster node bounds are in the bvh's local space - transform them into the meta-bvh frame
		// TODO: it would be best to not create a new float32array here over and over
		arrayToBox( node32Index, new Float32Array( bvh._roots[ root ] ), _box );
		_box.applyMatrix4( _matrix );

		const { min, max } = _box;

		targetBuffer[ writeOffset + 0 ] = min.x;
		targetBuffer[ writeOffset + 1 ] = min.y;
		targetBuffer[ writeOffset + 2 ] = min.z;
		targetBuffer[ writeOffset + 3 ] = max.x;
		targetBuffer[ writeOffset + 4 ] = max.y;
		targetBuffer[ writeOffset + 5 ] = max.z;

	}

	// get the bounding box of a primitive node accounting for the bvh options
	_getPrimitiveBoundingBox( compositeId, inverseMatrixWorld, target ) {

		const { objects, precise, includeInstances } = this;
		const id = this.getObjectId( compositeId );
		const instanceId = this.getInstanceId( compositeId );
		const object = objects[ id ];

		if ( ! includeInstances && ( object.isInstancedMesh || object.isBatchedMesh ) ) {

			// if we're not using instances then just account for the overall bounds of the BatchedMesh and InstancedMesh
			if ( ! object.boundingBox ) {

				object.computeBoundingBox();

			}

			if ( ! object.boundingSphere ) {

				object.computeBoundingSphere();

			}

			_matrix
				.copy( object.matrixWorld )
				.premultiply( inverseMatrixWorld );

			_sphere
				.copy( object.boundingSphere )
				.applyMatrix4( _matrix );

			target
				.copy( object.boundingBox )
				.applyMatrix4( _matrix );

			shrinkToSphere( target, _sphere );

		} else if ( precise ) {

			// calculate precise bounds if necessary by calculating the bounds of all vertices
			// in the bvh frame
			if ( object.isInstancedMesh ) {

				object
					.getMatrixAt( instanceId, _matrix );

				_matrix
					.premultiply( object.matrixWorld )
					.premultiply( inverseMatrixWorld );

				getPreciseBounds( object.geometry, _matrix, target );

			} else if ( object.isBatchedMesh ) {

				const geometryId = object.getGeometryIdAt( instanceId );
				const geometryRange = object.getGeometryRangeAt( geometryId, _geometryRange );

				_geometry.index = object.geometry.index;
				_geometry.attributes = object.geometry.attributes;
				_geometry.setDrawRange( geometryRange.start, geometryRange.count );

				object
					.getMatrixAt( instanceId, _matrix );

				_matrix
					.premultiply( object.matrixWorld )
					.premultiply( inverseMatrixWorld );

				getPreciseBounds( _geometry, _matrix, target );

				_geometry.attributes = null;

			} else {

				_matrix
					.copy( object.matrixWorld )
					.premultiply( inverseMatrixWorld );

				target.setFromObject( object, true ).applyMatrix4( inverseMatrixWorld );

			}

		} else {

			// otherwise use the fast path of extracting the cached, AABB bounds and transforming them
			// into the local BVH frame
			if ( object.isInstancedMesh ) {

				if ( ! object.geometry.boundingBox ) {

					object.geometry.computeBoundingBox();

				}

				if ( ! object.geometry.boundingSphere ) {

					object.geometry.computeBoundingSphere();

				}

				object
					.getMatrixAt( instanceId, _matrix );

				_matrix
					.premultiply( object.matrixWorld )
					.premultiply( inverseMatrixWorld );

				_sphere
					.copy( object.geometry.boundingSphere )
					.applyMatrix4( _matrix );

				target
					.copy( object.geometry.boundingBox )
					.applyMatrix4( _matrix );

				shrinkToSphere( target, _sphere );

			} else if ( object.isBatchedMesh ) {

				const geometryId = object.getGeometryIdAt( instanceId );

				object
					.getMatrixAt( instanceId, _matrix );

				_matrix
					.premultiply( object.matrixWorld )
					.premultiply( inverseMatrixWorld );

				object
					.getBoundingSphereAt( geometryId, _sphere )
					.applyMatrix4( _matrix );

				object
					.getBoundingBoxAt( geometryId, target )
					.applyMatrix4( _matrix );

				shrinkToSphere( target, _sphere );

			} else {

				target
					.setFromObject( object, false )
					.applyMatrix4( inverseMatrixWorld );

			}

		}

	}

	getInstanceId( id ) {

		const { idMask, idBits } = this;
		return ( id & ( ~ idMask ) ) >>> idBits;

	}

	getObjectId( id ) {

		const { idMask } = this;
		return id & idMask;

	}

	getBVHRootIndex( compositeNodeId ) {

		return compositeNodeId >>> NODE_INDEX_BITS;

	}

	getBVHNodeIndex( compositeNodeId ) {

		return ( compositeNodeId & NODE_INDEX_MASK ) * UINT32_PER_NODE;

	}

	_getInstanceCount( object ) {

		// TODO: can we share this with ObjectBVH?
		const { includeInstances } = this;
		if ( object.isInstancedMesh && includeInstances ) {

			return object.count;

		} else if ( object.isBatchedMesh && includeInstances ) {

			return object.instanceCount;

		} else {

			return 1;

		}

	}

	_fillPrimitiveBuffer( primitiveBuffer ) {

		const { objects, bvhMap, idBits, primitiveLimit } = this;
		let offset = 0;

		const pushPrimitive = ( instance, objectIndex, r, nodeIndex ) => {

			if ( nodeIndex > NODE_INDEX_MASK ) {

				throw new Error( `ClusteredMetaBVH: cluster node index ${ nodeIndex } exceeds the ${ NODE_INDEX_BITS }-bit packing limit and cannot be represented.` );

			}

			if ( r > ROOT_INDEX_MASK ) {

				throw new Error( `ClusteredMetaBVH: bvh root index ${ r } exceeds the ${ ROOT_INDEX_BITS }-bit packing limit and cannot be represented.` );

			}

			primitiveBuffer[ 2 * offset + 0 ] = ( instance << idBits ) | objectIndex;
			primitiveBuffer[ 2 * offset + 1 ] = ( r << NODE_INDEX_BITS ) | ( nodeIndex & NODE_INDEX_MASK );
			offset ++;

		};

		objects.forEach( ( object, objectIndex ) => {

			bvhMap.get( object ).forEach( ( bvh, instance ) => {

				if ( ! bvh ) {

					return;

				}

				if ( this.isInstance( object ) ) {

					// referenced whole - one primitive per bvh root, entered at node 0
					for ( let r = 0, rl = bvh._roots.length; r < rl; r ++ ) {

						pushPrimitive( instance, objectIndex, r, 0 );

					}

				} else {

					// subdivided into clusters - one primitive per cluster cut point
					_traverseClusters( bvh, primitiveLimit, ( r, node32Index ) => pushPrimitive( instance, objectIndex, r, node32Index / UINT32_PER_NODE ) );

				}

			} );

		} );

	}

	_countRelevantLeafNodes( bvh ) {

		const { primitiveLimit } = this;
		let total = 0;
		_traverseClusters( bvh, primitiveLimit, ( r, node32Index, count, isLeaf ) => {

			total ++;

			if ( isLeaf && count >= primitiveLimit ) {

				console.warn( `ClusteredMetaBVH: a leaf node with ${ count } primitives exceeds the cluster primitive limit of ${ primitiveLimit } and cannot be subdivided further.` );

			}

		} );

		return total;

	}

}

// invokes "callback( rootIndex, node32Index, count, isLeaf )" for every cluster cut point in the
// bvh - the highest node in each subtree whose primitive count is below "primitiveLimit", plus any
// leaf that exceeds the limit and so cannot be subdivided further.
function _traverseClusters( bvh, primitiveLimit, callback ) {

	const rootCount = bvh._roots.length;
	for ( let r = 0; r < rootCount; r ++ ) {

		BVHTraversalHelper.setBVH( bvh, r );
		BVHTraversalHelper.traverseBuffer( ( depth, isLeaf, node32Index ) => {

			const start = BVHTraversalHelper.getRangeStart( node32Index );
			const end = BVHTraversalHelper.getRangeEnd( node32Index );
			const count = end - start;

			if ( count < primitiveLimit || isLeaf ) {

				callback( r, node32Index, count, isLeaf );
				return true;

			}

			return false;

		} );

	}

	BVHTraversalHelper.reset();

}

function collectObjects( root, objectSet = new Set() ) {

	if ( Array.isArray( root ) ) {

		root.forEach( object => collectObjects( object, objectSet ) );

	} else {

		root.traverse( child => {

			// NOTE: This only works with meshes for now
			if ( child.isMesh ) {

				objectSet.add( child );

			}

		} );

	}

	return objectSet;

}

function shrinkToSphere( box, sphere ) {

	_vec.copy( sphere.center ).addScalar( - sphere.radius );
	box.min.max( _vec );

	_vec.copy( sphere.center ).addScalar( sphere.radius );
	box.max.min( _vec );

}

// calculate precise box bounds of the given geometry in the given frame
function getPreciseBounds( geometry, matrix, target ) {

	target.makeEmpty();

	const drawRange = geometry.drawRange;
	const indexAttr = geometry.index;
	const posAttr = geometry.attributes.position;
	const start = drawRange.start;
	const vertCount = indexAttr ? indexAttr.count : posAttr.count;
	const count = Math.min( vertCount - start, drawRange.count );
	for ( let i = start, l = start + count; i < l; i ++ ) {

		let vi = i;
		if ( indexAttr ) {

			vi = indexAttr.getX( vi );

		}

		_vec.fromBufferAttribute( posAttr, vi ).applyMatrix4( matrix );
		target.expandByPoint( _vec );

	}

	return target;

}
