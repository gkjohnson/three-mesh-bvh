import { Matrix4, Box3, Sphere, BufferGeometry, Vector3 } from 'three';
import { BVH } from '../core/BVH.js';
import { BVHTraversalHelper } from '../core/BVHTraversalHelper.js';
import { arrayToBox } from '../utils/ArrayBoxUtilities.js';

// sentinel stored in the second primitive word to mark an entry as an object / instance
// primitive rather than a cluster node.
const OBJECT_PRIMITIVE_FLAG = 0xffffffff;

const _inverseMatrix = /* @__PURE__ */ new Matrix4();
const _box =/* @__PURE__ */ new Box3();
const _geometry = /* @__PURE__ */ new BufferGeometry();
const _matrix = /* @__PURE__ */ new Matrix4();
const _sphere = /* @__PURE__ */ new Sphere();
const _vec = /* @__PURE__ */ new Vector3();
const _geometryRange = {};

export class ClusteredMetaBVH extends BVH {

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
			maxLeafSize: 1,
			includeInstances: true,
			precise: false,
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

			if ( this.isInstance( object ) ) {

				// TODO: support falling back to "instance" based on the number
				// of times a geometry is reused
				bvhMap.set( object, null );
				total += this._getInstanceCount( object );

			} else {

				// TODO: support batched mesh, etc for non-instanced meshes
				const bvh = this.getBVH( object, 0 );
				bvhMap.set( object, bvh );
				total += this._countRelevantLeafNodes( bvh );

			}

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

		// TODO: it would be best to cache this matrix inversion - we know WHEN this will
		// be called (eg refit, rebuild?) so we can update the cached value ahead?
		const { primitiveBuffer, bvhMap, objects } = this;

		const id = primitiveBuffer[ 2 * i + 0 ];
		const node32Index = primitiveBuffer[ 2 * i + 1 ];
		if ( node32Index === OBJECT_PRIMITIVE_FLAG ) {

			// instance

			this._getPrimitiveBoundingBox( id, _inverseMatrix, _box );

		} else {

			// TODO: it would be best to not create a new float32array here over and over
			const root = this.getBVHRoot( id );
			const objectId = this.getObjectId( id );
			const object = objects[ objectId ];
			const bvh = bvhMap.get( object );

			// the cluster node bounds are in the object's local space - transform them through the
			// object's world matrix and into the bvh frame
			_matrix
				.copy( object.matrixWorld )
				.premultiply( _inverseMatrix );

			// TODO: how can we easily create a tighter bound here if we want precise bounds?
			arrayToBox( node32Index, new Float32Array( bvh._roots[ root ] ), _box );
			_box.applyMatrix4( _matrix );

		}

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
		return ( id & ( ~ idMask ) ) >> idBits;

	}

	getObjectId( id ) {

		const { idMask } = this;
		return id & idMask;

	}

	getBVHRoot( id ) {

		return this.getInstanceId( id );

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
		objects.forEach( ( object, objectIndex ) => {

			const bvh = bvhMap.get( object );
			if ( bvh === null ) {

				for ( let instance = 0, l = this._getInstanceCount( object ); instance < l; instance ++ ) {

					primitiveBuffer[ 2 * offset + 0 ] = ( instance << idBits ) | objectIndex;
					primitiveBuffer[ 2 * offset + 1 ] = OBJECT_PRIMITIVE_FLAG;

					offset ++;

				}

			} else {

				const rootCount = bvh._roots.length;
				for ( let r = 0; r < rootCount; r ++ ) {

					BVHTraversalHelper.setBVH( bvh, r );
					BVHTraversalHelper.traverseBuffer( ( depth, isLeaf, node32Index ) => {

						const start = BVHTraversalHelper.getRangeStart( node32Index );
						const end = BVHTraversalHelper.getRangeEnd( node32Index );
						const count = end - start;

						if ( count < primitiveLimit || isLeaf ) {

							primitiveBuffer[ 2 * offset + 0 ] = ( r << idBits ) | objectIndex;
							primitiveBuffer[ 2 * offset + 1 ] = node32Index;

							offset ++;

							return true;

						}

						return false;

					} );

				}

				BVHTraversalHelper.reset();

			}

		} );

	}

	_countRelevantLeafNodes( bvh ) {

		let total = 0;
		const primitiveLimit = this.primitiveLimit;
		const rootCount = bvh._roots.length;
		for ( let i = 0; i < rootCount; i ++ ) {

			BVHTraversalHelper.setBVH( bvh, i );
			BVHTraversalHelper.traverseBuffer( ( depth, isLeaf, node32Index ) => {

				const start = BVHTraversalHelper.getRangeStart( node32Index );
				const end = BVHTraversalHelper.getRangeEnd( node32Index );
				const count = end - start;

				if ( count < primitiveLimit ) {

					total ++;
					return true;

				} else if ( isLeaf ) {

					total ++;
					console.warn( 'ClusteredMetaBVH: ' );
					return true;

				} else {

					return false;

				}

			} );

		}

		BVHTraversalHelper.reset();

		return total;

	}

}

function collectObjects( root, objectSet = new Set() ) {

	if ( Array.isArray( root ) ) {

		root.forEach( object => collectObjects( object, objectSet ) );

	} else {

		root.traverse( child => {

			if ( child.isMesh || child.isLine || child.isPoints ) {

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
