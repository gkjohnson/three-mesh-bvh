export const bvh_gsplat_ray_functions = /* glsl */`

// The caller needs to define the following functions:
//
//    bvhInitSearch
//    bvhVisitSplat
//    bvhVisitBoundingBox
//
int bvhTexLookups = 0;

// use a macro to hide the fact that we need to expand the struct into separate fields
#define	bvhSearchSplats(bvh) _bvhSearchSplats(bvh.position, bvh.index, bvh.bvhBounds, bvh.bvhContents)

bool _bvhSearchSplats(sampler2D bvh_position, usampler2D bvh_index, sampler2D bvh_bvhBounds, usampler2D bvh_bvhContents) {
	int ptr = 0;
	uint stack[ BVH_STACK_DEPTH ];
	stack[ 0 ] = 0u;
  bool found = false;
  bvhTexLookups = 0;

  bvhInitSearch();

	while ( ptr >= 0 && ptr < BVH_STACK_DEPTH ) {
		uint nodeId = stack[ ptr-- ];
    vec3 boundsMin = texelFetch1D( bvh_bvhBounds, nodeId * 2u + 0u ).xyz;
    vec3 boundsMax = texelFetch1D( bvh_bvhBounds, nodeId * 2u + 1u ).xyz;
    bvhTexLookups++;

    if (!bvhVisitBoundingBox(boundsMin, boundsMax))
      continue;

		uvec2 boundsInfo = uTexelFetch1D( bvh_bvhContents, nodeId ).xy;
		bool isLeaf = bool( boundsInfo.x & 0xffff0000u );
    bvhTexLookups++;

		if ( isLeaf ) {
			uint count = boundsInfo.x & 0x0000ffffu;
			uint offset = boundsInfo.y;

      bvhTexLookups += int(count);

      for (uint id = 0u; id < count; id++) {
        uint splatId = uTexelFetch1D( bvh_index, id + offset ).x / 3u;

        if (bvhVisitSplat(splatId))
          found = true;
      }
		} else {
			uint leftIndex = nodeId + 1u;
			uint splitAxis = boundsInfo.x & 0x0000ffffu;
			uint rightIndex = boundsInfo.y;

			bool leftToRight = bvhRayDir[ splitAxis ] >= 0.0;
			uint c1 = leftToRight ? leftIndex : rightIndex;
			uint c2 = leftToRight ? rightIndex : leftIndex;

			stack[ ++ptr ] = c2; // traverse later
			stack[ ++ptr ] = c1; // traverse first
		}
	}

  return found;
}
`;
