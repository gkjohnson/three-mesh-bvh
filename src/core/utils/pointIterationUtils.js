// Utility functions for iterating over points in PointsBVH
// These mirror the pattern used in iterationUtils.generated.js for triangles

function iterateOverPoints(
	offset,
	count,
	bvh,
	intersectsPointFunc,
	contained,
	depth,
	point
) {

	const { geometry } = bvh;
	const { index } = geometry;
	const pos = geometry.attributes.position;

	for ( let i = offset, l = count + offset; i < l; i ++ ) {

		let pt;

		pt = i;

		// In direct mode, the index array has been rearranged during BVH build
		// Read the vertex index from the rearranged index array
		const vertexIndex = index ? index.array[ pt ] : pt;
		point.fromBufferAttribute( pos, vertexIndex );

		if ( intersectsPointFunc( point, i, vertexIndex, contained, depth ) ) {

			return true;

		}

	}

	return false;

}

function iterateOverPoints_indirect(
	offset,
	count,
	bvh,
	intersectsPointFunc,
	contained,
	depth,
	point
) {

	const { geometry } = bvh;
	const { index } = geometry;
	const pos = geometry.attributes.position;

	for ( let i = offset, l = count + offset; i < l; i ++ ) {

		let pt;
		pt = bvh.resolvePointIndex( i );

		// In indirect mode, resolvePointIndex returns the original point index
		// Use it to access the geometry index (if present) or position directly
		const vertexIndex = index ? index.array[ pt ] : pt;
		point.fromBufferAttribute( pos, vertexIndex );

		if ( intersectsPointFunc( point, i, vertexIndex, contained, depth ) ) {

			return true;

		}

	}

	return false;

}

export { iterateOverPoints, iterateOverPoints_indirect };
