/** @import { Object3D, BufferGeometry } from 'three' */
/** @import { IntersectsBoundsCallback, IntersectsRangeCallback, BoundsTraverseOrderCallback } from './BVH.js' */
/** @import { ObjectBVH } from './ObjectBVH.js' */
import { Box3, BufferGeometry, Matrix4, Mesh, Vector3, Ray, Sphere } from 'three';
import { BVH } from './BVH.js';
import { INTERSECTED, NOT_INTERSECTED } from './Constants.js';

// sentinel stored in the second primitive word to mark an entry as an object / instance
// primitive rather than a triangle. A geometry can never have this many triangles so it is
// safe to use as a flag.
const OBJECT_PRIMITIVE_FLAG = 0xffffffff;

const _geometry = /* @__PURE__ */ new BufferGeometry();
const _matrix = /* @__PURE__ */ new Matrix4();
const _inverseMatrix = /* @__PURE__ */ new Matrix4();
const _box = /* @__PURE__ */ new Box3();
const _sphere = /* @__PURE__ */ new Sphere();
const _vec = /* @__PURE__ */ new Vector3();
const _ray = /* @__PURE__ */ new Ray();
const _mesh = /* @__PURE__ */ new Mesh();
const _geometryRange = {};
const _v0 = /* @__PURE__ */ new Vector3();
const _v1 = /* @__PURE__ */ new Vector3();
const _v2 = /* @__PURE__ */ new Vector3();
const _point = /* @__PURE__ */ new Vector3();

/**
 * @callback IntersectsObjectCallback
 * @param {Object3D} object - The scene object whose bounds were intersected.
 * @param {number} instanceId - Instance index for InstancedMesh/BatchedMesh, or 0 for regular objects.
 * @param {boolean} contained - Whether the node bounds are fully contained by the query shape.
 * @param {number} depth - The depth of the node in the tree.
 * @returns {boolean} Return `true` to stop traversal.
 */

/**
 * @callback IntersectsTriangleCallback
 * @param {Object3D} object - The mesh that owns the triangle.
 * @param {number} triangleIndex - Index of the triangle within the owning geometry.
 * @param {boolean} contained - Whether the node bounds are fully contained by the query shape.
 * @param {number} depth - The depth of the node in the tree.
 * @returns {boolean} Return `true` to stop traversal.
 */

/**
 * A single-level BVH whose leaves can hold a mix of primitive types - individual triangles
 * (for "static" geometry, stored in their owning object's local space) and object instances
 * (for "dynamic" / shared geometry, traversed through a per-object transform). This avoids the
 * overlap slowdowns of a rigid two-level TLAS-over-instances structure on dense, interpenetrating
 * scenes while still allowing instanced geometry to be shared rather than duplicated.
 *
 * Primitives are stored in `primitiveBuffer`. When the scene contains any triangle sources the
 * stride is 2:
 * - word 0: composite id - `( instanceId << idBits ) | objectId`
 * - word 1: triangle index within the owning geometry, or `OBJECT_PRIMITIVE_FLAG` for an
 *   object / instance primitive.
 *
 * When the scene contains only object primitives (see {@link ObjectBVH}) the second word is
 * omitted and the stride is 1, so no memory is spent on a type tag that is implicitly constant.
 *
 * Each plain `Mesh` contributes one triangle primitive per triangle; `InstancedMesh` /
 * `BatchedMesh` (and any non-mesh object) contribute one object primitive per instance. All
 * primitive bounds are computed in the BVH frame, but triangle vertices remain in local space so
 * the GPU can transform them at the leaf.
 *
 * @param {Object3D | Array<Object3D>} root - Root object or array of objects.
 * @param {Object} [options] - Accepts all standard BVH options plus:
 * @param {boolean} [options.precise=false] - Use vertex-level bounds for object primitives instead of cached bounding boxes.
 * @param {boolean} [options.includeInstances=true] - Treat each instance of InstancedMesh/BatchedMesh as a separate primitive.
 * @extends BVH
 */
export class CompositeBVH extends BVH {

	constructor( root, options = {} ) {

		options = {
			precise: false,
			includeInstances: true,
			matrixWorld: Array.isArray( root ) ? new Matrix4() : root.matrixWorld,
			...options,
		};

		super();

		// collect all the leaf node objects in the geometries
		const objectSet = new Set();
		collectObjects( root, objectSet );

		// calculate the number of bits required for the primary id, leaving the remainder
		// for the instanceId count
		const objects = Array.from( objectSet );
		const idBits = Math.ceil( Math.log2( objects.length ) );
		const idMask = constructIdMask( idBits );

		this.objects = objects;
		this.idBits = idBits;
		this.idMask = idMask;

		// settings
		this.precise = options.precise;
		this.includeInstances = options.includeInstances;
		this.matrixWorld = options.matrixWorld;

		// only spend a second primitive word on the triangle / object type tag when the scene
		// actually contains triangle primitives
		this.hasTriangles = objects.some( object => this._isTriangleSource( object ) );
		this.primitiveBuffer = null;
		this.primitiveBufferStride = this.hasTriangles ? 2 : 1;

		this.init( options );

	}

	/**
	 * Returns the `Object3D` associated with a composite id.
	 * @param {number} compositeId
	 * @returns {Object3D}
	 */
	getObjectFromId( compositeId ) {

		const { idMask, objects } = this;
		return objects[ getObjectId( compositeId, idMask ) ];

	}

	/**
	 * Returns the instance index associated with a composite id.
	 * @param {number} compositeId
	 * @returns {number}
	 */
	getInstanceFromId( compositeId ) {

		const { idMask, idBits } = this;
		return getInstanceId( compositeId, idBits, idMask );

	}

	init( options ) {

		const { objects, idBits } = this;
		const primitiveCount = this._countPrimitives( objects );
		this.primitiveBuffer = new Uint32Array( primitiveCount * this.primitiveBufferStride );
		this._fillPrimitiveBuffer( objects, idBits, this.primitiveBuffer );

		super.init( options );

	}

	writePrimitiveBounds( i, targetBuffer, writeOffset ) {

		// TODO: it would be best to cache this matrix inversion
		const { primitiveBuffer, primitiveBufferStride, hasTriangles } = this;
		_inverseMatrix.copy( this.matrixWorld ).invert();

		const compositeId = primitiveBuffer[ i * primitiveBufferStride ];
		const triangleIndex = hasTriangles ? primitiveBuffer[ i * primitiveBufferStride + 1 ] : OBJECT_PRIMITIVE_FLAG;

		if ( triangleIndex === OBJECT_PRIMITIVE_FLAG ) {

			this._getObjectBoundingBox( compositeId, _inverseMatrix, _box );

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

	getRootRanges() {

		return [ { offset: 0, count: this.primitiveBuffer.length / this.primitiveBufferStride } ];

	}

	/**
	 * Performs a spatial query against the BVH. Extends the base `shapecast` with separate
	 * callbacks for the two leaf primitive types.
	 *
	 * @param {Object} callbacks
	 * @param {IntersectsBoundsCallback} callbacks.intersectsBounds
	 * @param {IntersectsObjectCallback} [callbacks.intersectsObject]
	 * @param {IntersectsTriangleCallback} [callbacks.intersectsTriangle]
	 * @param {IntersectsRangeCallback} [callbacks.intersectsRange]
	 * @param {BoundsTraverseOrderCallback} [callbacks.boundsTraverseOrder]
	 * @returns {boolean}
	 */
	shapecast( callbacks ) {

		const { intersectsObject = null, intersectsTriangle = null } = callbacks;
		return super.shapecast( {
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

	raycast( raycaster, intersects = [] ) {

		const { matrixWorld, includeInstances } = this;
		const { firstHitOnly } = raycaster;
		const localIntersects = [];

		// transform the ray into the local bvh frame
		_inverseMatrix.copy( matrixWorld ).invert();
		_ray.copy( raycaster.ray ).applyMatrix4( _inverseMatrix );

		let closestDistance = Infinity;
		let closestHit = null;

		const trackHit = hit => {

			if ( firstHitOnly ) {

				if ( hit.distance < closestDistance ) {

					closestDistance = hit.distance;
					closestHit = hit;

				}

			} else {

				intersects.push( hit );

			}

		};

		this.shapecast( {
			boundsTraverseOrder: box => {

				return box.distanceToPoint( _ray.origin );

			},
			intersectsBounds: box => {

				if ( firstHitOnly ) {

					if ( ! _ray.intersectBox( box, _vec ) ) {

						return NOT_INTERSECTED;

					}

					// early out if the box is further than the closest raycast
					_vec.applyMatrix4( matrixWorld );
					return raycaster.ray.origin.distanceTo( _vec ) < closestDistance ? INTERSECTED : NOT_INTERSECTED;

				} else {

					return _ray.intersectsBox( box ) ? INTERSECTED : NOT_INTERSECTED;

				}

			},
			intersectsTriangle: ( object, triangleIndex ) => {

				if ( ! object.visible ) {

					return;

				}

				// transform the triangle into world space and intersect directly
				getTriangleVertices( object.geometry, triangleIndex, _v0, _v1, _v2 );
				_v0.applyMatrix4( object.matrixWorld );
				_v1.applyMatrix4( object.matrixWorld );
				_v2.applyMatrix4( object.matrixWorld );

				if ( raycaster.ray.intersectTriangle( _v0, _v1, _v2, false, _point ) ) {

					trackHit( {
						distance: raycaster.ray.origin.distanceTo( _point ),
						point: _point.clone(),
						object,
						faceIndex: triangleIndex,
					} );

				}

			},
			intersectsObject: ( object, instanceId ) => {

				// skip non visible objects
				if ( ! object.visible ) {

					return;

				}

				localIntersects.length = 0;

				if ( object.isInstancedMesh && includeInstances ) {

					// raycast the instance
					_mesh.geometry = object.geometry;
					_mesh.material = object.material;

					object.getMatrixAt( instanceId, _mesh.matrixWorld );
					_mesh.matrixWorld.premultiply( object.matrixWorld );
					_mesh.raycast( raycaster, localIntersects );

					localIntersects.forEach( hit => {

						hit.object = object;
						hit.instanceId = instanceId;

					} );

					_mesh.material = null;

				} else if ( object.isBatchedMesh && includeInstances ) {

					if ( ! object.getVisibleAt( instanceId ) ) {

						return;

					}

					// extract the geometry & material
					const geometryId = object.getGeometryIdAt( instanceId );
					const geometryRange = object.getGeometryRangeAt( geometryId, _geometryRange );

					_geometry.index = object.geometry.index;
					_geometry.attributes = object.geometry.attributes;
					_geometry.setDrawRange( geometryRange.start, geometryRange.count );

					_mesh.geometry = _geometry;
					_mesh.material = object.material;

					// perform a raycast against the proxy mesh
					object.getMatrixAt( instanceId, _mesh.matrixWorld );
					_mesh.matrixWorld.premultiply( object.matrixWorld );
					_mesh.raycast( raycaster, localIntersects );

					// fix up the fields
					localIntersects.forEach( hit => {

						hit.object = object;
						hit.batchId = instanceId;

					} );

					_mesh.material = null;
					_geometry.index = null;
					_geometry.attributes = null;
					_geometry.setDrawRange( 0, Infinity );

				} else {

					object.raycast( raycaster, localIntersects );

				}

				localIntersects.forEach( trackHit );

			},
		} );

		// save the closest hit only if firstHitOnly = true
		if ( firstHitOnly && closestHit ) {

			intersects.push( closestHit );

		}

		return intersects;

	}

	// whether the object contributes individual triangle primitives rather than an object primitive
	_isTriangleSource( object ) {

		return Boolean( object.isMesh && ! object.isInstancedMesh && ! object.isBatchedMesh && object.geometry );

	}

	// compute the bounds of a single triangle primitive in the BVH frame
	_getTriangleBoundingBox( compositeId, triangleIndex, inverseMatrixWorld, target ) {

		const object = this.getObjectFromId( compositeId );

		// local -> bvh frame
		_matrix
			.copy( object.matrixWorld )
			.premultiply( inverseMatrixWorld );

		getTriangleVertices( object.geometry, triangleIndex, _v0, _v1, _v2 );

		target.makeEmpty();
		target.expandByPoint( _v0.applyMatrix4( _matrix ) );
		target.expandByPoint( _v1.applyMatrix4( _matrix ) );
		target.expandByPoint( _v2.applyMatrix4( _matrix ) );

	}

	// compute the bounds of an object / instance primitive in the BVH frame
	_getObjectBoundingBox( compositeId, inverseMatrixWorld, target ) {

		const { idMask, idBits, precise, includeInstances } = this;
		const instanceId = getInstanceId( compositeId, idBits, idMask );
		const object = this.getObjectFromId( compositeId );

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

	// counts the total number of primitives required by the objects in the given array
	_countPrimitives( objects ) {

		const { includeInstances } = this;
		let total = 0;
		objects.forEach( object => {

			if ( this._isTriangleSource( object ) ) {

				total += getTriangleCount( object.geometry );

			} else if ( object.isInstancedMesh && includeInstances ) {

				total += object.count;

			} else if ( object.isBatchedMesh && includeInstances ) {

				if ( ! ( 'instanceCount' in object ) ) {

					throw new Error( 'CompositeBVH: Three.js revision >= r169 is required to use BatchedMesh.' );

				}

				total += object.instanceCount;

			} else {

				total ++;

			}

		} );

		return total;

	}

	_fillPrimitiveBuffer( objects, idBits, target ) {

		const { includeInstances, primitiveBufferStride, hasTriangles } = this;

		// write an object / instance primitive at the given primitive index
		const writeObject = ( index, compositeId ) => {

			target[ index * primitiveBufferStride ] = compositeId;
			if ( hasTriangles ) {

				target[ index * primitiveBufferStride + 1 ] = OBJECT_PRIMITIVE_FLAG;

			}

		};

		let index = 0;
		objects.forEach( ( object, i ) => {

			if ( this._isTriangleSource( object ) ) {

				const triangleCount = getTriangleCount( object.geometry );
				for ( let t = 0; t < triangleCount; t ++ ) {

					target[ index * primitiveBufferStride ] = i;
					target[ index * primitiveBufferStride + 1 ] = t;
					index ++;

				}

			} else if ( object.isInstancedMesh && includeInstances ) {

				const count = object.count;
				for ( let c = 0; c < count; c ++ ) {

					writeObject( index, ( c << idBits ) | i );
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

						writeObject( index, ( iter << idBits ) | i );
						foundInstances ++;
						index ++;

					} catch {

						//

					}

					iter ++;

				}

			} else {

				writeObject( index, i );
				index ++;

			}

		} );

	}

}

// id functions
// construct a mask with the given number of bits set to 1
function constructIdMask( idBits ) {

	let mask = 0;
	for ( let i = 0; i < idBits; i ++ ) {

		mask = mask << 1 | 1;

	}

	return mask;

}

// extract the primary object id given the provided mask
function getObjectId( id, idMask ) {

	return id & idMask;

}

// extract the instance id given the mask and number of bits to shift
function getInstanceId( id, idBits, idMask ) {

	return ( id & ( ~ idMask ) ) >> idBits;

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

// traverse the full scene and collect all leaves
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

// iterator helper for shapecast, dispatching each primitive to the appropriate callback
function iterateOverPrimitives( offset, count, bvh, callback, contained, depth, /* scratch */ ) {

	const { primitiveBuffer, idMask, idBits, primitiveBufferStride, hasTriangles } = bvh;
	for ( let i = offset, l = count + offset; i < l; i ++ ) {

		const compositeId = primitiveBuffer[ i * primitiveBufferStride ];
		const triangleIndex = hasTriangles ? primitiveBuffer[ i * primitiveBufferStride + 1 ] : OBJECT_PRIMITIVE_FLAG;
		const object = bvh.objects[ getObjectId( compositeId, idMask ) ];

		if ( triangleIndex === OBJECT_PRIMITIVE_FLAG ) {

			const instanceId = getInstanceId( compositeId, idBits, idMask );
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

function shrinkToSphere( box, sphere ) {

	_vec.copy( sphere.center ).addScalar( - sphere.radius );
	box.min.max( _vec );

	_vec.copy( sphere.center ).addScalar( sphere.radius );
	box.max.min( _vec );

}
