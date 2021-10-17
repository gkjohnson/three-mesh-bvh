import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeBufferGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import Stats from 'stats.js';
import { GUI } from 'dat.gui';
import {
	MeshBVH, MeshBVHUniformStruct, FloatVertexAttributeTexture,
	shaderStructs, shaderIntersectFunction, SAH,
} from '../src/index.js';
import {
	FullScreenQuad,
} from 'three/examples/jsm/postprocessing/Pass.js';

const params = {
	enableRaytracing: true,
	smoothImageScaling: true,
	resolutionScale: 2,
	bounces: 10,
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
				Ray ray = ndcToCameraRay( ndc, cameraWorldMatrix, invProjectionMatrix );

				// Lambertian render
				gl_FragColor = vec4( 0.0 );

				vec3 throughputColor = vec3( 1.0 );
				vec3 randomPoint = vec3( .0 );
				for ( int i = 0; i < BOUNCES; i ++ ) {

					BVHRayHit hit;
					if ( ! bvhIntersectFirstHit( bvh, ray, hit ) ) {

						float value = ( ray.direction.y + 0.5 ) / 1.5;
						vec3 skyColor = mix( vec3( 1.0 ), vec3( 0.75, 0.85, 1.0 ), value );

						gl_FragColor = vec4( skyColor * throughputColor * 2.0, 1.0 );

						break;

					}

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

					float pointLength = max( length( randomPoint ), 1e-2 );
					randomPoint /= pointLength;
					randomPoint *= 0.999;

					// fetch the interpolated smooth normal
					vec3 normal =
						hit.side *
						textureSampleBarycoord(
							normalAttribute,
							hit.barycoord,
							hit.face.a,
							hit.face.b,
							hit.face.c
						).xyz;

					ray.direction = normalize( normal + randomPoint );
					ray.origin = hit.point + hit.face.normal * 1e-5;

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

	const rtFolder = gui.addFolder( 'raytracing' );
	rtFolder.add( params, 'enableRaytracing' ).name( 'enable' );
	rtFolder.add( params, 'smoothImageScaling' );
	rtFolder.add( params, 'resolutionScale', 1, 5, 1 ).onChange( resize );
	rtFolder.add( params, 'bounces', 1, 30, 1 ).onChange( v => {

		rtMaterial.defines.BOUNCES = parseInt( v );
		rtMaterial.needsUpdate = true;
		resetSamples();

	} );

	rtFolder.open();

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
	const dpr = window.devicePixelRatio * Math.pow( 2, - ( params.resolutionScale - 1 ) );
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
		const w = renderTarget.width;
		const h = renderTarget.height;
		camera.setViewOffset(
			w, h,
			Math.random(), Math.random(),
			w, h,
		);
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
