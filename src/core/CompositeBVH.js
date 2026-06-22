/** @import { Object3D } from 'three' */
import { ObjectBVH } from './ObjectBVH.js';

/**
 * A single-level BVH whose leaves can hold a mix of primitive types - individual triangles
 * (for "static" geometry, stored in their owning object's local space) and object instances
 * (for "dynamic" / shared geometry, traversed through a per-object transform). This avoids the
 * overlap slowdowns of a rigid two-level TLAS-over-instances structure on dense, interpenetrating
 * scenes while still allowing instanced geometry to be shared rather than duplicated.
 *
 * Each plain `Mesh` contributes one triangle primitive per triangle; `InstancedMesh` /
 * `BatchedMesh` (and any non-mesh object) contribute one object primitive per instance. Leaves are
 * kept homogeneous - a leaf is either all object primitives or all triangles of a single object -
 * so the type and owning object can be resolved per leaf. All primitive bounds are computed in the
 * BVH frame, but triangle vertices remain in local space so they can be transformed at the leaf.
 *
 * @note Internal: this extends {@link ObjectBVH} with triangle support and is currently used only
 * by the WebGPU `BVHComputeData` path. It is not part of the public API.
 *
 * @param {Object3D | Array<Object3D>} root - Root object or array of objects.
 * @param {Object} [options] - Same options as {@link ObjectBVH}.
 * @extends ObjectBVH
 */
export class CompositeBVH extends ObjectBVH {

	constructor( root, options = {} ) {

		// allow triangles to group into leaves rather than the object-only default of one per leaf
		super( root, { maxLeafSize: 10, ...options } );

	}

	// plain meshes are inlined as individual triangle primitives; everything else stays an object
	_isTriangleSource( object ) {

		return Boolean( object.isMesh && ! object.isInstancedMesh && ! object.isBatchedMesh && object.geometry );

	}

}
