export const shaderStructs = /* glsl */`
#ifndef TRI_INTERSECT_EPSILON
#define TRI_INTERSECT_EPSILON 1e-5
#endif

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

	uint a;
	uint b;
	uint c;
	vec3 normal;

};

struct BVHRayHit {

	Face face;
	vec3 point;
	vec3 barycoord;
	float side;
	float dist;

};
`;

export const shaderIntersectFunction = /* glsl */`

uvec4 uTexelFetch1D( usampler2D tex, uint index ) {

	uint width = uint( textureSize( tex, 0 ).x );
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, ivec2( uv ), 0 );

}

ivec4 iTexelFetch1D( isampler2D tex, uint index ) {

	uint width = uint( textureSize( tex, 0 ).x );
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, ivec2( uv ), 0 );

}

vec4 texelFetch1D( sampler2D tex, uint index ) {

	uint width = uint( textureSize( tex, 0 ).x );
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, ivec2( uv ), 0 );

}

vec4 textureSampleBarycoord( sampler2D tex, vec3 barycoord, uint a, uint b, uint c ) {

	// TODO: our barycentric coordinates are incorrectly ordered here. Need to fix the intersectsTriangle function
	return
		barycoord.x * texelFetch1D( tex, a ) +
		barycoord.y * texelFetch1D( tex, b ) +
		barycoord.z * texelFetch1D( tex, c );

}

Ray ndcToCameraRay( vec2 coord, mat4 cameraWorld, mat4 invProjectionMatrix ) {

	// get camera look direction and near plane for camera clipping
	vec4 lookDirection = cameraWorld * vec4( 0.0, 0.0, - 1.0, 0.0 );
	vec4 nearVector = invProjectionMatrix * vec4( 0.0, 0.0, - 1.0, 1.0 );
	float near = abs( nearVector.z / nearVector.w );

	// get the camera direction and position from camera matrices
	vec4 origin = cameraWorld * vec4( 0.0, 0.0, 0.0, 1.0 );
	vec4 direction = invProjectionMatrix * vec4( coord, 0.5, 1.0 );
	direction /= direction.w;
	direction = cameraWorld * direction - origin;

	// slide the origin along the ray until it sits at the near clip plane position
	origin.xyz += direction.xyz * near / dot( direction, lookDirection );

	return Ray( origin.xyz, direction.xyz );

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

bool intersectsTriangle( Ray ray, vec3 a, vec3 b, vec3 c, out vec3 barycoord, out vec3 norm, out float dist, out float side ) {

	// https://stackoverflow.com/questions/42740765/intersection-between-line-and-triangle-in-3d
	vec3 edge1 = b - a;
	vec3 edge2 = c - a;
	norm = cross( edge1, edge2 );

	float det = - dot( ray.direction, norm );
	float invdet = 1.0 / det;

	vec3 AO = ray.origin - a;
	vec3 DAO = cross( AO, ray.direction );

	vec4 uvt;
	uvt.x = dot( edge2, DAO ) * invdet;
	uvt.y = - dot( edge1, DAO ) * invdet;
	uvt.z = dot( AO, norm ) * invdet;
	uvt.w = 1.0 - uvt.x - uvt.y;

	// set the hit information
	barycoord = uvt.wxy;
	dist = uvt.z;
	side = sign( det );
	norm = normalize( norm );

	// add an epsilon to avoid misses between triangles
	uvt += vec4( TRI_INTERSECT_EPSILON );

	return all( greaterThanEqual( uvt, vec4( 0.0 ) ) );

}

bool intersectTriangles( BVH bvh, Ray ray, uint offset, uint count, inout float minDistance, out BVHRayHit hit ) {

	bool found = false;
	vec3 barycoord, norm;
	float dist, side;
	for ( uint i = offset, l = offset + count; i < l; i ++ ) {

		uint index3 = i * 3u;
		uint i0 = uTexelFetch1D( bvh.index, index3 + 0u ).r;
		uint i1 = uTexelFetch1D( bvh.index, index3 + 1u ).r;
		uint i2 = uTexelFetch1D( bvh.index, index3 + 2u ).r;

		vec3 a = texelFetch1D( bvh.position, i0 ).rgb;
		vec3 b = texelFetch1D( bvh.position, i1 ).rgb;
		vec3 c = texelFetch1D( bvh.position, i2 ).rgb;

		if ( intersectsTriangle( ray, a, b, c, barycoord, norm, dist, side ) && dist < minDistance ) {

			found = true;
			minDistance = dist;
			hit.face.a = i0;
			hit.face.b = i1;
			hit.face.c = i2;
			hit.face.normal = norm;

			hit.side = side;
			hit.barycoord = barycoord;
			hit.dist = dist;
			hit.point = ray.origin + ray.direction * dist;

		}

	}

	return found;

}

bool bvhIntersect( BVH bvh, Ray ray, bool anyHit, out BVHRayHit hit ) {

	// stack needs to be twice as long as the deepest tree we expect because
	// we push both the left and right child onto the stack every traversal
	int ptr = 0;
	uint stack[ 60 ];
	stack[ 0 ] = 0u;

	float triangleDistance = 1e20;
	bool found = false;
	while ( ptr > - 1 && ptr < 60 ) {

		uint currNodeIndex = stack[ ptr ];
		ptr --;

		// check if we intersect the current bounds
		float boundsHitDistance;
		vec3 boundsMin = texelFetch1D( bvh.bvhBounds, currNodeIndex * 2u + 0u ).xyz;
		vec3 boundsMax = texelFetch1D( bvh.bvhBounds, currNodeIndex * 2u + 1u ).xyz;
		if ( ! intersectsBounds( ray, boundsMin, boundsMax, boundsHitDistance ) || boundsHitDistance > triangleDistance ) {

			continue;

		}

		uvec2 boundsInfo = uTexelFetch1D( bvh.bvhContents, currNodeIndex ).xy;
		bool isLeaf = bool( boundsInfo.x & 0xffff0000u );

		if ( isLeaf ) {

			uint count = boundsInfo.x & 0x0000ffffu;
			uint offset = boundsInfo.y;

			found = intersectTriangles( bvh, ray, offset, count, triangleDistance, hit ) || found;

			// TODO: Should an "any hit" variation of the function be created?
			if ( found && anyHit ) {

				return true;

			}

		} else {

			uint leftIndex = currNodeIndex + 1u;
			uint splitAxis = boundsInfo.x & 0x0000ffffu;
			uint rightIndex = boundsInfo.y;

			bool leftToRight = ray.direction[ splitAxis ] >= 0.0;
			uint c1 = leftToRight ? leftIndex : rightIndex;
			uint c2 = leftToRight ? rightIndex : leftIndex;

			// set c2 in the stack so we traverse it later. We need to keep track of a pointer in
			// the stack while we traverse. The second pointer added is the one that will be
			// traversed first
			ptr ++;
			stack[ ptr ] = c2;

			ptr ++;
			stack[ ptr ] = c1;

		}

	}

	return found;

}

bool bvhIntersectFirstHit( BVH bvh, Ray ray, out BVHRayHit hit ) {

	return bvhIntersect( bvh, ray, false, hit );

}

bool bvhIntersectAnyHit( BVH bvh, Ray ray, out BVHRayHit hit ) {

	return bvhIntersect( bvh, ray, true, hit );

}
`;
