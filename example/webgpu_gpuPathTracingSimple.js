import * as THREE from 'three';
import { WebGPURenderer, StorageTexture, MeshBasicNodeMaterial } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import Stats from 'three/addons/libs/stats.module.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import {
	attribute, uniform, wgslFn, varyingProperty,
	textureStore, texture, colorSpaceToWorking,
	workgroupId, localId,
} from 'three/tsl';

// three-mesh-bvh
import { BVHComputeData, ndcToCameraRay } from 'three-mesh-bvh/webgpu';

const params = {
	enableRaytracing: true,
	animate: true,
	resolutionScale: 1.0 / window.devicePixelRatio,
	smoothNormals: true,
};

let renderer, camera, scene, gui, stats;
let fsQuad, mesh, clock, controls;
let fsMaterial, computeKernel, outputTex;
let bvhData;
let dispatchSize = [];
const WORKGROUP_SIZE = [ 8, 8, 1 ];

init();

function init() {

	// renderer
	renderer = new WebGPURenderer( {

		canvas: document.createElement( 'canvas' ),
		antialias: true,
		forceWebGL: false,

	} );
	renderer.setAnimationLoop( render );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setClearColor( 0x09141a );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	document.body.appendChild( renderer.domElement );

	// scene init
	scene = new THREE.Scene();

	// light init
	const light = new THREE.DirectionalLight( 0xffffff, 1 );
	light.position.set( 1, 1, 1 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xb0bec5, 0.5 ) );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 1, 10 );
	camera.position.set( 0, 0, 4 );
	camera.updateProjectionMatrix();

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// geometry and BVH setup
	const knotGeometry = new THREE.TorusKnotGeometry( 1, 0.3, 300, 50 );
	mesh = new THREE.Mesh( knotGeometry, new THREE.MeshStandardMaterial() );
	scene.add( mesh );

	// animation
	clock = new THREE.Clock();
	bvhData = new BVHComputeData( mesh, { attributes: { position: 'vec4f', normal: 'vec4f' } } );
	bvhData.update();

	outputTex = new StorageTexture( 1, 1 );

	resize();

	// TSL
	const computeShaderParams = {
		outputTex: textureStore( outputTex ),
		smoothNormals: uniform( 1 ),

		// transforms
		inverseProjectionMatrix: uniform( new THREE.Matrix4() ),
		cameraToModelMatrix: uniform( new THREE.Matrix4() ),

		// compute variables
		workgroupSize: uniform( new THREE.Vector3() ),
		workgroupId: workgroupId,
		localId: localId
	};

	const computeShader = wgslFn( /* wgsl */`

		fn compute(
			outputTex: texture_storage_2d<rgba8unorm, write>,
			smoothNormals: u32,
			inverseProjectionMatrix: mat4x4f,
			cameraToModelMatrix: mat4x4f,
			workgroupSize: vec3u,
			workgroupId: vec3u,
			localId: vec3u,
		) -> void {

			// to screen coordinates
			let dimensions = textureDimensions( outputTex );
			let indexUV = workgroupSize.xy * workgroupId.xy + localId.xy;
			let uv = vec2f( indexUV ) / vec2f( dimensions );
			let ndc = uv * 2.0 - vec2f( 1.0 );

			// scene ray (world space)
			var ray = ndcToCameraRay( ndc, cameraToModelMatrix * inverseProjectionMatrix );

			// get hit result
			var hit: IntersectionResult;
			bvh_RaycastFirstHit( ray, &hit );

			// write result
			if ( hit.didHit && hit.dist < 1.0 ) {

				let localNormal = normalize( bvh_sampleTrianglePoint( hit.barycoord, hit.indices.xyz ).normal.xyz );
				let normal = select(
					hit.normal,
					localNormal,
					smoothNormals > 0u,
				);
				textureStore( outputTex, indexUV, vec4f( normal, 1.0 ) );

			} else {

				let background = vec4f( 0.0366, 0.0813, 0.1057, 1.0 );
				textureStore( outputTex, indexUV, background );

			}

		}
	`, [ ndcToCameraRay, bvhData.fns.raycastFirstHit, bvhData.fns.sampleTrianglePoint ] );

	computeKernel = computeShader( computeShaderParams ).computeKernel( WORKGROUP_SIZE );

	// screen quad
	const vUv = varyingProperty( 'vec2', 'vUv' );
	const wgslVertexShader = wgslFn( /* wgsl */`
		fn vertex( position: vec3f, uv: vec2f ) -> vec3f {
			varyings.vUv = uv;
			return position;
		}
	`, [ vUv ] );

	fsMaterial = new MeshBasicNodeMaterial();
	fsMaterial.positionNode = wgslVertexShader( {
		position: attribute( 'position' ),
		uv: attribute( 'uv' )
	} );

	fsMaterial.colorNode = colorSpaceToWorking( texture( outputTex, vUv ), THREE.SRGBColorSpace );
	fsQuad = new FullScreenQuad( fsMaterial );

	// controls
	controls = new OrbitControls( camera, renderer.domElement );

	// gui
	gui = new GUI();
	gui.add( params, 'enableRaytracing' );
	gui.add( params, 'animate' );
	gui.add( params, 'smoothNormals' );
	gui.add( params, 'resolutionScale', 0.1, 1, 0.01 ).onChange( resize );
	gui.open();

	// resize
	window.addEventListener( 'resize', resize, false );
	resize();

}

function resize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	const dpr = window.devicePixelRatio;
	const scale = params.resolutionScale;

	camera.aspect = w / h;
	camera.updateProjectionMatrix();

	renderer.setSize( w, h );
	renderer.setPixelRatio( dpr );

	outputTex.setSize( Math.ceil( w * dpr * scale ), Math.ceil( h * dpr * scale ) );

}

function render() {

	stats.update();

	const delta = clock.getDelta();
	if ( params.animate ) {

		mesh.rotation.y += delta;

	}

	if ( params.enableRaytracing ) {

		dispatchSize = [
			Math.ceil( outputTex.width / WORKGROUP_SIZE[ 0 ] ),
			Math.ceil( outputTex.height / WORKGROUP_SIZE[ 1 ] ),
		];

		camera.updateMatrixWorld();
		mesh.updateMatrixWorld();

		computeKernel.computeNode.parameters.outputTex.value = outputTex;
		computeKernel.computeNode.parameters.smoothNormals.value = Number( params.smoothNormals );
		computeKernel.computeNode.parameters.inverseProjectionMatrix.value = camera.projectionMatrixInverse;
		computeKernel.computeNode.parameters.cameraToModelMatrix.value.copy( mesh.matrixWorld ).invert().multiply( camera.matrixWorld );
		computeKernel.computeNode.parameters.workgroupSize.value.fromArray( WORKGROUP_SIZE );
		renderer.compute( computeKernel, dispatchSize );

		fsMaterial.colorNode.colorNode.value = outputTex;
		fsQuad.render( renderer );

	} else {

		renderer.render( scene, camera );

	}

}
