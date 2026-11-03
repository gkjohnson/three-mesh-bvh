/** @import { Node } from 'three/webgpu' */
/** @import { BVHComputeData } from '../BVHComputeData.js' */
import { float } from 'three/tsl';
import { wgslTagFn } from '../nodes/WGSLTagFnNode.js';
import { rayStruct, bvhNodeBoundsStruct } from '../tsl/structs.js';

// returns the distance along the ray to the bounds, or -1 if the ray misses them
export const rayBoundsDistance = wgslTagFn/* wgsl */`
	fn bvh_rayBoundsDistance( ray: ${ rayStruct }, bounds: ${ bvhNodeBoundsStruct } ) -> f32 {

		let boundsMin = vec3( bounds.min[0], bounds.min[1], bounds.min[2] );
		let boundsMax = vec3( bounds.max[0], bounds.max[1], bounds.max[2] );

		// Avoid 0 * infinity for rays parallel to a slab and on its boundary.
		let parallel = ray.direction == vec3f( 0.0 );
		if ( any( parallel & ( ( ray.origin < boundsMin ) | ( ray.origin > boundsMax ) ) ) ) {

			return - 1.0;

		}

		let invDir = 1.0 / select( ray.direction, vec3f( 1.0 ), parallel );
		let tMinPlane = ( boundsMin - ray.origin ) * invDir;
		let tMaxPlane = ( boundsMax - ray.origin ) * invDir;

		// parallel axes never limit the slab interval
		const FLT_MAX = 3.402823e38;
		let tMinHit = select( min( tMinPlane, tMaxPlane ), vec3f( - FLT_MAX ), parallel );
		let tMaxHit = select( max( tMinPlane, tMaxPlane ), vec3f( FLT_MAX ), parallel );

		let t0 = max( max( tMinHit.x, tMinHit.y ), tMinHit.z );
		let t1 = min( min( tMaxHit.x, tMaxHit.y ), tMaxHit.z );

		let dist = max( t0, 0.0 );
		return select( dist, - 1.0, t1 < dist );

	}
`;

const _rayTransformFns = new WeakMap();

/**
 * Returns the functions that move a ray into and out of an object's local space. They are created
 * once per BVHComputeData so the ray queries share them and a shader using several of them
 * declares each function once.
 *
 * @private
 * @param {BVHComputeData} bvhData
 * @returns {{ scratchRayScalar: Node, transformShapeFn: Function, resetShapeFn: Function }}
 */
export function getRayTransformFns( bvhData ) {

	if ( _rayTransformFns.has( bvhData ) ) {

		return _rayTransformFns.get( bvhData );

	}

	// these are proxy nodes, so they can be referenced before the storage buffers exist
	const { transforms } = bvhData.storage;

	// scales local space ray distances back to world space
	const scratchRayScalar = float( 1.0 ).toVar( `bvh_rayScalar_${ Math.random().toString( 36 ).substring( 2, 7 ) }` );

	const result = {
		scratchRayScalar,
		transformShapeFn: wgslTagFn/* wgsl */`
			fn transformRay( ray: ptr<function, ${ rayStruct }>, objectIndex: u32 ) -> void {

				let toLocal = ${ transforms }[ objectIndex ].inverseMatrixWorld;
				ray.origin = ( toLocal * vec4f( ray.origin, 1.0 ) ).xyz;
				ray.direction = ( toLocal * vec4f( ray.direction, 0.0 ) ).xyz;

				let len = length( ray.direction );
				ray.direction /= len;
				${ scratchRayScalar } = 1.0 / len;

			}
		`,
		resetShapeFn: wgslTagFn/* wgsl */`
			fn resetRayScalar( objectIndex: u32 ) -> void {

				${ scratchRayScalar } = 1.0;

			}
		`,
	};

	_rayTransformFns.set( bvhData, result );
	return result;

}
