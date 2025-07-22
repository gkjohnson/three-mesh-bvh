import { wgslFn, wgsl } from 'three/tsl';

export const constants = wgsl( /* wgsl */`

	const BVH_STACK_DEPTH = 60u;
	const INFINITY = 1e20;
	const TRI_INTERSECT_EPSILON = 1e-5;

` );

export const rayStruct = wgsl( /* wgsl */`
	struct Ray {
		origin: vec3f,
		direction: vec3f,
	};
` );

export const bvhNodeBoundsStruct = wgsl( /* wgsl */`
	struct BVHBoundingBox {
		min: array<f32, 3>,
		max: array<f32, 3>,
	}
` );

export const bvhNodeStruct = wgsl( /* wgsl */`
	struct BVHNode {
		bounds: BVHBoundingBox,
		rightChildOrTriangleOffset: u32,
		splitAxisOrTriangleCount: u32,
	};
`, [ bvhNodeBoundsStruct ] );

export const intersectionResultStruct = wgsl( /* wgsl */`
	struct IntersectionResult {
		didHit: bool,
		indices: vec4u,
		normal: vec3f,
		barycoord: vec3f,
		side: f32,
		dist: f32,
	};
` );

export const getVertexAttribute = wgslFn( /* wgsl */`

	fn getVertexAttribute(
		barycoord: vec3f,
		indices: vec3u,
		attributeBuffer: ptr<storage, array<vec3f>, read>
	) -> vec3f {

		let n0 = attributeBuffer[ indices.x ];
		let n1 = attributeBuffer[ indices.y ];
		let n2 = attributeBuffer[ indices.z ];
		return barycoord.x * n0 + barycoord.y * n1 + barycoord.z * n2;

	}

` );

export const ndcToCameraRay = wgslFn( /* wgsl*/`

	fn ndcToCameraRay( ndc: vec2f, inverseModelViewProjection: mat4x4f ) -> Ray {

		// Calculate the ray by picking the points at the near and far plane and deriving the ray
		// direction from the two points. This approach works for both orthographic and perspective
		// camera projection matrices.
		// The returned ray direction is not normalized and extends to the camera far plane.
		var homogeneous = vec4f();
		var ray = Ray();

		homogeneous = inverseModelViewProjection * vec4f( ndc, 0.0, 1.0 );
		ray.origin = homogeneous.xyz / homogeneous.w;

		homogeneous = inverseModelViewProjection * vec4f( ndc, 1.0, 1.0 );
		ray.direction = ( homogeneous.xyz / homogeneous.w ) - ray.origin;

		return ray;

	}
` );

export const intersectsBounds = wgslFn( /* wgsl */`

	fn intersectsBounds(
		ray: Ray,
		bounds: BVHBoundingBox,
		dist: ptr<function, f32>
	) -> bool {

		let boundsMin = vec3( bounds.min[0], bounds.min[1], bounds.min[2] );
		let boundsMax = vec3( bounds.max[0], bounds.max[1], bounds.max[2] );

		let invDir = 1.0 / ray.direction;
		let tMinPlane = ( boundsMin - ray.origin ) * invDir;
		let tMaxPlane = ( boundsMax - ray.origin ) * invDir;

		let tMinHit = vec3f(
			min( tMinPlane.x, tMaxPlane.x ),
			min( tMinPlane.y, tMaxPlane.y ),
			min( tMinPlane.z, tMaxPlane.z )
		);

		let tMaxHit = vec3f(
			max( tMinPlane.x, tMaxPlane.x ),
			max( tMinPlane.y, tMaxPlane.y ),
			max( tMinPlane.z, tMaxPlane.z )
		);

		let t0 = max( max( tMinHit.x, tMinHit.y ), tMinHit.z );
		let t1 = min( min( tMaxHit.x, tMaxHit.y ), tMaxHit.z );

		( *dist ) = max( t0, 0.0 );

		return t1 >= ( *dist );

	}

`, [ rayStruct, bvhNodeBoundsStruct ] );
