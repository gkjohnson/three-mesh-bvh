/** @import { Object3D } from 'three' */
import { Box3, Matrix4, Vector3 } from 'three';
import { BVH } from './BVH.js';
import { ObjectBVH } from './ObjectBVH.js';

// sentinel stored in the second primitive word to mark an entry as an object / instance
// primitive rather than a triangle. A geometry can never have this many triangles so it is
// safe to use as a flag.
const OBJECT_PRIMITIVE_FLAG = 0xffffffff;

const _matrix = /* @__PURE__ */ new Matrix4();
const _inverseMatrix = /* @__PURE__ */ new Matrix4();
const _box = /* @__PURE__ */ new Box3();
const _v0 = /* @__PURE__ */ new Vector3();
const _v1 = /* @__PURE__ */ new Vector3();
const _v2 = /* @__PURE__ */ new Vector3();

/**
 * @callback IntersectsTriangleCallback
 * @param {Object3D} object - The mesh that owns the triangle.
 * @param {number} triangleIndex - Index of the triangle within the owning geometry.
 * @param {boolean} contained - Whether the node bounds are fully contained by the query shape.
 * @param {number} depth - The depth of the node in the tree.
 * @returns {boolean} Return `true` to stop traversal.
 */

/**
 * Extends {@link ObjectBVH} so leaves can hold a mix of primitive types - individual triangles
 * (for "static" geometry, stored in their owning object's local space) and object instances
 * (for "dynamic" / shared geometry, traversed through a per-object transform). This avoids the
 * overlap slowdowns of a rigid two-level TLAS-over-instances structure on dense, interpenetrating
 * scenes while still allowing instanced geometry to be shared rather than duplicated.
 *
 * Each plain `Mesh` contributes one triangle primitive per triangle; everything else stays an
 * object primitive. Leaves are kept homogeneous - a leaf is either all object primitives or all
 * triangles of a single object - so the type and owning object can be resolved per leaf. When the
 * scene contains triangle primitives the `primitiveBuffer` stride is 2 ( composite id, triangle
 * index / `OBJECT_PRIMITIVE_FLAG` ); otherwise it falls back to the object-only stride of 1.
 *
 * @note Internal: this is currently used only by the WebGPU `BVHComputeData` path and is not part
 * of the public API. CPU `raycast` only reports object primitives; triangle primitives are skipped.
 *
 * @param {Object3D | Array<Object3D>} root - Root object or array of objects.
 * @param {Object} [options] - Same options as {@link ObjectBVH}.
 * @private
 * @extends ObjectBVH
 */
export class CompositeBVH extends ObjectBVH {

	constructor( root, options = {} ) {

		// allow triangles to group into leaves rather than the object-only default of one per leaf
		super( root, { maxLeafSize: 10, ...options } );

	}

	init( options ) {

		// enable triangle primitives ( a second per-primitive word ) and keep leaves homogeneous by
		// splitting mixed triangle / object ranges at build time
		this.primitiveBufferStride = 2;
		this.partitionLeaf = partitionByLeafGroup;

		// size + fill the primitive buffer accounting for the stride, then build - bypassing the
		// object-only sizing in ObjectBVH.init
		const { objects, idBits } = this;
		this.primitiveBuffer = new Uint32Array( this._countPrimitives( objects ) * this.primitiveBufferStride );
		this._fillPrimitiveBuffer( objects, idBits, this.primitiveBuffer );

		BVH.prototype.init.call( this, options );

	}

	getRootRanges() {

		return [ { offset: 0, count: this.primitiveBuffer.length / this.primitiveBufferStride } ];

	}

	writePrimitiveBounds( i, targetBuffer, writeOffset ) {

		const { primitiveBuffer, primitiveBufferStride, matrixWorld } = this;
		_inverseMatrix.copy( matrixWorld ).invert();

		const compositeId = primitiveBuffer[ i * primitiveBufferStride ];
		const triangleIndex = primitiveBuffer[ i * primitiveBufferStride + 1 ];

		if ( triangleIndex === OBJECT_PRIMITIVE_FLAG ) {

			this._getPrimitiveBoundingBox( compositeId, _inverseMatrix, _box );

		} else {

			this._getTriangleBoundingBox( compositeId, triangleIndex, _inverseMatrix, _box );

		}

		const { min, max } = _box;
		targetBuffer[ writeOffset + 0 ] = min.x;
		targetBuffer[ writeOffset + 1 ] = min.y;
		targetBuffer[ writeOffset + 2 ] = min.z;
		targetBuffer[ writeOffset + 3 ] = max.x;
		targetBuffer[ writeOffset + 4 ] = max.y;
		targetBuffer[ writeOffset + 5 ] = max.z;

	}

	/**
	 * Extends {@link ObjectBVH#shapecast} with an `intersectsTriangle` callback for triangle leaves.
	 *
	 * @param {Object} callbacks
	 * @param {IntersectsTriangleCallback} [callbacks.intersectsTriangle]
	 * @returns {boolean}
	 */
	shapecast( callbacks ) {

		const { intersectsObject = null, intersectsTriangle = null } = callbacks;

		// dispatch to the base BVH.shapecast directly to avoid ObjectBVH's object-only iterate
		return BVH.prototype.shapecast.call( this, {
			...callbacks,

			intersectsPrimitive: ( object, secondary, isTriangle, contained, depth ) => {

				if ( isTriangle ) {

					return intersectsTriangle ? intersectsTriangle( object, secondary, contained, depth ) : false;

				} else {

					return intersectsObject ? intersectsObject( object, secondary, contained, depth ) : false;

				}

			},
			scratchPrimitive: null,
			iterate: iterateOverPrimitives,
		} );

	}

	/**
	 * Whether the object contributes object / instance primitives (traversed through a per-object
	 * transform + BLAS) rather than inlined triangle primitives.
	 * @param {Object3D} object
	 * @returns {boolean}
	 */
	isInstance( object ) {

		// TODO: this should have some slightly more complicated logic behind it - eg a user specified function
		// or something like a max min number of instances.
		return Boolean( object.isMesh && ! object.isInstancedMesh && ! object.isBatchedMesh && object.geometry );

	}

	// compute the bounds of a single triangle primitive in the BVH frame
	_getTriangleBoundingBox( compositeId, triangleIndex, inverseMatrixWorld, target ) {

		// TODO: individual triangles should be able to support triangles in a batched mesh instance
		const object = this.getObjectFromId( compositeId );
		_matrix
			.copy( object.matrixWorld )
			.premultiply( inverseMatrixWorld );

		getTriangleVertices( object.geometry, triangleIndex, _v0, _v1, _v2 );

		target.makeEmpty();
		target.expandByPoint( _v0.applyMatrix4( _matrix ) );
		target.expandByPoint( _v1.applyMatrix4( _matrix ) );
		target.expandByPoint( _v2.applyMatrix4( _matrix ) );

	}

	_countPrimitives( objects ) {

		let total = 0;
		objects.forEach( object => {

			if ( this.isInstance( object ) ) {

				// reuse the object / instance counting from ObjectBVH
				total += super._countPrimitives( [ object ] );

			} else {

				total += getTriangleCount( object.geometry );

			}

		} );

		return total;

	}

	_fillPrimitiveBuffer( objects, idBits, target ) {

		const { includeInstances, primitiveBufferStride } = this;

		// write an object / instance primitive at the given primitive index
		const writeObject = ( index, instanceId, objectId ) => {

			const compositeId = ( instanceId << idBits ) | objectId;
			target[ index * primitiveBufferStride ] = compositeId;
			target[ index * primitiveBufferStride + 1 ] = OBJECT_PRIMITIVE_FLAG;

		};

		let index = 0;
		objects.forEach( ( object, i ) => {

			if ( ! this.isInstance( object ) ) {

				const triangleCount = getTriangleCount( object.geometry );
				for ( let t = 0; t < triangleCount; t ++ ) {

					target[ index * primitiveBufferStride ] = i;
					target[ index * primitiveBufferStride + 1 ] = t;
					index ++;

				}

			} else if ( object.isInstancedMesh && includeInstances ) {

				const count = object.count;
				for ( let c = 0; c < count; c ++ ) {

					writeObject( index, c, i );
					index ++;

				}

			} else if ( object.isBatchedMesh && includeInstances ) {

				const { instanceCount, maxInstanceCount } = object;
				let foundInstances = 0;
				let iter = 0;

				while ( foundInstances < instanceCount && iter < maxInstanceCount ) {

					// TODO: it would be better to have a consistent way of querying whether an
					// instance were active
					try {

						object.getVisibleAt( iter );

						writeObject( index, iter, i );
						foundInstances ++;
						index ++;

					} catch {

						//

					}

					iter ++;

				}

			} else {

				writeObject( index, 0, i );
				index ++;

			}

		} );

	}

}

// the leaf "group" a primitive belongs to. Object primitives all share one group ( they are
// resolved through the transform buffer ), while triangle primitives group by their owning object
// so each triangle leaf belongs to a single object and can be transformed by one matrix.
function getLeafGroup( buffer, stride, i ) {

	const typeWord = buffer[ i * stride + 1 ];

	// triangle entries store their owning object index in the first word ( triangles are never
	// instanced, so it is the raw object id ); object entries all collapse to the flag group.
	return typeWord === OBJECT_PRIMITIVE_FLAG ? OBJECT_PRIMITIVE_FLAG : buffer[ i * stride ];

}

// build "partitionLeaf" hook: splits a primitive range that would become a leaf so the result is
// homogeneous - either all object primitives or all triangles of a single object. Moves the first
// primitive's group to the left; the build recurses on the remainder until every leaf is one group.
function partitionByLeafGroup( buffer, stride, primitiveBounds, offset, count ) {

	const boundsOffset = primitiveBounds.offset || 0;
	const group = getLeafGroup( buffer, stride, offset );

	let split = offset;
	for ( let i = offset, l = offset + count; i < l; i ++ ) {

		if ( getLeafGroup( buffer, stride, i ) !== group ) {

			continue;

		}

		// swap primitive i down to the split boundary, keeping its words and bounds in sync
		for ( let j = 0; j < stride; j ++ ) {

			const t = buffer[ split * stride + j ];
			buffer[ split * stride + j ] = buffer[ i * stride + j ];
			buffer[ i * stride + j ] = t;

		}

		const ls = split - boundsOffset;
		const li = i - boundsOffset;
		for ( let j = 0; j < 6; j ++ ) {

			const t = primitiveBounds[ ls * 6 + j ];
			primitiveBounds[ ls * 6 + j ] = primitiveBounds[ li * 6 + j ];
			primitiveBounds[ li * 6 + j ] = t;

		}

		split ++;

	}

	return split;

}

// number of triangles in the given geometry
function getTriangleCount( geometry ) {

	const index = geometry.index;
	const position = geometry.attributes.position;
	return ( index ? index.count : position.count ) / 3;

}

// read the three vertex positions of the given triangle into a, b, c
function getTriangleVertices( geometry, triangleIndex, a, b, c ) {

	const index = geometry.index;
	const position = geometry.attributes.position;
	const i3 = triangleIndex * 3;

	const i0 = index ? index.getX( i3 + 0 ) : i3 + 0;
	const i1 = index ? index.getX( i3 + 1 ) : i3 + 1;
	const i2 = index ? index.getX( i3 + 2 ) : i3 + 2;

	a.fromBufferAttribute( position, i0 );
	b.fromBufferAttribute( position, i1 );
	c.fromBufferAttribute( position, i2 );

}

// iterator helper for shapecast, dispatching each primitive to the appropriate callback
function iterateOverPrimitives( offset, count, bvh, callback, contained, depth, /* scratch */ ) {

	const { primitiveBuffer, primitiveBufferStride } = bvh;
	for ( let i = offset, l = count + offset; i < l; i ++ ) {

		const compositeId = primitiveBuffer[ i * primitiveBufferStride ];
		const triangleIndex = primitiveBuffer[ i * primitiveBufferStride + 1 ];
		const object = bvh.getObjectFromId( compositeId );

		if ( triangleIndex === OBJECT_PRIMITIVE_FLAG ) {

			const instanceId = bvh.getInstanceFromId( compositeId );
			if ( callback( object, instanceId, false, contained, depth ) ) {

				return true;

			}

		} else {

			if ( callback( object, triangleIndex, true, contained, depth ) ) {

				return true;

			}

		}

	}

	return false;

}
