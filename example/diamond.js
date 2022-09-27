import * as THREE from 'three';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import {
	MeshBVH,
	MeshBVHUniformStruct,
	shaderStructs,
	shaderIntersectFunction,
	SAH
} from '../src/index.js';

let scene, camera, renderer, environment, controls, diamond, gui, stats, clock;

const params = {

	color: '#ffffff',
	bounces: 3.0,
	ior: 2.4,
	aberrationStrength: 0.01,
	fastChroma: false,
	animate: true,

};

init();

async function init() {

	// renderer, scene, camera setup
	scene = new THREE.Scene();

	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );
	camera.position.set( 28, 15, 7 );

	// NOTE: antialiasing is disabled because the interpolation at face edges results in numeric issues
	// causing the raycast to intersect the front faces. An adjusted bvh cast function that affords filtering by
	// front / back faces would help this.
	renderer = new THREE.WebGLRenderer( { antialias: false } );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.outputEncoding = THREE.sRGBEncoding;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	controls = new OrbitControls( camera, renderer.domElement );

	clock = new THREE.Clock();

	// load the environment and model
	const environmentPromise = new RGBELoader()
		.loadAsync( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/venice_sunset_1k.hdr' );

	const gltfPromise = new GLTFLoader().loadAsync( '../models/diamond.glb' );

	let gltf;
	[ environment, gltf ] = await Promise.all( [ environmentPromise, gltfPromise ] );

	// initialize the background
	environment.mapping = THREE.EquirectangularReflectionMapping;
	environment.generateMipmaps = true;
	environment.minFilter = THREE.LinearMipmapLinearFilter;
	environment.magFilter = THREE.LinearFilter;
	scene.background = environment;

	// initialize the diamond material
	const diamondMaterial = new THREE.ShaderMaterial( {
		uniforms: {

			// scene / geometry information
			envMap: { value: environment },
			bvh: { value: new MeshBVHUniformStruct() },
			projectionMatrixInv: { value: camera.projectionMatrixInverse },
			viewMatrixInv: { value: camera.matrixWorld },
			resolution: { value: new THREE.Vector2() },

			// internal reflection settings
			bounces: { value: 3 },
			ior: { value: 2.4 },

			// chroma and color settings
			color: { value: new THREE.Color( 1, 1, 1 ) },
			fastChroma: { value: false },
			aberrationStrength: { value: 0.01 },

		},
		vertexShader: /*glsl*/ `
			varying vec3 vWorldPosition;
			varying vec3 vNormal;
			uniform mat4 viewMatrixInv;
			void main() {

				vWorldPosition = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
				vNormal = ( viewMatrixInv * vec4( normalMatrix * normal, 0.0 ) ).xyz;
				gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4( position , 1.0 );

			}
		`,
		fragmentShader: /*glsl*/ `
			#define RAY_OFFSET 0.001

			#include <common>
			precision highp isampler2D;
			precision highp usampler2D;

			${ shaderStructs }
			${ shaderIntersectFunction }

			varying vec3 vWorldPosition;
			varying vec3 vNormal;

			uniform sampler2D envMap;
			uniform float bounces;
			uniform BVH bvh;
			uniform float ior;
			uniform vec3 color;
			uniform bool fastChroma;
			uniform mat4 projectionMatrixInv;
			uniform mat4 viewMatrixInv;
			uniform mat4 modelMatrix;
			uniform vec2 resolution;
			uniform float aberrationStrength;

			#include <cube_uv_reflection_fragment>

			// performs an iterative bounce lookup modeling internal reflection and returns
			// a final ray direction.
			vec3 totalInternalReflection( vec3 incomingOrigin, vec3 incomingDirection, vec3 normal, float ior, mat4 modelMatrixInverse ) {

				vec3 rayOrigin = incomingOrigin;
				vec3 rayDirection = incomingDirection;

				// refract the ray direction on the way into the diamond and adjust offset from
				// the diamond surface for raytracing
				rayDirection = refract( rayDirection, normal, 1.0 / ior );
				rayOrigin = vWorldPosition + rayDirection * RAY_OFFSET;

				// transform the ray into the local coordinates of the model
				rayOrigin = ( modelMatrixInverse * vec4( rayOrigin, 1.0 ) ).xyz;
				rayDirection = normalize( ( modelMatrixInverse * vec4( rayDirection, 0.0 ) ).xyz );

				// perform multiple ray casts
				for( float i = 0.0; i < bounces; i ++ ) {

					// results
					uvec4 faceIndices = uvec4( 0u );
					vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
					vec3 barycoord = vec3( 0.0 );
					float side = 1.0;
					float dist = 0.0;

					// perform the raycast
					// the diamond is a water tight model so we assume we always hit a surface
					bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist );

					// derive the new ray origin from the hit results
					vec3 hitPos = rayOrigin + rayDirection * dist;

					// if we don't internally reflect then end the ray tracing and sample
					vec3 refractedDirection = refract( rayDirection, faceNormal, ior );
					bool totalInternalReflection = length( refract( rayDirection, faceNormal, ior ) ) == 0.0;
					if ( ! totalInternalReflection ) {

						rayDirection = refractedDirection;
						break;

					}

					// otherwise reflect off the surface internally for another hit
					rayDirection = reflect( rayDirection, faceNormal );
					rayOrigin = hitPos + rayDirection * RAY_OFFSET;

				}

				// return the final ray direction in world space
				return normalize( ( modelMatrix * vec4( rayDirection, 0.0 ) ).xyz );
			}

			vec4 envSample( sampler2D envMap, vec3 rayDirection ) {

				vec2 uvv = equirectUv( rayDirection );
				return texture( envMap, uvv );

			}

			void main() {

				mat4 modelMatrixInverse = inverse( modelMatrix );
				vec2 uv = gl_FragCoord.xy / resolution;

				vec3 normal = vNormal;
				vec3 rayOrigin = cameraPosition;
				vec3 rayDirection = normalize( vWorldPosition - cameraPosition );

				if ( aberrationStrength != 0.0 ) {

					// perform chromatic aberration lookups
					vec3 rayDirectionG = totalInternalReflection( rayOrigin, rayDirection, normal, max( ior, 1.0 ), modelMatrixInverse );
					vec3 rayDirectionR, rayDirectionB;

					if ( fastChroma ) {

						// fast chroma does a quick uv offset on lookup
						rayDirectionR = normalize( rayDirectionG + 1.0 * vec3( aberrationStrength / 2.0 ) );
						rayDirectionB = normalize( rayDirectionG - 1.0 * vec3( aberrationStrength / 2.0 ) );

					} else {

						// compared to a proper ray trace of diffracted rays
						float iorR = max( ior * ( 1.0 - aberrationStrength ), 1.0 );
						float iorB = max( ior * ( 1.0 + aberrationStrength ), 1.0 );
						rayDirectionR = totalInternalReflection(
							rayOrigin, rayDirection, normal,
							iorR, modelMatrixInverse
						);
						rayDirectionB = totalInternalReflection(
							rayOrigin, rayDirection, normal,
							iorB, modelMatrixInverse
						);

					}

					// get the color lookup
					float r = envSample( envMap, rayDirectionR ).r;
					float g = envSample( envMap, rayDirectionG ).g;
					float b = envSample( envMap, rayDirectionB ).b;
					gl_FragColor.rgb = vec3( r, g, b ) * color;
					gl_FragColor.a = 1.0;

				} else {

					// no chromatic aberration lookups
					rayDirection = totalInternalReflection( rayOrigin, rayDirection, normal, max( ior, 1.0 ), modelMatrixInverse );
					gl_FragColor.rgb = envSample( envMap, rayDirection ).rgb * color;
					gl_FragColor.a = 1.0;

				}

				#include <tonemapping_fragment>
				#include <encodings_fragment>

			}
		`
	} );

	// initialize the diamond geometry and material uniforms
	const diamondGeo = gltf.scene.children[ 0 ].children[ 0 ].children[ 0 ].children[ 0 ].children[ 0 ].geometry;
	diamondGeo.scale( 10, 10, 10 );

	const bvh = new MeshBVH( diamondGeo, { strategy: SAH, maxLeafTris: 1 } );
	diamondMaterial.uniforms.bvh.value.updateFrom( bvh );
	diamond = new THREE.Mesh( diamondGeo, diamondMaterial );
	scene.add( diamond );

	// gui setup
	gui = new GUI();
	gui.add( params, 'animate' );
	gui.addColor( params, 'color' ).name( 'Color' ).onChange( v => {

		diamond.material.uniforms.color.value.set( v );

	} );
	gui.add( params, 'bounces', 1.0, 10.0, 1.0 ).name( 'Bounces' ).onChange( v => {

		diamond.material.uniforms.bounces.value = v;

	} );
	gui.add( params, 'ior', 1.0, 5.0, 0.01 ).name( 'IOR' ).onChange( v => {

		diamond.material.uniforms.ior.value = v;

	} );
	gui.add( params, 'fastChroma' ).onChange( v => {

		diamond.material.uniforms.fastChroma.value = v;

	} );
	gui.add( params, 'aberrationStrength', 0.0, 0.1, 0.0001 ).onChange( v => {

		diamond.material.uniforms.aberrationStrength.value = v;

	} );

	stats = new Stats();
	stats.showPanel( 0 );
	document.body.appendChild( stats.dom );
	render();

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		diamond.material.uniforms.resolution.value.set( window.innerWidth, window.innerHeight );
		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

}

function render() {

	if ( params.animate ) {

		diamond.rotation.y += clock.getDelta() * 0.25;

	}

	stats.update();
	controls.update();
	renderer.render( scene, camera );
	requestAnimationFrame( render );

}
