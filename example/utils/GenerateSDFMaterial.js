import { ShaderMaterial, Matrix4 } from 'three';
import { shaderIntersectFunction, shaderDistanceFunction, shaderStructs, MeshBVHUniformStruct } from '../..';

export class GenerateSDFMaterial extends ShaderMaterial {

	constructor( params ) {

		super( {

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

				${ shaderStructs }
				${ shaderIntersectFunction }
				${ shaderDistanceFunction }

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
					vec3 outPoint;
					float dist = bvhClosestPointToPoint( bvh, point.xyz, faceIndices, faceNormal, barycoord, side, outPoint );

					// if the triangle side is the back then it must be on the inside and the value negative
					gl_FragColor = vec4( side * dist, 0, 0, 0 );

				}

			`

		} );

		this.setValues( params );

	}

}
