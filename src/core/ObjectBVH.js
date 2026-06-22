/** @import { Object3D } from 'three' */
import { CompositeBVH } from './CompositeBVH.js';

/**
 * BVH built from a scene hierarchy rather than a single geometry. Each leaf holds
 * one Object3D (or one instance of an InstancedMesh/BatchedMesh), enabling
 * accelerated raycasting and spatial queries across many objects at once.
 *
 * This is the object-only specialization of {@link CompositeBVH}: it never inlines
 * triangles, so every leaf primitive is an object / instance and the primitive buffer
 * stays at a stride of 1.
 *
 * @param {Object3D | Array<Object3D>} root - Root object or array of objects.
 * @param {Object} [options] - Accepts all standard BVH options plus:
 * @param {boolean} [options.precise=false] - Use vertex-level bounds instead of cached bounding boxes.
 * @param {boolean} [options.includeInstances=true] - Treat each instance of InstancedMesh/BatchedMesh as a separate primitive.
 * @extends CompositeBVH
 */
export class ObjectBVH extends CompositeBVH {

	constructor( root, options = {} ) {

		super( root, { maxLeafSize: 1, ...options } );

	}

	// objects are never expanded into individual triangle primitives
	_isTriangleSource() {

		return false;

	}

}
