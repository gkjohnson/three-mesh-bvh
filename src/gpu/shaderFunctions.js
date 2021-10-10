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
bool intersectBVH( BVH bvh, Ray ray, out RayHit hit ) {


}
`;
