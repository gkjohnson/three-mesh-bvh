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

struct RayHit {

	Face face;
	vec3 point;
	float dist;

};
`;

export const shaderIntersectFunction = /* glsl */`

uvec4 texelFetch1D( usampler2D tex, uint index ) {

	uint width = textureSize( tex ).x;
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, uv );

}

vec4 texelFetch1D( sampler2D tex, uint index ) {

	uint width = textureSize( tex ).x;
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, uv );

}

bool intersectsBounds( Ray ray, vec3 boundsMin, vec3 boundsMax, out float dist ) {

	// https://www.reddit.com/r/opengl/comments/8ntzz5/fast_glsl_ray_box_intersection/
	vec3 invDir = 1.0 / ray.direction;
	vec3 tbot = invDir * ( boundsMin - r.origin );
	vec3 ttop = invDir * ( boundsMax - r.origin );
	vec3 tmin = min( ttop, tbot );
	vec3 tmax = max( ttop, tbot );
	vec2 t = max( tmin.xx, tmin.yz );

	float t0 = max( t.x, t.y );
	t = min( tmax.xx, tmax.yz );

	float t1 = min( t.x, t.y );

	dist = t0;

	return t1 > max( t0, 0.0 );

}

bool intersectsTriangle( Ray ray, vec3 a, vec3 b, vec3 c ) {


}

bool intersectsTriangle( BVH bvh, Ray ray, uint index ) {


}

bool intersectBVH( BVH bvh, Ray ray, out RayHit hit ) {

	int stack[ 40 ];
	uint ptr = 1;
	stack[ 0 ] = - 1;

	uint currNodeIndex = 0;
	while ( currNodeIndex != - 1 ) {

		vec3 boundsCenter = textureFetch1D( bvh.bvhBounds, currNodeIndex * 2 + 0 ).xyz;
		vec3 boundsSize = textureFetch1D( bvh.bvhBounds, currNodeIndex * 2 + 1 ).xyz;

		uvec2 boundsInfo = textureFetch1D( bvh.bvhContents, currNodeIndex ).xy;
		bool isLeaf = boundsInfo.x & 0xffff0000 != 0;

		if ( isLeaf ) {

			int offset = boundsInfo.x;
			int count = boundsInfo.y;

			// TODO: intersect triangles
			currNodeIndex = stack[ ptr ];
			ptr --;

		} else {

			uint splitAxis = boundsInfo.x | 0x0000ffff;
			uint leftIndex = currNodeIndex + 1;
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

}
`;
