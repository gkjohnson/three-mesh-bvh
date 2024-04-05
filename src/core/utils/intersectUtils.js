export function intersectRay(nodeIndex32, array, origin, dirInv, sign) {

	let tmin = 0, tmax = Infinity;

	let bmin = array[nodeIndex32 + sign[0]];
	let bmax = array[nodeIndex32 + (sign[0] + 3) % 6];

	let dmin = (bmin - origin[0]) * dirInv[0];
	let dmax = (bmax - origin[0]) * dirInv[0];

	if (dmin > tmin) tmin = dmin; // check if we can skip this if
	if (dmax < tmax) tmax = dmax; // check if we can skip this if

	bmin = array[nodeIndex32 + sign[1] + 1];
	bmax = array[nodeIndex32 + (sign[1] + 3) % 6 + 1];

	dmin = (bmin - origin[1]) * dirInv[1];
	dmax = (bmax - origin[1]) * dirInv[1];

	if (dmin > tmin) tmin = dmin;
	if (dmax < tmax) tmax = dmax;


	bmin = array[nodeIndex32 + sign[2] + 2];
	bmax = array[nodeIndex32 + (sign[2] + 3) % 6 + 2];

	dmin = (bmin - origin[2]) * dirInv[2];
	dmax = (bmax - origin[2]) * dirInv[2];

	if (dmin > tmin) tmin = dmin;
	if (dmax < tmax) tmax = dmax;

	return tmin <= tmax /* && distance >= tmin */;

}
