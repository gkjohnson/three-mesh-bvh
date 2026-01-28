import { Box3, BufferGeometry, Matrix4, Mesh, Vector3, Ray, Sphere } from 'three';
import { BVH, INTERSECTED, NOT_INTERSECTED } from 'three-mesh-bvh';

const _geometry = /* @__PURE__ */ new BufferGeometry();
const _matrix = /* @__PURE__ */ new Matrix4();
const _inverseMatrix = /* @__PURE__ */ new Matrix4();
const _box = /* @__PURE__ */ new Box3();
const _sphere = /* @__PURE__ */ new Sphere();
const _vec = /* @__PURE__ */ new Vector3();
const _ray = /* @__PURE__ */ new Ray();
const _mesh = /* @__PURE__ */ new Mesh();
const _geometryRange = {};

// TODO: account for a "custom" object? Not necessary here? Create a more abstract foundation for this case?
export function objectAcceleratedRaycast( raycaster, intersects ) {

	if ( this.objectBoundsTree ) {

		this.objectBoundsTree.raycast( raycaster, intersects );
		return false;

	}

}

export class ObjectBVH extends BVH {

	constructor( root, options = {} ) {

		options = {
			precise: false,
			includeInstances: true,
			matrixWorld: Array.isArray( root ) ? new Matrix4() : root.matrixWorld,
			maxLeafSize: 1,
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
		this.primitiveBuffer = null;
		this.primitiveBufferStride = 1;

		// settings
		this.precise = options.precise;
		this.includeInstances = options.includeInstances;
		this.matrixWorld = options.matrixWorld;

		this.init( options );

	}

	init( options ) {

		const { objects, idBits } = this;
		this.primitiveBuffer = new Uint32Array( this._countPrimitives( objects ) );
		this._fillPrimitiveBuffer( objects, idBits, this.primitiveBuffer );

		super.init( options );

	}

	writePrimitiveBounds( i, targetBuffer, writeOffset ) {

		// TODO: it would be best to cache this matrix inversion
		const { primitiveBuffer } = this;
		_inverseMatrix.copy( this.matrixWorld ).invert();

		this._getPrimitiveBoundingBox( primitiveBuffer[ i ], _inverseMatrix, _box );
		const { min, max } = _box;

		targetBuffer[ writeOffset + 0 ] = min.x;
		targetBuffer[ writeOffset + 1 ] = min.y;
		targetBuffer[ writeOffset + 2 ] = min.z;
		targetBuffer[ writeOffset + 3 ] = max.x;
		targetBuffer[ writeOffset + 4 ] = max.y;
		targetBuffer[ writeOffset + 5 ] = max.z;

	}

	getRootRanges() {

		return [ { offset: 0, count: this.primitiveBuffer.length } ];

	}

	shapecast( callbacks ) {

		return super.shapecast( {
			...callbacks,

			intersectsPrimitive: callbacks.intersectsObject,
			scratchPrimitive: null,
			iterate: iterateOverObjects,
		} );

	}

	// TODO: this is out of sync with the MeshBVH raycast signature.
	raycast( raycaster, intersects = [] ) {

		const { matrixWorld, includeInstances } = this;
		const { firstHitOnly } = raycaster;
		const localIntersects = [];

		// transform the ray into the local bvh frame
		_inverseMatrix.copy( matrixWorld ).invert();
		_ray.copy( raycaster.ray ).applyMatrix4( _inverseMatrix );

		let closestDistance = Infinity;
		let closestHit = null;

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
			intersectsObject( object, instanceId ) {

				// skip non visible objects
				if ( ! object.visible ) {

					return;

				}

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
					_geometry.attributes.position = object.geometry.attributes.position;
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
					_geometry.attributes.position = null;
					_geometry.setDrawRange( 0, Infinity );

				} else {

					object.raycast( raycaster, localIntersects );

				}

				// find the closest hit to track
				if ( firstHitOnly ) {

					localIntersects.forEach( hit => {

						if ( hit.distance < closestDistance ) {

							closestDistance = hit.distance;
							closestHit = hit;

						}

					} );

				} else {

					intersects.push( ...localIntersects );

				}

			},
		} );

		// save the closest hit only if firstHitOnly = true
		if ( firstHitOnly && closestHit ) {

			intersects.push( closestHit );

		}

		return intersects;

	}

	// get the bounding box of a primitive node accounting for the bvh options
	_getPrimitiveBoundingBox( compositeId, inverseMatrixWorld, target ) {

		const { objects, idMask, idBits, precise, includeInstances } = this;
		const id = getObjectId( compositeId, idMask );
		const instanceId = getInstanceId( compositeId, idBits, idMask );
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
				_geometry.attributes.position = object.geometry.attributes.position;
				_geometry.setDrawRange( geometryRange.start, geometryRange.count );

				object
					.getMatrixAt( instanceId, _matrix );

				_matrix
					.premultiply( object.matrixWorld )
					.premultiply( inverseMatrixWorld );

				getPreciseBounds( _geometry, _matrix, target );

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

	// counts the total number of primitives required by the objects in given array of objects
	_countPrimitives( objects ) {

		const { includeInstances } = this;
		let total = 0;
		objects.forEach( object => {

			if ( object.isInstancedMesh && includeInstances ) {

				total += object.count;

			} else if ( object.isBatchedMesh && includeInstances ) {

				total += object.instanceCount;

			} else {

				total ++;

			}

		} );

		return total;

	}

	_fillPrimitiveBuffer( objects, idBits, target ) {

		const { includeInstances } = this;
		let index = 0;
		objects.forEach( ( object, i ) => {

			if ( object.isInstancedMesh && includeInstances ) {

				const count = object.count;
				for ( let c = 0; c < count; c ++ ) {

					target[ index ] = ( c << idBits ) | i;
					index ++;

				}

			} else if ( object.isBatchedMesh && includeInstances ) {

				const { instanceCount, maxInstanceCount } = object;
				let instance = 0;
				let iter = 0;
				// TODO: use a better check here, like "maxInstanceCount"
				while ( instance < instanceCount && iter < maxInstanceCount ) {

					iter ++;

					// TODO: it would be better to have a consistent way of querying whether an
					// instance were active
					try {

						object.getVisibleAt( instance );

						target[ index ] = ( instance << idBits ) | i;
						instance ++;
						index ++;

					} catch {

						//

					}

				}

			} else {

				target[ index ] = i;
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

// iterator helper for raycasting
function iterateOverObjects( offset, count, bvh, callback, contained, depth, /* scratch */ ) {

	const { primitiveBuffer, objects, idMask, idBits } = bvh;
	for ( let i = offset, l = count + offset; i < l; i ++ ) {

		const compositeId = primitiveBuffer[ i ];
		const id = getObjectId( compositeId, idMask );
		const instanceId = getInstanceId( compositeId, idBits, idMask );
		const object = objects[ id ];
		if ( callback( object, instanceId, contained, depth ) ) {

			return true;

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
