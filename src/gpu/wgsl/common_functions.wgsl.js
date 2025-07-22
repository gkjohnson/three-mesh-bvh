import { wgslFn, wgsl } from 'three/tsl';

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

	fn ndcToCameraRay(
		coord: vec2f,
		cameraWorld: mat4x4f,
		invProjectionMatrix: mat4x4f
	) -> Ray {

		let lookDirection = cameraWorld * vec4f( 0.0, 0.0, -1.0, 0.0 );
		let nearVector = invProjectionMatrix * vec4f( 0.0, 0.0, -1.0, 1.0 );
		let near = abs( nearVector.z / nearVector.w );

		var origin = cameraWorld * vec4f( 0.0, 0.0, 0.0, 1.0 );
		var direction = invProjectionMatrix * vec4f( coord, 0.5, 1.0 );

		direction = direction / direction.w;
		direction = ( cameraWorld * direction ) - origin;

		let slide = near / dot( direction.xyz, lookDirection.xyz );

		origin = vec4f(
			origin.xyz + direction.xyz * slide,
			origin.w
		);

		return Ray(
			origin.xyz,
			direction.xyz
		);

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
