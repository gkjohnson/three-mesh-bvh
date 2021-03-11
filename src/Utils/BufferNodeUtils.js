import { setTriangle } from './TriangleUtils.js';

export function arrayToBox( nodeIndex32, array, target ) {

	target.min.x = array[ nodeIndex32 ];
	target.min.y = array[ nodeIndex32 + 1 ];
	target.min.z = array[ nodeIndex32 + 2 ];

	target.max.x = array[ nodeIndex32 + 3 ];
	target.max.y = array[ nodeIndex32 + 4 ];
	target.max.z = array[ nodeIndex32 + 5 ];

}

export function iterateOverTriangles(
	offset,
	count,
	geometry,
	intersectsTriangleFunc,
	contained,
	depth,
	triangle
) {

	const index = geometry.index;
	const pos = geometry.attributes.position;
	for ( let i = offset * 3, l = ( count + offset ) * 3; i < l; i += 3 ) {

		setTriangle( triangle, i, index, pos );
		triangle.needsUpdate = true;

		if ( intersectsTriangleFunc( triangle, i, i + 1, i + 2, contained, depth ) ) {

			return true;

		}

	}

	return false;

}
