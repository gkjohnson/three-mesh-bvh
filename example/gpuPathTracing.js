import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeBufferGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import Stats from 'stats.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import {
	MeshBVH, MeshBVHUniformStruct, FloatVertexAttributeTexture,
	shaderStructs, shaderIntersectFunction, SAH,
} from '..';

const params = {
	enableRaytracing: true,
	smoothImageScaling: true,
	resolutionScale: 0.5 / window.devicePixelRatio,
	bounces: 3,
	accumulate: true,
};

let renderer, camera, scene, gui, stats;
let rtQuad, finalQuad, renderTarget, mesh;
let samples = 0;
let outputContainer;

init();
render();

function init() {

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: false } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setClearColor( 0x09141a );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.outputEncoding = THREE.sRGBEncoding;
	document.body.appendChild( renderer.domElement );

	outputContainer = document.getElementById( 'output' );

	// scene setup
	scene = new THREE.Scene();

	const light = new THREE.DirectionalLight( 0xffffff, 1 );
	light.position.set( 1, 1, 1 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xb0bec5, 0.5 ) );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( - 2, 2, 3 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// hand-tuned ray origin offset values to accommodate floating point error. Mobile offset
	// tuned from Pixel 3 device that reports as highp but seemingly has low precision.
	const rtMaterial = new THREE.ShaderMaterial( {

		defines: {
			BOUNCES: 5,
		},

		uniforms: {
			bvh: { value: new MeshBVHUniformStruct() },
			normalAttribute: { value: new FloatVertexAttributeTexture() },
			cameraWorldMatrix: { value: new THREE.Matrix4() },
			invProjectionMatrix: { value: new THREE.Matrix4() },
			seed: { value: 0 },
			opacity: { value: 1 },
		},

		vertexShader: /* glsl */`

			varying vec2 vUv;
			void main() {

				vec4 mvPosition = vec4( position, 1.0 );
				mvPosition = modelViewMatrix * mvPosition;
				gl_Position = projectionMatrix * mvPosition;

				vUv = uv;

			}

		`,

		fragmentShader: /* glsl */`
			#define RAY_OFFSET 1e-5

			precision highp isampler2D;
			precision highp usampler2D;
			${ shaderStructs }
			${ shaderIntersectFunction }
			#include <common>

			uniform mat4 cameraWorldMatrix;
			uniform mat4 invProjectionMatrix;
			uniform sampler2D normalAttribute;
			uniform BVH bvh;
			uniform float seed;
			uniform float opacity;
			varying vec2 vUv;

			void main() {

				// get [-1, 1] normalized device coordinates
				vec2 ndc = 2.0 * vUv - vec2( 1.0 );
				vec3 rayOrigin, rayDirection;
				ndcToCameraRay( ndc, cameraWorldMatrix, invProjectionMatrix, rayOrigin, rayDirection );

				// Lambertian render
				gl_FragColor = vec4( 0.0 );

				vec3 throughputColor = vec3( 1.0 );
				vec3 randomPoint = vec3( .0 );

				// hit results
				uvec4 faceIndices = uvec4( 0u );
				vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
				vec3 barycoord = vec3( 0.0 );
				float side = 1.0;
				float dist = 0.0;

				for ( int i = 0; i < BOUNCES; i ++ ) {

					if ( ! bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist ) ) {

						float value = ( rayDirection.y + 0.5 ) / 1.5;
						vec3 skyColor = mix( vec3( 1.0 ), vec3( 0.75, 0.85, 1.0 ), value );

						gl_FragColor = vec4( skyColor * throughputColor * 2.0, 1.0 );

						break;

					}

					// 1 / PI attenuation for physically correct lambert model
					// https://www.rorydriscoll.com/2009/01/25/energy-conservation-in-games/
					throughputColor *= 1.0 / PI;

					randomPoint = vec3(
						rand( vUv + float( i + 1 ) + vec2( seed, seed ) ),
						rand( - vUv * seed + float( i ) - seed ),
						rand( - vUv * float( i + 1 ) - vec2( seed, - seed ) )
					);
					randomPoint -= 0.5;
					randomPoint *= 2.0;

					// ensure the random vector is not 0,0,0 and that it won't exactly negate
					// the surface normal

					float pointLength = max( length( randomPoint ), 1e-4 );
					randomPoint /= pointLength;
					randomPoint *= 0.999;

					// fetch the interpolated smooth normal
					vec3 normal =
						side *
						textureSampleBarycoord(
							normalAttribute,
							barycoord,
							faceIndices.xyz
						).xyz;

					// adjust the hit point by the surface normal by a factor of some offset and the
					// maximum component-wise value of the current point to accommodate floating point
					// error as values increase.
					vec3 point = rayOrigin + rayDirection * dist;
					vec3 absPoint = abs( point );
					float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );
					rayOrigin = point + faceNormal * ( maxPoint + 1.0 ) * RAY_OFFSET;
					rayDirection = normalize( normal + randomPoint );

				}

				gl_FragColor.a = opacity;

			}

		`

	} );

	rtQuad = new FullScreenQuad( rtMaterial );
	rtMaterial.transparent = true;
	rtMaterial.depthWrite = false;

	// load mesh and set up material BVH attributes
	new GLTFLoader().load( '../models/DragonAttenuation.glb', gltf => {

		let dragonMesh;
		gltf.scene.traverse( c => {

			if ( c.isMesh && c.name === 'Dragon' ) {

				dragonMesh = c;
				c.geometry.scale( 0.25, 0.25, 0.25 ).rotateX( Math.PI / 2 );

			}

		} );

		const planeGeom = new THREE.PlaneBufferGeometry( 5, 5, 1, 1 );
		planeGeom.rotateX( - Math.PI / 2 );

		const merged = mergeBufferGeometries( [ planeGeom, dragonMesh.geometry ], false );
		merged.translate( 0, - 0.5, 0 );

		mesh = new THREE.Mesh( merged, new THREE.MeshStandardMaterial() );
		scene.add( mesh );

		const bvh = new MeshBVH( mesh.geometry, { maxLeafTris: 1, strategy: SAH } );
		rtMaterial.uniforms.bvh.value.updateFrom( bvh );
		rtMaterial.uniforms.normalAttribute.value.updateFrom( mesh.geometry.attributes.normal );

	} );


	renderTarget = new THREE.WebGLRenderTarget( 1, 1, {

		format: THREE.RGBAFormat,
		type: THREE.FloatType,

	} );

	finalQuad = new FullScreenQuad( new THREE.MeshBasicMaterial( {

		map: renderTarget.texture,

	} ) );

	const controls = new OrbitControls( camera, renderer.domElement );
	controls.addEventListener( 'change', () => {

		resetSamples();

	} );

	gui = new GUI();
	gui.add( params, 'enableRaytracing' ).name( 'enable' );
	gui.add( params, 'accumulate' );
	gui.add( params, 'smoothImageScaling' );
	gui.add( params, 'resolutionScale', 0.1, 1, 0.01 ).onChange( resize );
	gui.add( params, 'bounces', 1, 10, 1 ).onChange( v => {

		rtMaterial.defines.BOUNCES = parseInt( v );
		rtMaterial.needsUpdate = true;
		resetSamples();

	} );
	gui.open();

	window.addEventListener( 'resize', resize, false );
	resize();

}

function resetSamples() {

	samples = 0;

}

function resize() {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	const w = window.innerWidth;
	const h = window.innerHeight;
	const dpr = window.devicePixelRatio * params.resolutionScale;
	renderer.setSize( w, h );
	renderer.setPixelRatio( dpr );

	renderTarget.setSize( w * dpr, h * dpr );

	resetSamples();

}

function render() {

	stats.update();
	requestAnimationFrame( render );

	renderer.domElement.style.imageRendering = params.smoothImageScaling ? 'auto' : 'pixelated';

	if ( mesh && params.enableRaytracing ) {

		// jitter camera for AA
		if ( params.accumulate ) {

			if ( samples === 0 ) {

				camera.clearViewOffset();

			} else {

				const w = renderTarget.width;
				const h = renderTarget.height;
				camera.setViewOffset(
					w, h,
					Math.random() - 0.5, Math.random() - 0.5,
					w, h,
				);

			}

		} else {

			resetSamples();

		}

		camera.updateMatrixWorld();

		// update material
		// keep appending a value that doesn't divide evenly into 2 so we have a different seed every frame
		const seed = ( rtQuad.material.uniforms.seed.value + 0.11111 ) % 2;
		rtQuad.material.uniforms.seed.value = seed;
		rtQuad.material.uniforms.cameraWorldMatrix.value.copy( camera.matrixWorld );
		rtQuad.material.uniforms.invProjectionMatrix.value.copy( camera.projectionMatrixInverse );
		rtQuad.material.uniforms.opacity.value = 1 / ( samples + 1 );

		// render float target
		renderer.autoClear = samples === 0;
		renderer.setRenderTarget( renderTarget );
		rtQuad.render( renderer );

		// render to screen
		renderer.setRenderTarget( null );
		finalQuad.render( renderer );

		renderer.autoClear = true;
		samples ++;

	} else {

		resetSamples();
		camera.clearViewOffset();
		renderer.render( scene, camera );

	}

	outputContainer.innerText = `samples: ${ samples }`;

}
