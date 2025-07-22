import { wgslFn } from 'three/tsl';

export const getVertexAttribute = wgslFn( /* wgsl */`

	fn getVertexAttribute(
		barycoord: vec3f,
		faceIndices: vec3u,
		attributeBuffer: ptr<storage, array<vec3f>, read>
	) -> vec3<f32> {

		let n0 = attributeBuffer[ faceIndices.x ];
		let n1 = attributeBuffer[ faceIndices.y ];
		let n2 = attributeBuffer[ faceIndices.z ];
		return barycoord.x * n0 + barycoord.y * n1 + barycoord.z * n2;

	}

` );

export const ndcToCameraRay = wgslFn( /* wgsl*/`

	fn ndcToCameraRay(
		coord: vec2<f32>,
		cameraWorld: mat4x4<f32>,
		invProjectionMatrix: mat4x4<f32>
	) -> Ray {

		let lookDirection = cameraWorld * vec4<f32>( 0.0, 0.0, -1.0, 0.0 );
		let nearVector = invProjectionMatrix * vec4<f32>( 0.0, 0.0, -1.0, 1.0 );
		let near = abs( nearVector.z / nearVector.w );

		var origin = cameraWorld * vec4<f32>( 0.0, 0.0, 0.0, 1.0 );
		var direction = invProjectionMatrix * vec4<f32>( coord, 0.5, 1.0 );

		direction = direction / direction.w;
		direction = ( cameraWorld * direction ) - origin;

		let slide = near / dot( direction.xyz, lookDirection.xyz );

		origin = vec4<f32>(
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
		rayOrigin: vec3<f32>,
		rayDirection: vec3<f32>,
		boundsMin: vec3<f32>,
		boundsMax: vec3<f32>,
		dist: ptr<function, f32>
	) -> bool {

		let invDir = 1.0 / rayDirection;

		let tMinPlane = ( boundsMin - rayOrigin ) * invDir;
		let tMaxPlane = ( boundsMax - rayOrigin ) * invDir;

		let tMinHit = vec3<f32>(
			min( tMinPlane.x, tMaxPlane.x ),
			min( tMinPlane.y, tMaxPlane.y ),
			min( tMinPlane.z, tMaxPlane.z )
		);

		let tMaxHit = vec3<f32>(
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

export const intersectsBVHNodeBounds = wgslFn( /* wgsl */`

	fn intersectsBVHNodeBounds(
		rayOrigin: vec3<f32>,
		rayDirection: vec3<f32>,
		bounds: BVHBoundingBox,
		dist: ptr<function, f32>
		) -> bool {

		let boundsMin = vec3( bounds.min[0], bounds.min[1], bounds.min[2] );
		let boundsMax = vec3( bounds.max[0], bounds.max[1], bounds.max[2] );
		return intersectsBounds( rayOrigin, rayDirection, boundsMin, boundsMax, dist );

	}

` );
