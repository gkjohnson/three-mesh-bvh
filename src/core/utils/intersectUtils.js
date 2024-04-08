export function BatchedRay() {

	const origin = new Float64Array( 3 );
	const dirInv = new Float64Array( 3 );
	const sign = new Int8Array( 3 );

	function setFromRay( ray ) {

		origin[ 0 ] = ray.origin.x;
		origin[ 1 ] = ray.origin.y;
		origin[ 2 ] = ray.origin.z;
	
		dirInv[ 0 ] = 1 / ray.direction.x;
		dirInv[ 1 ] = 1 / ray.direction.y;
		dirInv[ 2 ] = 1 / ray.direction.z;
	
		sign[ 0 ] = dirInv[ 0 ] < 0 ? 3 : 0;
		sign[ 1 ] = dirInv[ 1 ] < 0 ? 3 : 0;
		sign[ 2 ] = dirInv[ 2 ] < 0 ? 3 : 0;

	}

	function intersectBox( nodeIndex32, array ) {

		let bmin = array[ nodeIndex32 + sign[ 0 ] ];
		let bmax = array[ nodeIndex32 + ( sign[ 0 ] + 3 ) % 6 ];
	
		let tmin = ( bmin - origin[ 0 ] ) * dirInv[ 0 ];
		let tmax = ( bmax - origin[ 0 ] ) * dirInv[ 0 ];
	
		bmin = array[ nodeIndex32 + sign[ 1 ] + 1 ];
		bmax = array[ nodeIndex32 + ( sign[ 1 ] + 3 ) % 6 + 1 ];
	
		const tymin = ( bmin - origin[ 1 ] ) * dirInv[ 1 ];
		if ( tymin > tmax ) return false;
	
		const tymax = ( bmax - origin[ 1 ] ) * dirInv[ 1 ];
		if ( tmin > tymax ) return false;
	
		if ( tymin > tmin ) tmin = tymin;
	
		bmin = array[ nodeIndex32 + sign[ 2 ] + 2 ];
		bmax = array[ nodeIndex32 + ( sign[ 2 ] + 3 ) % 6 + 2 ];
	
		const tzmax = ( bmax - origin[ 2 ] ) * dirInv[ 2 ];
		if ( tmin > tzmax ) return false;
	
		if ( tymax < tmax ) tmax = tymax;
		if ( tzmax < tmax ) tmax = tzmax;
	
		if ( tmax < 0 ) return false;
	
		const tzmin = ( bmin - origin[ 2 ] ) * dirInv[ 2 ];
		if ( tzmin > tmax ) return false;
	
		if ( tzmin > tmin ) tmin = tzmin;
	
		return tmin <= tmax /* && distance >= tmin */;
	
	}

	return {

		setFromRay,
		intersectBox

	};

}
