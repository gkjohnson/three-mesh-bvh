/**
 * Count how many times a ray cast from the given point crosses the segments.
 * @param {THREE.Vector3} point
 * @param {Array<THREE.Line3>} segments
 * @returns {number}
 */
export function pointRayCrossesSegments( point, segments ) {

	let crossings = 0;
	const firstSeg = segments[ segments.length - 1 ];
	let prevSegmentGoesDown = firstSeg.start.y > firstSeg.end.y;
	for ( let s = 0, l = segments.length; s < l; s ++ ) {

		const line = segments[ s ];
		const thisSegmentGoesDown = line.start.y > line.end.y;
		if ( pointRayCrossesLine( point, line, prevSegmentGoesDown, thisSegmentGoesDown ) ) {

			crossings ++;

		}

		prevSegmentGoesDown = thisSegmentGoesDown;

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

/**
 * Check if a ray cast from `point` to the right intersects the line segment.
 *
 * @param {THREE.Vector3} point
 * @param {THREE.Line3} line
 * @param {boolean} prevSegmentGoesDown
 * @param {boolean} thisSegmentGoesDown
 */
function pointRayCrossesLine( point, line, prevSegmentGoesDown, thisSegmentGoesDown ) {

	const { start, end } = line;
	const px = point.x;
	const py = point.y;

	const sy = start.y;
	const ey = end.y;

	// If the line segment is parallel to the horizonal ray, then it can never intersect
	if ( sy === ey ) return false;

	// If the point is above or below both ends of the line segment, then the ray can't intersect the segment
	if ( py > sy && py > ey ) return false;
	if ( py < sy && py < ey ) return false;

	const sx = start.x;
	const ex = end.x;

	// If the point is to the right of both ends of the line segment, then the ray cast to the right can't intersect the segment
	if ( px > sx && px > ex ) return false;
	if ( px < sx && px < ex ) {

		// If the ray hits just the "peak" formed by two adjacent segments, then it's not considered an intersection
		// This checks only the peak formed with the previous segment, assuming that this function will also be called for the next segment
		if ( py === sy && prevSegmentGoesDown !== thisSegmentGoesDown ) {

			return false;

		}

		// The point is to the left of the line segment and vertically in between the two ends of the segment, so the ray must hit the segment
		return true;

	}

	// The line segment is a vector (dx; dy)
	const dx = ex - sx;
	const dy = ey - sy;
	// Its clockwise perpendicular vector is (dy; -dx)
	const perpx = dy;
	const perpy = - dx;

	// The vector from the start of the segment to the point is (pdx; pdy)
	const pdx = px - sx;
	const pdy = py - sy;

	// The dot product is positive if angle from (pdx; pdy) to (perpx; perpy) is between -90 and 90 degrees
	const dot = perpx * pdx + perpy * pdy;

	if ( Math.sign( dot ) !== Math.sign( perpx ) ) {

		return true;

	}

	return false;

}
