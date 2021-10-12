export const shaderStructs = /* glsl */`
struct BVH {

	usampler2D index;
	sampler2D position;

	sampler2D bvhBounds;
	usampler2D bvhContents;

};

struct Ray {

	vec3 origin;
	vec3 direction;

};

struct Face {

	vec3 a;
	vec3 b;
	vec3 c;
	vec3 normal;

};

struct BVHRayHit {

	Face face;
	vec3 point;
	float dist;

};
`;

export const shaderIntersectFunction = /* glsl */`

uvec4 texelFetch1D( usampler2D tex, uint index ) {

	int width = textureSize( tex, 0 ).x;
	ivec2 uv;
	uv.x = int( index ) % width;
	uv.y = int( index ) / width;

	return texelFetch( tex, uv, 0 );

}

vec4 texelFetch1D( sampler2D tex, uint index ) {

	int width = textureSize( tex, 0 ).x;
	ivec2 uv;
	uv.x = int( index ) % width;
	uv.y = int( index ) / width;

	return texelFetch( tex, uv, 0 );

}

bool intersectsBounds( Ray ray, vec3 boundsMin, vec3 boundsMax, out float dist ) {

	// https://www.reddit.com/r/opengl/comments/8ntzz5/fast_glsl_ray_box_intersection/
	// https://tavianator.com/2011/ray_box.html
	vec3 invDir = 1.0 / ray.direction;

	// find intersection distances for each plane
	vec3 tMinPlane = invDir * ( boundsMin - ray.origin );
	vec3 tMaxPlane = invDir * ( boundsMax - ray.origin );

	// get the min and max distances from each intersection
	vec3 tMinHit = min( tMaxPlane, tMinPlane );
	vec3 tMaxHit = max( tMaxPlane, tMinPlane );

	// get the furthest hit distance
	vec2 t = max( tMinHit.xx, tMinHit.yz );
	float t0 = max( t.x, t.y );

	// get the minimum hit distance
	t = min( tMaxHit.xx, tMaxHit.yz );
	float t1 = min( t.x, t.y );

	// set distance to 0.0 if the ray starts inside the box
	dist = max( t0, 0.0 );

	return t1 >= max( t0, 0.0 );

}

// TODO: take intersection side
bool intersectsTriangle( Ray ray, vec3 a, vec3 b, vec3 c, inout float minDistance, out BVHRayHit hit ) {

	return false;

}

bool intersectsTriangle( BVH bvh, Ray ray, uint index, inout float minDistance, out BVHRayHit hit ) {

	uint index3 = index * 3u;
	uint i0 = texelFetch1D( bvh.index, index3 + 0u ).r;
	uint i1 = texelFetch1D( bvh.index, index3 + 1u ).r;
	uint i2 = texelFetch1D( bvh.index, index3 + 2u ).r;

	vec3 v0 = texelFetch1D( bvh.position, i0 ).rgb;
	vec3 v1 = texelFetch1D( bvh.position, i1 ).rgb;
	vec3 v2 = texelFetch1D( bvh.position, i2 ).rgb;

	return intersectsTriangle( ray, v0, v1, v2, minDistance, hit );

}

bool intersectTriangles( BVH bvh, Ray ray, uint offset, uint count, inout float minDistance, out BVHRayHit hit ) {

	bool found = false;
	for ( uint i = offset, l = offset + count; i < l; i ++ ) {

		found = intersectsTriangle( bvh, ray, i, minDistance, hit ) || found;

	}

	return found;

}

bool intersectBVH( BVH bvh, Ray ray, out BVHRayHit hit ) {

	uint stack[ 40 ];
	int ptr = 1;
	stack[ 0 ] = 0u;

	float triangleDistance = 1e20;
	uint currNodeIndex = 0u;
	bool found = false;
	while ( ptr != - 1 ) {

		// check if we intersect the current bounds
		float dist;
		vec3 boundsCenter = texelFetch1D( bvh.bvhBounds, currNodeIndex * 2u + 0u ).xyz;
		vec3 boundsSize = texelFetch1D( bvh.bvhBounds, currNodeIndex * 2u + 1u ).xyz;

		vec3 boundsMin = boundsCenter - boundsSize;
		vec3 boundsMax = boundsCenter + boundsSize;
		if ( ! intersectsBounds( ray, boundsMin, boundsMax, dist ) || dist > triangleDistance ) {

			continue;

		}

		uvec2 boundsInfo = texelFetch1D( bvh.bvhContents, currNodeIndex ).xy;
		bool isLeaf = bool( boundsInfo.x & 0xffff0000u );

		if ( isLeaf ) {

			uint offset = boundsInfo.x;
			uint count = boundsInfo.y;

			found = intersectTriangles( bvh, ray, offset, count, triangleDistance, hit ) || found;

			currNodeIndex = stack[ ptr ];
			ptr --;

		} else {

			uint splitAxis = boundsInfo.x | 0x0000ffffu;
			uint leftIndex = currNodeIndex + 1u;
			uint rightIndex = boundsInfo.y;

			uint c1 = ray.direction[ splitAxis ] < 0.0 ? rightIndex : leftIndex;
			uint c2 = ray.direction[ splitAxis ] < 0.0 ? leftIndex : rightIndex;


			// set c2 in the stack so we traverse it later. We need to keep track of a pointer in
			// the stack while we traverse.
			currNodeIndex = c1;
			stack[ ptr ] = c2;
			ptr ++;

		}

	}

	return found;

}
`;
