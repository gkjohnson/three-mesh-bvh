import * as THREE from 'three';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
//import { acceleratedRaycast, MeshBVH, MeshBVHVisualizer } from '..';
import {
	MeshBVH,
	MeshBVHUniformStruct,
	shaderStructs,
	shaderIntersectFunction,
	SAH
} from '../src/index.js';

let scene, camera, renderer, environment, controls, diamond, gui, stats;

const params = {
	bounces: 3.0,
	ior: 2.4,
	correctMips: true,
	chromaticAberration: true,
	aberrationStrength: 0.01,
	fastChroma: false,
	animate: true,
};

init();

async function init() {

	// Setup basic renderer, controls, and profiler
	scene = new THREE.Scene();

	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );
	camera.position.set( 50, 75, 50 );

	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.outputEncoding = THREE.sRGBEncoding;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	environment = new RGBELoader()
		.load( 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/venice_sunset_1k.hdr', tex => {

			tex.mapping = THREE.EquirectangularReflectionMapping;
			tex.generateMipmaps = true;
			tex.minFilter = THREE.LinearMipmapLinearFilter;
			tex.magFilter = THREE.LinearFilter;

		} );

	scene.background = environment;

	controls = new OrbitControls( camera, renderer.domElement );

	const diamondGeo = ( await new GLTFLoader().loadAsync( './models/diamond.glb' ) ).scene.children[ 0 ].children[ 0 ].children[ 0 ].children[ 0 ].children[ 0 ].geometry;
	diamondGeo.scale( 10, 10, 10 );
	const bvh = new MeshBVH( diamondGeo.toNonIndexed(), { lazyGeneration: false, strategy: SAH } );
	const diamondMaterial = new THREE.ShaderMaterial( {
		uniforms: {
			envMap: { value: environment },
			bvh: { value: new MeshBVHUniformStruct() },
			bounces: { value: 3 },
			color: { value: new THREE.Color( 1, 1, 1 ) },
			ior: { value: 2.4 },
			correctMips: { value: true },
			fastChroma: { value: false },
			projectionMatrixInv: { value: camera.projectionMatrixInverse },
			viewMatrixInv: { value: camera.matrixWorld },
			chromaticAberration: { value: true },
			aberrationStrength: { value: 0.01 },
			resolution: { value: new THREE.Vector2( window.innerWidth, window.innerHeight ) }
		},
		vertexShader: /*glsl*/ `
	varying vec3 vWorldPosition;
	varying vec3 vNormal;
	uniform mat4 viewMatrixInv;
	void main() {
		vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
		vNormal = (viewMatrixInv * vec4(normalMatrix * normal, 0.0)).xyz;
		gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
	}
	`,
		fragmentShader: /*glsl*/ `
		#include <common>
	precision highp isampler2D;
	precision highp usampler2D;
	varying vec3 vWorldPosition;
	varying vec3 vNormal;
	uniform sampler2D envMap;
	uniform float bounces;
	${ shaderStructs }
	${ shaderIntersectFunction }
	uniform BVH bvh;
	uniform float ior;
	uniform vec3 color;
	uniform bool correctMips;
	uniform bool fastChroma;
	uniform bool chromaticAberration;
	uniform mat4 projectionMatrixInv;
	uniform mat4 viewMatrixInv;
	uniform mat4 modelMatrix;
	uniform vec2 resolution;
	uniform bool chromaticAbberation;
	uniform float aberrationStrength;
	#include <cube_uv_reflection_fragment>
	vec3 totalInternalReflection(vec3 ro, vec3 rd, vec3 normal, float ior, mat4 modelMatrixInverse) {
		vec3 rayOrigin = ro;
		vec3 rayDirection = rd;
		rayDirection = refract(rayDirection, normal, 1.0 / ior);
		rayOrigin = vWorldPosition + rayDirection * 0.001;
		rayOrigin = (modelMatrixInverse * vec4(rayOrigin, 1.0)).xyz;
		rayDirection = normalize((modelMatrixInverse * vec4(rayDirection, 0.0)).xyz);
		for(float i = 0.0; i < bounces; i++) {
			uvec4 faceIndices = uvec4( 0u );
			vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
			vec3 barycoord = vec3( 0.0 );
			float side = 1.0;
			float dist = 0.0;
			bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist );
			vec3 hitPos = rayOrigin + rayDirection * max(dist - 0.001, 0.0);
		   // faceNormal *= side;
			vec3 tempDir = refract(rayDirection, faceNormal, ior);
			if (length(tempDir) != 0.0) {
				rayDirection = tempDir;
				break;
			}
			rayDirection = reflect(rayDirection, faceNormal);
			rayOrigin = hitPos + rayDirection * 0.01;
		}
		rayDirection = normalize((modelMatrix * vec4(rayDirection, 0.0)).xyz);
		return rayDirection;
	}
	vec4 textureGradient(sampler2D envMap, vec3 rayDirection, vec3 directionCamPerfect) {
		vec2 uvv = equirectUv( rayDirection );
		vec2 smoothUv = equirectUv( directionCamPerfect );
		return texture(envMap, uvv, -100.0);//, dFdx(correctMips ? smoothUv : uvv), dFdy(correctMips ? smoothUv : uvv));
	  }
	void main() {
		mat4 modelMatrixInverse = inverse(modelMatrix);
		vec2 uv = gl_FragCoord.xy / resolution;
		vec3 directionCamPerfect = (projectionMatrixInv * vec4(uv * 2.0 - 1.0, 0.0, 1.0)).xyz;
		directionCamPerfect = (viewMatrixInv * vec4(directionCamPerfect, 0.0)).xyz;
		directionCamPerfect = normalize(directionCamPerfect);
		vec3 normal = vNormal;
		vec3 rayOrigin = cameraPosition;
		vec3 rayDirection = normalize(vWorldPosition - cameraPosition);
		vec3 finalColor;
		if (chromaticAberration) {
		vec3 rayDirectionG = totalInternalReflection(rayOrigin, rayDirection, normal, max(ior, 1.0), modelMatrixInverse);
		vec3 rayDirectionR, rayDirectionB;
		if (fastChroma) {
		 	rayDirectionR = normalize(rayDirectionG + 1.0 * vec3(aberrationStrength / 2.0));
         	rayDirectionB = normalize(rayDirectionG - 1.0 * vec3(aberrationStrength / 2.0));
		} else {
			 rayDirectionR = totalInternalReflection(rayOrigin, rayDirection, normal, max(ior * (1.0 - aberrationStrength), 1.0), modelMatrixInverse);
			 rayDirectionB = totalInternalReflection(rayOrigin, rayDirection, normal, max(ior * (1.0 + aberrationStrength), 1.0), modelMatrixInverse);
		}
		float finalColorR = textureGradient(envMap, rayDirectionR, directionCamPerfect).r;
		float finalColorG = textureGradient(envMap, rayDirectionG, directionCamPerfect).g;
		float finalColorB = textureGradient(envMap, rayDirectionB, directionCamPerfect).b;
		finalColor = vec3(finalColorR, finalColorG, finalColorB) * color;
		} else {
			rayDirection = totalInternalReflection(rayOrigin, rayDirection, normal, max(ior, 1.0), modelMatrixInverse);
			finalColor = textureGradient(envMap, rayDirection, directionCamPerfect).rgb;
			finalColor *= color;
		}
		gl_FragColor = vec4(LinearTosRGB(vec4(finalColor, 1.0)).rgb, 1.0);
	}
	`
	} );
	diamondMaterial.uniforms.bvh.value.updateFrom( bvh );
	diamond = new THREE.Mesh( diamondGeo, diamondMaterial );
	scene.add( diamond );

	gui = new GUI();
	gui.add( params, 'animate' );
	gui.add( params, 'bounces', 1.0, 10.0, 1.0 ).name( 'Bounces' ).onChange( v => {

		diamond.material.uniforms.bounces.value = v;

	} );
	gui.add( params, 'ior', 1.0, 5.0, 0.01 ).name( 'IOR' ).onChange( v => {

		diamond.material.uniforms.ior.value = v;

	} );
	gui.add( params, 'correctMips' ).onChange( v => {

		diamond.material.uniforms.correctMips.value = v;

	} );
	gui.add( params, 'fastChroma' ).onChange( v => {

		diamond.material.uniforms.fastChroma.value = v;

	} );
	gui.add( params, 'chromaticAberration' ).onChange( v => {

		diamond.material.uniforms.chromaticAberration.value = v;

	} );
	gui.add( params, 'aberrationStrength', 0.01, 0.1, 0.0001 ).onChange( v => {

		diamond.material.uniforms.aberrationStrength.value = v;

	} );

	stats = new Stats();
	stats.showPanel( 0 );
	document.body.appendChild( stats.dom );
	render();

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		diamond.material.uniforms.resolution.value = new THREE.Vector2( window.innerWidth, window.innerHeight );
		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

}

function render() {

	if ( params.animate ) {

		diamond.rotation.y += 0.01;

	}

	stats.update();
	controls.update();
	renderer.render( scene, camera );
	requestAnimationFrame( render );

}
