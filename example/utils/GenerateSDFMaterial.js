import { ShaderMaterial, Matrix4 } from 'three';
import { BVHShaderGLSL, MeshBVHUniformStruct } from '../..';

export class GenerateSDFMaterial extends ShaderMaterial {

	constructor( params ) {

		super( {

			defines: {

				USE_SHADER_RAYCAST: window.location.hash.includes( 'USE_SHADER_RAYCAST' ) ? 1 : 0,

			},

			uniforms: {

				matrix: { value: new Matrix4() },
				zValue: { value: 0 },
				bvh: { value: new MeshBVHUniformStruct() }

			},

			vertexShader: /* glsl */`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}

			`,

			fragmentShader: /* glsl */`

				precision highp isampler2D;
				precision highp usampler2D;

				${ BVHShaderGLSL.common_functions }
				${ BVHShaderGLSL.bvh_struct_definitions }
				${ BVHShaderGLSL.bvh_ray_functions }
				${ BVHShaderGLSL.bvh_distance_functions }

				varying vec2 vUv;

				uniform BVH bvh;
				uniform float zValue;
				uniform mat4 matrix;

				void main() {

					// compute the point in space to check
					vec3 point = vec3( vUv, zValue );
					point -= vec3( 0.5 );
					point = ( matrix * vec4( point, 1.0 ) ).xyz;

					// retrieve the distance and other values
					uvec4 faceIndices;
					vec3 faceNormal;
					vec3 barycoord;
					float side;
					float rayDist;
					vec3 outPoint;
					float dist = bvhClosestPointToPoint( bvh, point.xyz, faceIndices, faceNormal, barycoord, side, outPoint );

					// This currently causes issues on some devices when rendering to 3d textures and texture arrays
					#if USE_SHADER_RAYCAST

					side = 1.0;
					bvhIntersectFirstHit( bvh, point.xyz, vec3( 0.0, 0.0, 1.0 ), faceIndices, faceNormal, barycoord, side, rayDist );

					#endif

					// if the triangle side is the back then it must be on the inside and the value negative
					gl_FragColor = vec4( side * dist, 0, 0, 0 );

				}

			`

		} );

		this.setValues( params );

	}

}
