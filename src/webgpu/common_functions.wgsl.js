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

// BVH2 node struct - direct format from H-PLOC GPU builder
// Uses absolute child indices instead of relative offsets
export const bvh2NodeStruct = wgsl( /* wgsl */`
	struct BVH2Node {
		boundsMin: vec3f,
		leftChild: u32,
		boundsMax: vec3f,
		rightChild: u32,
	};
` );

export const intersectsBoundsBVH2 = wgslFn( /* wgsl */`

	fn intersectsBoundsBVH2(
		ray: Ray,
		boundsMin: vec3f,
		boundsMax: vec3f,
		dist: ptr<function, f32>
	) -> bool {

		let invDir = 1.0 / ray.direction;
		let tMinPlane = ( boundsMin - ray.origin ) * invDir;
		let tMaxPlane = ( boundsMax - ray.origin ) * invDir;

		let tMinHit = min( tMinPlane, tMaxPlane );
		let tMaxHit = max( tMinPlane, tMaxPlane );

		let t0 = max( max( tMinHit.x, tMinHit.y ), tMinHit.z );
		let t1 = min( min( tMaxHit.x, tMaxHit.y ), tMaxHit.z );

		( *dist ) = max( t0, 0.0 );

		return t1 >= ( *dist );

	}

`, [ rayStruct ] );

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

// Traversal statistics for BVH quality comparison
export const traversalStatsStruct = wgsl( /* wgsl */`
	struct TraversalStats {
		nodesVisited: u32,
		trianglesTested: u32,
	};
` );

// Intersection result with traversal statistics
export const intersectionResultWithStatsStruct = wgsl( /* wgsl */`
	struct IntersectionResultWithStats {
		didHit: bool,
		indices: vec4u,
		normal: vec3f,
		barycoord: vec3f,
		side: f32,
		dist: f32,
		stats: TraversalStats,
	};
`, [ traversalStatsStruct ] );

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

// Instance struct for TLAS/BLAS traversal
export const instanceStruct = wgsl( /* wgsl */`
	struct Instance {
		transform: mat4x4f,
		inverseTransform: mat4x4f,
		blasOffset: u32,       // Offset into unified BLAS buffer
		indexOffset: u32,      // Offset into index buffer for this geometry
		positionOffset: u32,   // Offset into position buffer for this geometry
		materialIndex: u32,    // Index into material array
		blasRootIndex: u32,    // Root node index in BLAS
		_padding1: u32,
		_padding2: u32,
		_padding3: u32,
	};
` );

// Material struct for path tracing
export const materialStruct = wgsl( /* wgsl */`
	struct Material {
		color: vec3f,
		metalness: f32,
		roughness: f32,
		transmission: f32,
		ior: f32,
		emissive: f32,
	};
` );

// TLAS hit result including instance information
export const tlasHitResultStruct = wgsl( /* wgsl */`
	struct TLASHitResult {
		didHit: bool,
		indices: vec4u,
		normal: vec3f,
		barycoord: vec3f,
		side: f32,
		dist: f32,
		instanceIndex: u32,
		materialIndex: u32,
	};
` );

// Transform ray from world space to object space
export const transformRay = wgslFn( /* wgsl */`

	fn transformRay( ray: Ray, inverseTransform: mat4x4f ) -> Ray {

		var localRay: Ray;

		// Transform origin (point)
		let origin4 = inverseTransform * vec4f( ray.origin, 1.0 );
		localRay.origin = origin4.xyz;

		// Transform direction (vector, no translation)
		let dir4 = inverseTransform * vec4f( ray.direction, 0.0 );
		localRay.direction = dir4.xyz;

		return localRay;

	}

`, [ rayStruct ] );

// Transform normal from object space to world space
export const transformNormal = wgslFn( /* wgsl */`

	fn transformNormal( normal: vec3f, inverseTransform: mat4x4f ) -> vec3f {

		// For normal transformation, use transpose of inverse (which is transpose of inverseTransform)
		// Since we have inverseTransform, we need transpose(inverseTransform) = transpose(inverse(M))
		// But normal transforms with inverse transpose, so: transpose(inverse(M)) * n
		// We already have inverse(M), so we compute transpose(inverse(M)) * n
		let n4 = transpose( inverseTransform ) * vec4f( normal, 0.0 );
		return normalize( n4.xyz );

	}

`, [] );
