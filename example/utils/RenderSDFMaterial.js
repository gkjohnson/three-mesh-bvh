import { ShaderMaterial, Matrix4 } from 'three';

export class RenderSDFMaterial extends ShaderMaterial {

	constructor( params ) {

		super( {

			defines: {

				MAX_STEPS: 500,
				SURFACE_EPSILON: 0.001,

			},

			uniforms: {

				sdfTex: { value: null },
				normalStep: { value: 0.01 },
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

				uniform sampler3D sdfTex;
				uniform float normalStep;
				uniform mat4 projectionInverse;
				uniform mat4 sdfTransformInverse;

				#include <common>

				// distance to box bounds
				// TODO: find comment describing algorithm
				// TODO: update output values
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

					// get world ray direction
					vec3 rayOrigin = vec4( 0.0 );
					vec4 homogenousDirection = projectionInverse * vec3( vUv, 0.0, 1.0 );
					vec3 rayDirection = normalize( homogenousDirection.xyz / homogenousDirection.w );

					// transform ray into local coordinates of box
					rayOrigin = ( sdfTransformInverse * vec4( rayOrigin, 1.0 ) ).xyz;
					rayDirection = normalize( ( sdfTransformInverse * vec4( rayDirection, 0.0 ) ).xyz );

					// TODO: just make this a "hit box" flag / output location
					vec2 boxIntersectionInfo = rayBoxDist( vec3( - 0.5 ), vec3( 0.5 ), rayOrigin, rayDirection );
					float distToBox = boxIntersectionInfo.x;
					float distInsideBox = boxIntersectionInfo.y;
					bool intersectsBox = distInsideBox > 0.0 && distToBox < linDepth - 0.1;

					gl_FragColor = vec4( 0.0 );
					if ( intersectsBox ) {


						bool intersectsSurface = false;
						vec3 point = origin + rayDirection * distToBox;
						for ( int i = 0; i < MAX_STEPS; i ++ ) {

							// sdf box extends from - 0.5 to 0.5
							vec3 uv = point + vex3( 0.5 );
							if ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || uv.z < 0.0 || uv.z > 1.0 ) {

								break;

							}

							// sample the sdf texture
							float distanceToSurface = texture( sdfTex, uv );
							if ( abs( distanceToSurface ) < SURFACE_EPSILON ) {

								intersectsSurface = true;
								break;

							}

							point += rayDirection * distanceToSurface;

						}

						// find the surface
						if ( intersectsSurface ) {

							float dx = texture( sdfTex, samplePoint + vec3( normalStep, 0.0, 0.0 ) ) - texture( sdfTex, samplePoint - vec3( normalStep, 0.0, 0.0 ) );
							float dy = texture( sdfTex, samplePoint + vec3( 0.0, normalStep, 0.0 ) ) - texture( sdfTex, samplePoint - vec3( 0.0, normalStep, 0.0 ) );
							float dz = texture( sdfTex, samplePoint + vec3( 0.0, 0.0, normalStep ) ) - texture( sdfTex, samplePoint - vec3( 0.0, 0.0, normalStep ) );
							vec3 normal = normalize( vec3( dx, dy, dz ) );

							// NOTE: could handle lighting from light objects here
							vec3 lightDirection = normalize( vec3( 1.0 ) );
							gl_FragColor = vec4( dot( normal, lightDirection ), 1.0 ) ;

						}

					}

				}
			`

		} );

		this.setValues( params );

	}

}
