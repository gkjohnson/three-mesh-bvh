import { ShaderMaterial, Matrix4, Vector3 } from 'three';

export class RayMarchSDFMaterial extends ShaderMaterial {

	constructor( params ) {

		super( {

			defines: {

				MAX_STEPS: 500,
				SURFACE_EPSILON: 0.001,

			},

			uniforms: {

				surface: { value: 0 },
				sdfTex: { value: null },
				normalStep: { value: new Vector3() },
				projectionInverse: { value: new Matrix4() },
				sdfTransformInverse: { value: new Matrix4() }

			},

			vertexShader: /* glsl */`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}

			`,

			fragmentShader: /* glsl */`
				precision highp sampler3D;

				varying vec2 vUv;

				uniform float surface;
				uniform sampler3D sdfTex;
				uniform vec3 normalStep;
				uniform mat4 projectionInverse;
				uniform mat4 sdfTransformInverse;

				#include <common>

				// distance to box bounds
				vec2 rayBoxDist( vec3 boundsMin, vec3 boundsMax, vec3 rayOrigin, vec3 rayDir ) {

					vec3 t0 = ( boundsMin - rayOrigin ) / rayDir;
					vec3 t1 = ( boundsMax - rayOrigin ) / rayDir;
					vec3 tmin = min( t0, t1 );
					vec3 tmax = max( t0, t1 );

					float distA = max( max( tmin.x, tmin.y ), tmin.z );
					float distB = min( tmax.x, min( tmax.y, tmax.z ) );

					float distToBox = max( 0.0, distA );
					float distInsideBox = max( 0.0, distB - distToBox );
					return vec2( distToBox, distInsideBox );

				}

				void main() {

					// get the inverse of the sdf box transform
					mat4 sdfTransform = inverse( sdfTransformInverse );

					// convert the uv to clip space for ray transformation
					vec2 clipSpace = 2.0 * vUv - vec2( 1.0 );

					// get world ray direction
					vec3 rayOrigin = vec3( 0.0 );
					vec4 homogenousDirection = projectionInverse * vec4( clipSpace, - 1.0, 1.0 );
					vec3 rayDirection = normalize( homogenousDirection.xyz / homogenousDirection.w );

					// transform ray into local coordinates of sdf bounds
					vec3 sdfRayOrigin = ( sdfTransformInverse * vec4( rayOrigin, 1.0 ) ).xyz;
					vec3 sdfRayDirection = normalize( ( sdfTransformInverse * vec4( rayDirection, 0.0 ) ).xyz );

					// find whether our ray hits the box bounds in the local box space
					vec2 boxIntersectionInfo = rayBoxDist( vec3( - 0.5 ), vec3( 0.5 ), sdfRayOrigin, sdfRayDirection );
					float distToBox = boxIntersectionInfo.x;
					float distInsideBox = boxIntersectionInfo.y;
					bool intersectsBox = distInsideBox > 0.0;

					gl_FragColor = vec4( 0.0 );
					if ( intersectsBox ) {

						// find the surface point in world space
						bool intersectsSurface = false;
						vec4 localPoint = vec4( sdfRayOrigin + sdfRayDirection * ( distToBox + 1e-5 ), 1.0 );
						vec4 point = sdfTransform * localPoint;

						// ray march
						for ( int i = 0; i < MAX_STEPS; i ++ ) {

							// sdf box extends from - 0.5 to 0.5
							// transform into the local bounds space [ 0, 1 ] and check if we're inside the bounds
							vec3 uv = ( sdfTransformInverse * point ).xyz + vec3( 0.5 );
							if ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || uv.z < 0.0 || uv.z > 1.0 ) {

								break;

							}

							// get the distance to surface and exit the loop if we're close to the surface
							float distanceToSurface = texture2D( sdfTex, uv ).r - surface;
							if ( distanceToSurface < SURFACE_EPSILON ) {

								intersectsSurface = true;
								break;

							}

							// step the ray
							point.xyz += rayDirection * abs( distanceToSurface );

						}

						// find the surface normal
						if ( intersectsSurface ) {

							// compute the surface normal
							vec3 uv = ( sdfTransformInverse * point ).xyz + vec3( 0.5 );
							float dx = texture( sdfTex, uv + vec3( normalStep.x, 0.0, 0.0 ) ).r - texture( sdfTex, uv - vec3( normalStep.x, 0.0, 0.0 ) ).r;
							float dy = texture( sdfTex, uv + vec3( 0.0, normalStep.y, 0.0 ) ).r - texture( sdfTex, uv - vec3( 0.0, normalStep.y, 0.0 ) ).r;
							float dz = texture( sdfTex, uv + vec3( 0.0, 0.0, normalStep.z ) ).r - texture( sdfTex, uv - vec3( 0.0, 0.0, normalStep.z ) ).r;
							vec3 normal = normalize( vec3( dx, dy, dz ) );

							// compute some basic lighting effects
							vec3 lightDirection = normalize( vec3( 1.0 ) );
							float lightIntensity =
								saturate( dot( normal, lightDirection ) ) +
								saturate( dot( normal, - lightDirection ) ) * 0.05 +
								0.1;
							gl_FragColor.rgb = vec3( lightIntensity );
							gl_FragColor.a = 1.0;

						}

					}

					#include <encodings_fragment>

				}
			`

		} );

		this.setValues( params );

	}

}
