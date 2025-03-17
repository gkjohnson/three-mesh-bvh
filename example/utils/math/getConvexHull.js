/**
 * Compute a convex hull of the given points.
 *
 * Source: https://www.geeksforgeeks.org/convex-hull-set-2-graham-scan/
 * @param {Array<THREE.Vector3>} points
 * @returns {Array<THREE.Vector3>}
 */
export function getConvexHull( points ) {

	function orientation( p, q, r ) {

		const val = ( q.y - p.y ) * ( r.x - q.x ) - ( q.x - p.x ) * ( r.y - q.y );

		if ( val == 0 ) {

			return 0; // colinear

		}

		// clockwise or counterclockwise
		return val > 0 ? 1 : 2;

	}

	function distSq( p1, p2 ) {

		return ( p1.x - p2.x ) * ( p1.x - p2.x ) + ( p1.y - p2.y ) * ( p1.y - p2.y );

	}

	function compare( p1, p2 ) {

		// Find orientation
		const o = orientation( p0, p1, p2 );
		if ( o == 0 ) return distSq( p0, p2 ) >= distSq( p0, p1 ) ? - 1 : 1;

		return o == 2 ? - 1 : 1;

	}

	// find the lowest point in 2d
	let lowestY = Infinity;
	let lowestIndex = - 1;
	for ( let i = 0, l = points.length; i < l; i ++ ) {

		const p = points[ i ];
		if ( p.y < lowestY ) {

			lowestIndex = i;
			lowestY = p.y;

		}

	}

	// sort the points
	const p0 = points[ lowestIndex ];
	points[ lowestIndex ] = points[ 0 ];
	points[ 0 ] = p0;

	points = points.sort( compare );

	// filter the points
	let m = 1;
	const n = points.length;
	for ( let i = 1; i < n; i ++ ) {

		while ( i < n - 1 && orientation( p0, points[ i ], points[ i + 1 ] ) == 0 ) {

			i ++;

		}

		points[ m ] = points[ i ];
		m ++;

	}

	// early out if we don't have enough points for a hull
	if ( m < 3 ) return null;

	// generate the hull
	const hull = [ points[ 0 ], points[ 1 ], points[ 2 ] ];
	for ( let i = 3; i < m; i ++ ) {

		while (
			orientation( hull[ hull.length - 2 ], hull[ hull.length - 1 ], points[ i ] ) !== 2
		) {

			hull.pop();

		}

		hull.push( points[ i ] );

	}

	return hull;

}
