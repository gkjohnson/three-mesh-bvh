import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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
	mode: 0,
	resolutionScale: 1,
	bounces: 5,
	smoothNormals: true,
};

let renderer, camera, scene, gui, stats;
let rtQuad, finalQuad, renderTarget;
let samples = 0;

init();
render();

function init() {

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: false } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.outputEncoding = THREE.sRGBEncoding;
	renderer.domElement.style.imageRendering = 'pixelated';
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();

	const light = new THREE.DirectionalLight( 0xffffff, 1 );
	light.position.set( 1, 1, 1 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xb0bec5, 0.5 ) );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 0, 0, 4 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	const knot = new THREE.TorusKnotBufferGeometry( 1, 0.3, 1300, 150 );
	const bvh = new MeshBVH( knot, { maxLeafTris: 1, strategy: SAH } );

	const knotMesh = new THREE.Mesh( knot, new THREE.MeshNormalMaterial() );
	scene.add( knotMesh );

	const rtMaterial = new THREE.ShaderMaterial( {

		defines: {
			MODE: 0,
			BOUNCES: 5,
			SMOOTH_NORMALS: 1,
		},

		uniforms: {
			bvh: { value: new MeshBVHUniformStruct() },
			normalAttribute: { value: new FloatVertexAttributeTexture() },
			cameraWorldMatrix: { value: new THREE.Matrix4() },
			invProjectionMatrix: { value: new THREE.Matrix4() },
			time: { value: 0 },
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
			uniform float time;
			uniform float opacity;
			varying vec2 vUv;

			void main() {

				// get [-1, 1] normalized device coordinates
				vec2 ndc = 2.0 * vUv - vec2( 1.0 );
				Ray ray = ndcToCameraRay( ndc, cameraWorldMatrix, invProjectionMatrix );

				#if MODE == 0

					gl_FragColor = vec4( 0.0 );

					vec3 throughputColor = vec3( 1.0 );
					vec3 randomPoint = vec3( .0 );
					for ( int i = 0; i < BOUNCES; i ++ ) {

						BVHRayHit hit;
						if ( ! bvhIntersectFirstHit( bvh, ray, hit ) ) {

							float value = ( ray.direction.y + 0.5 ) / 2.0;
							vec3 skyColor = mix( vec3( 1.0 ), vec3( 0.75, 0.85, 1.0 ), value );

							gl_FragColor = vec4( skyColor * throughputColor, 1.0 );

							break;

						}

						throughputColor *= vec3( 0.9 );

						randomPoint = vec3(
							rand( vUv + float( i ) + time ),
							rand( - vUv + float( i ) - time ),
							rand( - vUv - float( i ) - time )
						);
						randomPoint -= 0.5;
						randomPoint *= 2.0;

						// TODO: this makes things really slow for some reason? Possibly due to divide by 0
						// and this randomized sphere doesn't look great. Possibly distribution is bad and
						// normalizing makes it worse
						// if ( length( randomPoint ) > 0.01 )
						// 	randomPoint = normalize( randomPoint );

						#if SMOOTH_NORMALS

						vec3 normal = textureSampleBarycoord( normalAttribute, hit.barycoord, hit.face.a, hit.face.b, hit.face.c ).xyz;

						#else

						vec3 normal = hit.face.normal;

						#endif

						ray.direction = normalize( normal + randomPoint );
						ray.origin = hit.point + hit.face.normal * 1e-5;

					}


				#elif MODE == 1

					BVHRayHit hit;
					bool didHit = bvhIntersectFirstHit( bvh, ray, hit );

					#if SMOOTH_NORMALS

					vec3 normal = textureSampleBarycoord( normalAttribute, hit.barycoord, hit.face.a, hit.face.b, hit.face.c ).xyz;

					#else

					vec3 normal = hit.face.normal;

					#endif

					gl_FragColor = ! didHit ? vec4( 0.0075, 0.015, 0.0225, 1.0 ) : vec4( normal, 1.0 );

				#endif

				gl_FragColor.a = opacity;

			}

		`

	} );

	rtQuad = new FullScreenQuad( rtMaterial );
	rtMaterial.uniforms.bvh.value.updateFrom( bvh );
	rtMaterial.uniforms.normalAttribute.value.updateFrom( knot.attributes.normal );
	rtMaterial.opacity = 0.5;
	rtMaterial.transparent = true;
	rtMaterial.depthWrite = false;

	renderTarget = new THREE.WebGLRenderTarget( 1, 1, {

		format: THREE.RGBFormat,
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
	rtFolder.add( params, 'smoothNormals' ).onChange( v => {

		rtMaterial.defines.SMOOTH_NORMALS = v ? 1 : 0;
		rtMaterial.needsUpdate = true;
		resetSamples();

	} );
	rtFolder.add( params, 'mode', { LAMBERT: 0, NORMALS: 1 } ).onChange( v => {

		rtMaterial.defines.MODE = parseInt( v );
		rtMaterial.needsUpdate = true;
		resetSamples();

	} );
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



	if ( params.enableRaytracing ) {

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
		const time = ( rtQuad.material.uniforms.time.value + 0.1 ) % 2;
		rtQuad.material.uniforms.time.value = time;
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

		camera.clearViewOffset();
		renderer.render( scene, camera );

	}

}
