export function closestDistanceSquaredPointToBox( nodeIndex32, array, point ) {

	const xMin = array[ nodeIndex32 + 0 ] - point.x;
	const xMax = point.x - array[ nodeIndex32 + 3 ];
	let dx = xMin > xMax ? xMin : xMax;
	dx = dx > 0 ? dx : 0;

	const yMin = array[ nodeIndex32 + 1 ] - point.y;
	const yMax = point.y - array[ nodeIndex32 + 4 ];
	let dy = yMin > yMax ? yMin : yMax;
	dy = dy > 0 ? dy : 0;

	const zMin = array[ nodeIndex32 + 2 ] - point.z;
	const zMax = point.z - array[ nodeIndex32 + 5 ];
	let dz = zMin > zMax ? zMin : zMax;
	dz = dz > 0 ? dz : 0;

	return dx * dx + dy * dy + dz * dz;

}
