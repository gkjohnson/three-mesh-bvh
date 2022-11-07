import { ShaderMaterial, Matrix4, Vector3, Vector2 } from 'three';

export class RenderSDFMaterial extends ShaderMaterial {

	constructor( params ) {

		super( {

			uniforms: {

				sdfTexture: { value: null },
				projectionMatrixInv: { value: new Matrix4() },
				viewMatrixInv: { value: new Matrix4() },
				cameraPos: { value: new Vector3() },
				normalStep: { value: new Vector3() },
				sdfMat: { value: new Matrix4() },
				sdfMatInv: { value: new Matrix4() },
				resolution: { value: new Vector2() }

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

				uniform sampler2D sceneDepth;
				uniform sampler3D sdfTexture;
				uniform mat4 projectionMatrixInv;
				uniform mat4 viewMatrixInv;
				uniform mat4 sdfMat;
				uniform mat4 sdfMatInv;
				uniform vec3 cameraPos;
				uniform vec2 resolution;

				#include <common>

				vec3 getWorldPos( float depth, vec2 coord ) {

					float z = depth * 2.0 - 1.0;
					vec4 clipSpacePosition = vec4( coord * 2.0 - 1.0, z, 1.0 );
					vec4 viewSpacePosition = projectionMatrixInv * clipSpacePosition;

					// Perspective division
					viewSpacePosition /= viewSpacePosition.w;

					vec4 worldSpacePosition = viewMatrixInv * viewSpacePosition;
					return worldSpacePosition.xyz;

				}

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

				vec3 toSDFSpace( vec3 point ) {

					return ( sdfMatInv * vec4( point, 1.0 ) ).xyz;

				}

				vec3 texCoord( vec3 samplePoint ) {

					samplePoint = samplePoint;
					return ( samplePoint + ( boxSize / 2.0 ) - boxCenter ) / boxSize;

				}

				float map( vec3 texCoord ) {

					float timePeriod = mod( time * 0.2, 3.0 );
					float dist = texture( sdfTexture1, texCoord ).x;
					return dist;

				}

				vec4 colorMap( vec3 texCoord ) {

					return texture( sdfTexture2, texCoord );

				}

				vec3 colorMapSampleSmart( vec3 p, vec3 n ) {

					vec4 initialSample = colorMap( texCoord( p ) );
					vec3 col = vec3( 0.0 );
					if ( initialSample.w < 1.0 ) {

						float maxW = initialSample.w;
						vec3 total = initialSample.w * initialSample.rgb;
						vec4 c = colorMap( texCoord( p + n ) );
						maxW += c.w;
						total += c.xyz * c.w;
						c = colorMap( texCoord( p - n ) );
						maxW += c.w;
						total += c.xyz * c.w;

						if ( maxW < 1.0 ) {

							float weight = 1.0 - clamp( ( maxW - 0.75 ) / 0.25, 0.0, 1.0 );
							for( float x = -1.0; x <= 1.0; x += 2.0 ) {

								for( float y = -1.0; y <= 1.0; y+= 2.0 ) {

									for( float z = -1.0; z <= 1.0; z+= 2.0 ) {

										vec4 c = colorMap(texCoord(p + vec3( x, y, z ) ) );
										maxW += c.w * weight;
										total += c.xyz * c.w * weight;

									}

								}

							}

						}

						col = mix( initialSample.xyz, total / maxW, 1.0 - clamp( ( initialSample.w ) / 1.0, 0.0, 1.0 ) );

					} else {

						col = initialSample.xyz;

					}
					return col;

				}


				vec3 getNormal( vec3 samplePoint ) {

					return normalize( vec3(
						map( texCoord( samplePoint + vec3( normalStep, 0.0, 0.0 ) ) ) - map( texCoord( samplePoint - vec3( normalStep, 0.0, 0.0 ) ) ),
						map( texCoord( samplePoint + vec3( 0.0, normalStep, 0.0 ) ) ) - map( texCoord( samplePoint - vec3( 0.0, normalStep, 0.0 ) ) ),
						map( texCoord( samplePoint + vec3( 0.0, 0.0, normalStep ) ) ) - map( texCoord( samplePoint - vec3( 0.0, 0.0, normalStep ) ) )
					));

				}

				vec3 computeNormal( vec3 worldPos ) {

					vec2 downUv = vUv + vec2( 0.0, 1.0 / resolution.y );
					vec3 downPos = getWorldPos( texture2D( sceneDepth, downUv ).x, downUv ).xyz;
					vec2 rightUv = vUv + vec2( 1.0 / resolution.x, 0.0 );
					vec3 rightPos = getWorldPos( texture2D( sceneDepth, rightUv ).x, rightUv ).xyz;
					vec2 upUv = vUv - vec2( 0.0, 1.0 / resolution.y );
					vec3 upPos = getWorldPos( texture2D( sceneDepth, upUv ).x, upUv ).xyz;
					vec2 leftUv = vUv - vec2( 1.0 / resolution.x, 0.0 );
					vec3 leftPos = getWorldPos( texture2D( sceneDepth, leftUv ).x, leftUv ).xyz;
					int hChoice;
					int vChoice;
					if ( length( leftPos - worldPos ) < length( rightPos - worldPos ) ) {

						hChoice = 0;

					} else {

						hChoice = 1;

					}

					if ( length( upPos - worldPos ) < length( downPos - worldPos ) ) {

						vChoice = 0;

					} else {

						vChoice = 1;

					}

					vec3 hVec;
					vec3 vVec;
					if ( hChoice == 0 && vChoice == 0 ) {

						hVec = leftPos - worldPos;
						vVec = upPos - worldPos;

					} else if ( hChoice == 0 && vChoice == 1 ) {

						hVec = leftPos - worldPos;
						vVec = worldPos - downPos;

					} else if ( hChoice == 1 && vChoice == 1 ) {

						hVec = rightPos - worldPos;
						vVec = downPos - worldPos;

					} else if ( hChoice == 1 && vChoice == 0 ) {

						hVec = rightPos - worldPos;
						vVec = worldPos - upPos;

					}

					return normalize( cross( hVec, vVec ) );

				}

				void main() {

					vec4 diffuse = texture2D( sceneDiffuse, vUv );
					float depth = texture2D( sceneDepth, vUv ).x;
					vec3 worldPos = getWorldPos( depth, vUv );
					vec3 normal = ( viewMatrixInv * normalize( vec4( ( texture2D(normalTexture, vUv).rgb - 0.5 ) * 2.0, 0.0 ) ) ).xyz;
					vec3 origin = cameraPos;
					float linDepth = length( origin - worldPos );
					vec3 rayDir = normalize( worldPos - origin );
					origin = ( sdfMatInv * vec4( origin, 1.0 ) ).xyz;
					rayDir = normalize( ( sdfMatInv * vec4( rayDir, 0.0 ) ).xyz );
					vec2 boxIntersectionInfo = rayBoxDist( boxCenter - boxSize / 2.0, boxCenter + boxSize / 2.0, origin, rayDir );
					float distToBox = boxIntersectionInfo.x;
					float distInsideBox = boxIntersectionInfo.y;
					bool intersectsBox = distInsideBox > 0.0 && distToBox < linDepth - 0.1;
					gl_FragColor = vec4( diffuse.rgb, 1.0 );
					vec3 lightDir = normalize( vec3( 150.0, 200.0, 50.0 ) );
					bool intersectedSDF = false;
					vec3 col = vec3( 0.0 );

					if ( intersectsBox ) {

						vec3 startPos = origin + distToBox * rayDir;
						float distanceAlongRay = 0.01;
						bool hit = false;
						for( int i = 0; i < 2048; i ++ ) {

							vec3 samplePoint = startPos + rayDir * distanceAlongRay;
							if ( distance( samplePoint, origin ) > linDepth ) {

								break;

							}

							vec3 tex = texCoord( samplePoint );
							//samplePoint = (samplePoint + (boxSize / 2.0) - boxCenter) / boxSize;
							if ( tex.x < 0.0 || tex.x > 1.0 || tex.y < 0.0 || tex.y > 1.0 || tex.z < 0.0 || tex.z > 1.0 ) {

								break;

							}

							float distToSurface = map( tex );
							distanceAlongRay += distToSurface;
							if ( distToSurface < 0.01 ) {

								hit = true;
								break;

							}

						}

						if ( hit ) {

							vec3 p = startPos + rayDir * distanceAlongRay;
							vec3 n = getNormal( p );

							col =  colorMapSampleSmart( p, n );
							normal = normalize( ( sdfMat * vec4( n, 0.0 ) ) ).xyz;
							worldPos = ( sdfMat * vec4( p, 1.0 ) ).xyz;
							intersectedSDF = true;

						}

					}

					float shadow = 0.0;
					if ( intersectedSDF ) {

						float specular = clamp( dot( rayDir, reflect( lightDir, normal ) ), 0.0, 1.0 );
						gl_FragColor = vec4( vec3( 0.25 + 0.35 * max( dot( normal, lightDir ), 0.0 ) * ( 1.0 - shadow )
						+ 0.1 * max( dot( normal, - lightDir ), 0.0 ) ) * col, 1.0 );

					} else {

						if ( distance( worldPos, cameraPos ) < 1000.0 && shadow > 0.0 ) {

							gl_FragColor.rgb *= ( 1.0 - 0.7 * max( dot( normal, lightDir ), 0.0 ) * shadow );

						}

					}

				}
			`

		} );

		this.setValues( params );

	}

}
