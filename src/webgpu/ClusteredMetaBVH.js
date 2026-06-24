import { Matrix4 } from 'three';
import { BVH } from '../core/BVH.js';
import { BVHTraversalHelper } from '../core/BVHTraversalHelper.js';

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

		this.idBits = idBits;
		this.idMask = idMask;

		this.init( options );

	}

	init( options ) {

		let total = 0;
		const { objects, bvhMap } = this;
		objects.forEach( object => {

			if ( this.isInstance( object ) ) {

				// TODO: support falling back to "instance" based on the number
				// of times a geometry is reused
				total += this._getInstanceCount( object );

			} else {

				// TODO: support batched mesh, etc for non-instanced meshes
				const bvh = this.getBVH( object, 0 );
				bvhMap.set( object, bvh );
				total += this._countRelevantLeafNodes( bvh );

			}

		} );

		this.primitiveBuffer = new Uint32Array( total * 2 );

		super.init( options );

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
		if ( object.isInstancedMesh ) {

			return object.count;

		} else if ( object.isBatchedMesh ) {

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
					primitiveBuffer[ 2 * offset + 1 ] = - 1;

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
