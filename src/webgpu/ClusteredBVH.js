import { Matrix4, Box3 } from 'three';
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
const _matrix = /* @__PURE__ */ new Matrix4();

export class ClusteredBVH extends BVH {

	constructor( root, options ) {

		super();

		options = {
			getBVH: ( object, instance ) => {

				// function must be deterministic
				throw new Error( 'ClusteredBVH: getBVH callback must be provided ' );

			},
			shouldCluster: object => {

				// TODO: name this something different, adjust the default behavior?
				return object.isSkinnedMesh || object.isInstancedMesh || object.isBatchedMesh;

			},
			primitiveLimit: 64,
			matrixWorld: Array.isArray( root ) ? new Matrix4() : root.matrixWorld,
			includeInstances: true,

			// force 1 object per leaf
			_strictLeafSize: 1,

			...options,
		};

		const objects = Array.from( collectObjects( root ) );
		const idBits = Math.ceil( Math.log2( objects.length ) );
		const idMask = ( 1 << idBits ) - 1;

		// options
		this.objects = objects;
		this.getBVH = options.getBVH;
		this.shouldCluster = options.shouldCluster;
		this.includeInstances = options.includeInstances;
		this.primitiveLimit = options.primitiveLimit;
		this.matrixWorld = options.matrixWorld;

		// local
		this.bvhMap = new WeakMap();
		this.idBits = idBits;
		this.idMask = idMask;
		this.primitiveBufferStride = 2;

		this.init( options );

	}

	init( options ) {

		let total = 0;
		const { objects, bvhMap, matrixWorld } = this;

		// pre-cache the inverse matrix for use in the "getPrimitiveBoundingBox" function
		_inverseMatrix.copy( matrixWorld ).invert();

		objects.forEach( object => {

			// resolve and retain a bvh per instance - the "getBVH" function is expected to return the same
			// instance given the same inputs, in addition to any shared instances. A falsy entry excludes that
			// instance from the tree.
			const bvhList = [];
			for ( let instance = 0, count = this._getInstanceCount( object ); instance < count; instance ++ ) {

				const bvh = this.getBVH( object, instance );
				bvhList.push( bvh );
				if ( bvh ) {

					// "instance" objects are referenced whole, everything else is subdivided into clusters
					total += this.shouldCluster( object ) ? bvh._roots.length : this._countRelevantLeafNodes( bvh );

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

				throw new Error( `ClusteredBVH: cluster node index ${ nodeIndex } exceeds the ${ NODE_INDEX_BITS }-bit packing limit and cannot be represented.` );

			}

			if ( r > ROOT_INDEX_MASK ) {

				throw new Error( `ClusteredBVH: bvh root index ${ r } exceeds the ${ ROOT_INDEX_BITS }-bit packing limit and cannot be represented.` );

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

				if ( this.shouldCluster( object ) ) {

					// referenced whole - one primitive per bvh root, entered at node 0
					for ( let r = 0, rl = bvh._roots.length; r < rl; r ++ ) {

						pushPrimitive( instance, objectIndex, r, 0 );

					}

				} else {

					// subdivided into clusters - one primitive per cluster cut point
					_traverseClusters( bvh, primitiveLimit, ( r, node32Index ) => {

						pushPrimitive( instance, objectIndex, r, node32Index / UINT32_PER_NODE );

					} );

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

				console.warn( `ClusteredBVH: a leaf node with ${ count } primitives exceeds the cluster primitive limit of ${ primitiveLimit } and cannot be subdivided further.` );

			}

		} );

		return total;

	}

}

// runs the provided callback for every node that meets the primitive limit.
// TODO: this is slow - it would be best to cache these bounds sizes once first
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

// collects all mesh instances
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
