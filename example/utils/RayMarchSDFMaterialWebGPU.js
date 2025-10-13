import * as THREE from 'three/webgpu';
import { uniform, wgslFn, uv, varying, texture3D, sampler, positionGeometry } from 'three/tsl';

export class RayMarchSDFMaterial extends THREE.NodeMaterial {

	constructor( sdfTexture ) {

		super();

		const raymarchFragmentParams = {
			surface: uniform( 0 ),
			normalStep: uniform( new THREE.Vector3() ),
			projectionInverse: uniform( new THREE.Matrix4() ),
			sdfTransformInverse: uniform( new THREE.Matrix4() ),
			sdfTransform: uniform( new THREE.Matrix4() ),

			uv: varying( uv() ),
			sdf_sampler: sampler( sdfTexture ),
			sdf: texture3D( sdfTexture ),
		};

		const rayBoxDistFn = wgslFn( /* wgsl */ `
			fn rayBoxDist(boundsMin: vec3f, boundsMax: vec3f, rayOrigin: vec3f, rayDir: vec3f) -> vec2f {
				let t0 = (boundsMin - rayOrigin) / rayDir;
				let t1 = (boundsMax - rayOrigin) / rayDir;
				let tmin = min(t0, t1);
				let tmax = max(t0, t1);

				let distA = max( max( tmin.x, tmin.y ), tmin.z );
				let distB = min( tmax.x, min( tmax.y, tmax.z ) );

				let distToBox = max( 0.0, distA );
				let distInsideBox = max( 0.0, distB - distToBox );
				return vec2f( distToBox, distInsideBox );
			}
		` );

		const raymarchFragmentShader = wgslFn( /* wgsl */ `
			fn raymarch(
				surface: f32,
				projectionInverse: mat4x4f,
				sdfTransformInverse: mat4x4f,
				sdfTransform: mat4x4f,
				normalStep: vec3f,

				uv: vec2f,
				sdf_sampler: sampler,
				sdf: texture_3d<f32>,
			) -> vec4f {
				const MAX_STEPS: i32 = 500;
				const SURFACE_EPSILON: f32 = 0.001;

				let clipSpace = 2.0 * uv - vec2f( 1.0, 1.0 );

				let rayOrigin = vec3f( 0.0, 0.0, 0.0 );
				let homogenousDirection = projectionInverse * vec4f( clipSpace, -1.0, 1.0 );
				let rayDirection = normalize( homogenousDirection.xyz / homogenousDirection.w );

				let sdfRayOrigin = ( sdfTransformInverse * vec4f( rayOrigin, 1.0 ) ).xyz;
				let sdfRayDirection = normalize( ( sdfTransformInverse * vec4f( rayDirection, 0.0 ) ).xyz );

				let boxIntersectionInfo = rayBoxDist( vec3f( -0.5 ), vec3f( 0.5 ), sdfRayOrigin, sdfRayDirection );
				let distToBox = boxIntersectionInfo.x;
				let distInsideBox = boxIntersectionInfo.y;
				let intersectsBox = distInsideBox > 0.0;

				var color = vec4f( 0.0 );

				if ( intersectsBox ) {

					var intersectsSurface = false;
					var localPoint = vec4f( sdfRayOrigin + sdfRayDirection * ( distToBox + 1e-5 ), 1.0 );
					var point = sdfTransform * localPoint;

					for ( var i: i32 = 0; i < MAX_STEPS; i = i + 1 ) {

						let uv3 = ( sdfTransformInverse * point ).xyz + vec3f( 0.5 );

						if ( uv3.x < 0.0 || uv3.x > 1.0 || uv3.y < 0.0 || uv3.y > 1.0 || uv3.z < 0.0 || uv3.z > 1.0 ) {
							break;
						}

						let distanceToSurface = textureSample( sdf, sdf_sampler, uv3 ).r - surface;
						if ( distanceToSurface < SURFACE_EPSILON ) {
							intersectsSurface = true;
							break;
						}

						point = vec4f(point.xyz + rayDirection * distanceToSurface, point.w);
					}

					if ( intersectsSurface ) {

						let uv3 = ( sdfTransformInverse * point ).xyz + vec3f( 0.5 );

						let dx = textureSample( sdf, sdf_sampler, uv3 + vec3f( normalStep.x, 0.0, 0.0 ) ).r
							- textureSample( sdf, sdf_sampler, uv3 - vec3f( normalStep.x, 0.0, 0.0 ) ).r;

						let dy = textureSample( sdf, sdf_sampler, uv3 + vec3f( 0.0, normalStep.y, 0.0 ) ).r
							- textureSample( sdf, sdf_sampler, uv3 - vec3f( 0.0, normalStep.y, 0.0 ) ).r;

						let dz = textureSample( sdf, sdf_sampler, uv3 + vec3f( 0.0, 0.0, normalStep.z ) ).r
							- textureSample( sdf, sdf_sampler, uv3 - vec3f( 0.0, 0.0, normalStep.z ) ).r;

						let normal = normalize( vec3f( dx, dy, dz ) );

						let lightDirection = normalize( vec3f( 1.0, 1.0, 1.0 ) );
						let lightIntensity =
							saturate( dot( normal, lightDirection ) ) +
							saturate( dot( normal, -lightDirection ) ) * 0.05 +
							0.1;

						color = vec4f( vec3f( lightIntensity ), 1.0 );
					}
				}

				return color;
			}
		`, [ rayBoxDistFn ] );

		this.fragmentNode = raymarchFragmentShader( raymarchFragmentParams );


		const vertexShaderParams = {
			position: positionGeometry,
		};
		const fullScreenQuadVertex = wgslFn( /* wgsl */ `

			fn noop(position: vec4f) -> vec4f {
				return position;
			}

		` );

		this.vertexNode = fullScreenQuadVertex( vertexShaderParams );

	}

}
