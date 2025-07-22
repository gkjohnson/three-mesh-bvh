import { wgslFn } from 'three/tsl';

export const getVertexAttribute = wgslFn( /* wgsl */`

	fn getVertexAttribute(
		barycoord: vec3f,
		faceIndices: vec3u,
		attributeBuffer: ptr<storage, array<vec3f>, read>
	) -> vec3f {

		let n0 = attributeBuffer[ faceIndices.x ];
		let n1 = attributeBuffer[ faceIndices.y ];
		let n2 = attributeBuffer[ faceIndices.z ];
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

` );
