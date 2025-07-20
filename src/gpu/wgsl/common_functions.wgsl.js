import { wgslFn } from 'three/tsl';


const normalSampleBarycoord = wgslFn( /* wgsl */`

	fn normalSampleBarycoord(
		barycoord: vec3<f32>,
		faceIndices: vec3<u32>,
		normalBuffer: ptr<storage, array<vec3<f32>>, read>
	) -> vec3<f32> {

		let n0 = normalBuffer[ faceIndices.x ].xyz;
		let n1 = normalBuffer[ faceIndices.y ].xyz;
		let n2 = normalBuffer[ faceIndices.z ].xyz;

		return normalize(
			barycoord.x * n0 +
			barycoord.y * n1 +
			barycoord.z * n2
		);

	}

` );


const ndcToCameraRay = wgslFn( /* wgsl*/`

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


const intersectsBounds = wgslFn( /* wgsl */`

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


const intersectsBVHNodeBounds = wgslFn( /* wgsl */`

	fn intersectsBVHNodeBounds(
		rayOrigin: vec3<f32>,
		rayDirection: vec3<f32>,
		bvh: ptr<storage, array<BVHNode>, read>,
		currNodeIndex: u32,
		dist: ptr<function, f32>
		) -> bool {

		let node = bvh[ currNodeIndex ];
		let boundsMin = vec3( node.boundingBoxMin[0], node.boundingBoxMin[1], node.boundingBoxMin[2] );
		let boundsMax = vec3( node.boundingBoxMax[0], node.boundingBoxMax[1], node.boundingBoxMax[2] );

		return intersectsBounds( rayOrigin, rayDirection, boundsMin, boundsMax, dist );

	}

` );


export { intersectsBVHNodeBounds, intersectsBounds, ndcToCameraRay, normalSampleBarycoord };