/**
 * Count how many times a ray cast from the given point crosses the segments.
 * @param {THREE.Vector3} point
 * @param {Array<THREE.Line3>} segments
 * @returns {number}
 */
export function pointRayCrossesSegments( point, segments ) {

	let crossings = 0;
	const firstSeg = segments[ segments.length - 1 ];
	let prevDirection = firstSeg.start.y > firstSeg.end.y;
	for ( let s = 0, l = segments.length; s < l; s ++ ) {

		const line = segments[ s ];
		const thisDirection = line.start.y > line.end.y;
		if ( pointRayCrossesLine( point, line, prevDirection, thisDirection ) ) {

			crossings ++;

		}

		prevDirection = thisDirection;

	}

	return crossings;

}

/**
 * Check if the given point is inside the given polygon.
 * @param {THREE.Vector3} point
 * @param {Array<THREE.Line3>} polygon
 * @returns {boolean}
 */
export function isPointInsidePolygon( point, polygon ) {

	return pointRayCrossesSegments( point, polygon ) % 2 === 1;

}

function pointRayCrossesLine( point, line, prevDirection, thisDirection ) {

	const { start, end } = line;
	const px = point.x;
	const py = point.y;

	const sy = start.y;
	const ey = end.y;

	if ( sy === ey ) return false;

	if ( py > sy && py > ey ) return false; // above
	if ( py < sy && py < ey ) return false; // below

	const sx = start.x;
	const ex = end.x;
	if ( px > sx && px > ex ) return false; // right
	if ( px < sx && px < ex ) {

		// left

		if ( py === sy && prevDirection !== thisDirection ) {

			return false;

		}

		return true;

	}

	// check the side
	const dx = ex - sx;
	const dy = ey - sy;
	const perpx = dy;
	const perpy = - dx;

	const pdx = px - sx;
	const pdy = py - sy;

	const dot = perpx * pdx + perpy * pdy;

	if ( Math.sign( dot ) !== Math.sign( perpx ) ) {

		return true;

	}

	return false;

}
