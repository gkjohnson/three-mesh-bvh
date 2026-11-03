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
