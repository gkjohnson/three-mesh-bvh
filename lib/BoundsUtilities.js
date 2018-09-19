// Returns a Float32Array representing the bounds data for the sphere
// and box. Assumes that both bounds are centered about the same spot
// and that the box min and max are equal distance in every dimension
function boundsToArray( bx, sp ) {

	const arr = new Float64Array( 4 );
	arr[ 0 ] = sp.radius;

	arr[ 1 ] = sp.center.x;
	arr[ 2 ] = sp.center.y;
	arr[ 3 ] = sp.center.z;

	arr[ 4 ] = bx.max.x - sp.center.x;
	arr[ 5 ] = bx.max.y - sp.center.y;
	arr[ 6 ] = bx.max.z - sp.center.z;

	return arr;

}

function arrayToSphere( arr, target ) {

	target.radius = arr[ 0 ];
	target.center.x = arr[ 1 ];
	target.center.y = arr[ 2 ];
	target.center.z = arr[ 3 ];

	return target;

}

function arrayToBox( arr, target ) {

	target.min.x = arr[ 1 ] - arr[ 4 ];
	target.min.y = arr[ 2 ] - arr[ 5 ];
	target.min.z = arr[ 3 ] - arr[ 6 ];

	target.max.x = arr[ 1 ] + arr[ 4 ];
	target.max.y = arr[ 2 ] + arr[ 5 ];
	target.max.z = arr[ 3 ] + arr[ 6 ];

	return target;

}

export { boundsToArray, arrayToBox, arrayToSphere };
