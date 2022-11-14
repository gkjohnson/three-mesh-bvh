import { ShaderMaterial } from 'three';

export class RenderSDFLayerMaterial extends ShaderMaterial {

	constructor( params ) {

		super( {

			defines: {

				DISPLAY_GRID: 0,

			},

			uniforms: {

				sdfTex: { value: null },
				layer: { value: 0 },
				layers: { value: 0 },

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
				uniform float layer;
				uniform float layers;

				void main() {

					#if DISPLAY_GRID

					float dim = ceil( sqrt( layers ) );
					vec2 cell = floor( vUv * dim );
					vec2 frac = vUv * dim - cell;
					float zLayer = ( cell.y * dim + cell.x ) / ( dim * dim );

					float dist = texture( sdfTex, vec3( frac, zLayer ) ).r;
					gl_FragColor.rgb = dist > 0.0 ? vec3( 0, dist, 0 ) : vec3( - dist, 0, 0 );
					gl_FragColor.a = 1.0;

					#else

					float dist = texture( sdfTex, vec3( vUv, layer ) ).r;
					gl_FragColor.rgb = dist > 0.0 ? vec3( 0, dist, 0 ) : vec3( - dist, 0, 0 );
					gl_FragColor.a = 1.0;

					#endif

					#include <encodings_fragment>

				}
			`

		} );

		this.setValues( params );

	}

}
