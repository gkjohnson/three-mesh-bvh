/**
 * Check if two line segments intersect.
 *
 * Source: https://stackoverflow.com/questions/3838329/how-can-i-check-if-two-segments-intersect
 * @param {THREE.Line3} l1
 * @param {THREE.Line3} l2
 * @returns {boolean}
 */
export function lineCrossesLine( l1, l2 ) {

	function ccw( A, B, C ) {

		return ( C.y - A.y ) * ( B.x - A.x ) > ( B.y - A.y ) * ( C.x - A.x );

	}

	const A = l1.start;
	const B = l1.end;

	const C = l2.start;
	const D = l2.end;

	return ccw( A, C, D ) !== ccw( B, C, D ) && ccw( A, B, C ) !== ccw( A, B, D );

}
