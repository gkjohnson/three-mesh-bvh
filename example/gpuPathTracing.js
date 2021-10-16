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
};

let renderer, camera, scene, gui, stats;
let rtQuad;

init();
render();

function init() {

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: false } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.outputEncoding = THREE.sRGBEncoding;
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

	const knot = new THREE.TorusKnotBufferGeometry( 1, 0.3, 300, 50 );
	const bvh = new MeshBVH( knot, { maxLeafTris: 1, strategy: SAH } );

	const knotMesh = new THREE.Mesh( knot, new THREE.MeshNormalMaterial() );
	scene.add( knotMesh );

	const rtMaterial = new THREE.ShaderMaterial( {

		defines: { MODE: 0 },

		uniforms: {
			bvh: { value: new MeshBVHUniformStruct() },
			normalAttribute: { value: new FloatVertexAttributeTexture() },
			cameraWorldMatrix: { value: new THREE.Matrix4() },
			invProjectionMatrix: { value: new THREE.Matrix4() },
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

			uniform mat4 cameraWorldMatrix;
			uniform mat4 invProjectionMatrix;
			uniform sampler2D normalAttribute;
			uniform BVH bvh;
			varying vec2 vUv;

			void main() {

				// get [-1, 1] normalized device coordinates
				vec2 ndc = 2.0 * vUv - vec2( 1.0 );
				Ray ray = ndcToCameraRay( ndc, cameraWorldMatrix, invProjectionMatrix );

				#if MODE == 0

					BVHRayHit hit;
					bool didHit = bvhIntersectFirstHit( bvh, ray, hit );
					gl_FragColor = mix( vec4( 0.03, 0.06, 0.09, 1.0 ), vec4( 1.0 ), float( didHit ) );

				#elif MODE == 1

					BVHRayHit hit;
					bool didHit = bvhIntersectFirstHit( bvh, ray, hit );
					gl_FragColor = ! didHit ? vec4( 0.03, 0.06, 0.09, 1.0 ) : vec4( hit.face.normal, 1.0 );

				#elif MODE == 2

					BVHRayHit hit;
					bool didHit = bvhIntersectFirstHit( bvh, ray, hit );
					vec3 smoothNormal = textureSampleBarycoord( normalAttribute, hit.barycoord, hit.face.a, hit.face.b, hit.face.c ).xyz;
					gl_FragColor = ! didHit ? vec4( 0.03, 0.06, 0.09, 1.0 ) : vec4( normalize( smoothNormal ), 1.0 );

				#endif
			}

		`

	} );

	rtQuad = new FullScreenQuad( rtMaterial );
	rtMaterial.uniforms.bvh.value.updateFrom( bvh );
	rtMaterial.uniforms.normalAttribute.value.updateFrom( knot.attributes.normal );

	new OrbitControls( camera, renderer.domElement );

	gui = new GUI();

	const rtFolder = gui.addFolder( 'raytracing' );
	rtFolder.add( params, 'enableRaytracing' ).name( 'enable' );
	rtFolder.add( params, 'mode', { LAMBERT: 0, NORMALS: 1, SMOOTH_NORMALS: 2 } ).onChange( v => {

		rtMaterial.defines.MODE = parseInt( v );
		rtMaterial.needsUpdate = true;

	} );
	rtFolder.open();


	gui.open();

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

}

function render() {

	stats.update();
	requestAnimationFrame( render );

	camera.updateMatrixWorld();

	if ( params.enableRaytracing ) {

		rtQuad.material.uniforms.cameraWorldMatrix.value.copy( camera.matrixWorld );
		rtQuad.material.uniforms.invProjectionMatrix.value.copy( camera.projectionMatrixInverse );
		rtQuad.render( renderer );

	} else {

		renderer.render( scene, camera );

	}

}
