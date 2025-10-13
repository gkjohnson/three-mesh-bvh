import * as THREE from "three/webgpu";
import { uniform, wgslFn, uv, varying, texture3D, positionGeometry, sampler, } from 'three/tsl';

export class RenderSDFLayerMaterial extends THREE.NodeMaterial {

	constructor( sdfTexture ) {

		super();

		const distToColor = wgslFn( /* wgsl */`
			fn distToColor(dist: f32) -> vec4f {
				if (dist > 0.0) {
					return vec4f(0.0, dist, 0.0, 1.0);
				} else {
					return vec4f(-dist, 0.0, 0.0, 1.0);
				}
			}
		` );

		const fragmentShaderParams = {
			layer: uniform( 0 ),
			grid_mode: uniform( false ),

			uv: varying( uv() ),
			sdf_sampler: sampler( sdfTexture ),
			sdf: texture3D( sdfTexture ),
		};

		let sdfLayerMaterialFragmentShader = wgslFn( /* wgsl */ `
			fn layer(
				layer: u32,
				grid_mode: bool,

				uv: vec2f,
				sdf_sampler: sampler,
				sdf: texture_3d<f32>,
			) -> vec4f {
				let dim = textureDimensions( sdf ).x;

				var texelCoords = vec3f(uv, f32(layer) / f32(dim));

				if (grid_mode) {
					let square_size = ceil(sqrt(f32(dim)));
					let max_image_offset = vec2f(square_size - 1.0, square_size - 1.0);
					let new_uv = uv * square_size;
					let image_offset = min(floor(new_uv), max_image_offset);
					let in_image_uv = new_uv - image_offset;
					let z_layer = image_offset.x + (square_size - 1 - image_offset.y) * square_size;
					if (z_layer >= f32(dim)) {
						return vec4f(0.0, 0.0, 0.0, 1.0);
					}
					texelCoords = vec3f(in_image_uv, z_layer / f32(dim));
				}
				let dist = textureSample(sdf, sdf_sampler, texelCoords).r;
				return distToColor(dist);
			}

		`, [ distToColor ] );

		this.fragmentNode = sdfLayerMaterialFragmentShader( fragmentShaderParams );

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
