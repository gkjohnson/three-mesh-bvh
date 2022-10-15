import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { bsdfSample, bsdfColor, bsdfPdf } from './pathtracing/materialSampling.js';

import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import {
	acceleratedRaycast,
	computeBoundsTree,
	disposeBoundsTree,
	SAH,
	CENTER,
} from '..';
import {
	GenerateMeshBVHWorker,
} from '../src/workers/GenerateMeshBVHWorker.js';
import { ANTIALIAS_OFFSETS, ANTIALIAS_WIDTH, EPSILON, getBasisFromNormal, isDirectionValid } from './pathtracing/utils.js';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

let scene, camera, renderer, light, clock;
let fsQuad, controls;
let dataTexture, samples, task, delay, scanLinePercent;
let scanLineElement, containerElement, outputContainer;
let renderStartTime, computationTime;
let mesh, materials, lightMesh, floorMesh;

// constants
const DELAY_TIME = 300;
const FADE_DELAY = 150;

// reusable fields
const triangle = new THREE.Triangle();
const normal0 = new THREE.Vector3();
const normal1 = new THREE.Vector3();
const normal2 = new THREE.Vector3();
const barycoord = new THREE.Vector3();
const spherical = new THREE.Spherical();
const normalBasis = new THREE.Matrix4();
const invBasis = new THREE.Matrix4();
const localDirection = new THREE.Vector3();
const tempColor = new THREE.Color();
const tempVector = new THREE.Vector3();

const models = {};
const params = {
	model: 'Dragon',
	resolution: {
		resolutionScale: 0.5,
		smoothImageScaling: false,
		stretchImage: true,
	},
	pathTracing: {
		pause: false,
		displayScanLine: false,
		antialiasing: true,
		bounces: 10,
		filterGlossyFactor: 0.5,
		smoothNormals: true,
		directLightSampling: true,
	},
	material: {
		color: '#0099ff',
		emissive: '#000000',
		emissiveIntensity: 1,
		roughness: 0.1,
		metalness: 0.0,
		ior: 1.8,
		transmission: 0.0,
	},
	floor: {
		enable: true,
		color: '#7f7f7f',
		roughness: 0.1,
		metalness: 0.1,
		width: 10,
		height: 10,
	},
	light: {
		enable: true,
		position: 'Diagonal',
		intensity: 30.0,
		color: '#ffffff',
		width: 1,
		height: 1,
	},
	environment: {
		skyMode: 'sky',
		skyIntensity: 0.025,
	}
};

init();
render();

function init() {

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( 0, 1 );
	renderer.outputEncoding = THREE.sRGBEncoding;

	// container of the canvas and scan line to be centered
	containerElement = document.createElement( 'div' );
	containerElement.style.position = 'absolute';
	containerElement.style.inset = '0';
	containerElement.style.margin = 'auto';
	containerElement.style.zIndex = '-1';
	document.body.appendChild( containerElement );
	containerElement.appendChild( renderer.domElement );

	// scan line element for tracking render progress
	scanLineElement = document.createElement( 'div' );
	scanLineElement.style.width = '100%';
	scanLineElement.style.position = 'absolute';
	scanLineElement.style.borderBottom = '1px solid #e91e63';
	scanLineElement.style.visibility = 'hidden';
	containerElement.appendChild( scanLineElement );

	outputContainer = document.getElementById( 'output' );

	fsQuad = new FullScreenQuad( new THREE.MeshBasicMaterial() );
	fsQuad.material.transparent = true;

	// scene setup
	scene = new THREE.Scene();

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( - 2.5, 1.5, 2.5 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	// light
	light = new THREE.HemisphereLight( 0xffffff, 0x666666, 1 );
	scene.add( light );

	lightMesh = new THREE.Mesh(
		new THREE.PlaneBufferGeometry( 1, 1, 1, 1 ),
		new THREE.MeshBasicMaterial( { side: THREE.DoubleSide } ),
	);
	lightMesh.position.set( 2, 2, 2 );
	lightMesh.lookAt( 0, 0, 0 );
	scene.add( lightMesh );

	floorMesh = new THREE.Mesh(
		new THREE.PlaneBufferGeometry( 1, 1, 1, 1 ),
		new THREE.MeshStandardMaterial( { side: THREE.DoubleSide } ),
	);
	floorMesh.rotation.x = - Math.PI / 2;
	floorMesh.scale.setScalar( 1 );
	floorMesh.material.ior = 1.6;
	floorMesh.material.transmission = 0;
	scene.add( floorMesh );

	controls = new OrbitControls( camera, renderer.domElement );
	controls.addEventListener( 'change', resetImage );

	window.addEventListener( 'resize', onResize, false );
	onResize();

	// Load sphere
	models[ 'Sphere' ] = null;
	{

		const sphereMesh = new THREE.Mesh(
			new THREE.SphereGeometry( 1, 100, 50 ),
			new THREE.MeshStandardMaterial(),
		);

		const { geometry, materials } = mergeMeshes( [ sphereMesh ], true );
		const merged = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
		scene.add( merged );

		geometry.computeBoundsTree( { strategy: SAH, maxLeafTris: 1 } );
		models[ 'Sphere' ] = { mesh: merged, materials, floorHeight: - 1 };

	}

	models[ 'Cornell Box' ] = null;
	{

		const planeGeom = new THREE.PlaneBufferGeometry( 1, 1, 1, 1 );
		const leftWall = new THREE.Mesh(
			planeGeom,
			new THREE.MeshStandardMaterial( {
				color: 0x00ee00,
				side: THREE.DoubleSide,
			} )
		);
		leftWall.rotation.y = Math.PI / 2;
		leftWall.position.x = - 2;
		leftWall.scale.setScalar( 4 );
		leftWall.updateMatrixWorld( true );

		const rightWall = new THREE.Mesh(
			planeGeom,
			new THREE.MeshStandardMaterial( {
				color: 0xee0000,
			} ),
		);
		rightWall.rotation.y = Math.PI / 2;
		rightWall.position.x = 2;
		rightWall.scale.setScalar( 4 );
		rightWall.updateMatrixWorld( true );

		const backWall = new THREE.Mesh(
			planeGeom,
			new THREE.MeshStandardMaterial( {
				color: 0xeeeeee,
			} ),
		);
		backWall.position.z = - 2;
		backWall.scale.setScalar( 4 );
		backWall.updateMatrixWorld( true );

		const ceiling = new THREE.Mesh(
			planeGeom.clone(),
			new THREE.MeshStandardMaterial( {
				color: 0xeeeeee,
			} ),
		);
		ceiling.rotation.x = Math.PI / 2;
		ceiling.position.y = 2;
		ceiling.scale.setScalar( 4 );
		ceiling.updateMatrixWorld( true );

		const box = new THREE.Mesh(
			new THREE.BoxGeometry( 1, 2, 1 ),
			new THREE.MeshStandardMaterial( {
				side: THREE.DoubleSide,
			} ),
		);
		box.position.y = - 1.0;
		box.position.x = - 0.6;
		box.position.z = - 0.25;
		box.rotation.y = Math.PI / 4;

		const box2 = new THREE.Mesh(
			new THREE.BoxGeometry( 1, 1, 1 ),
			new THREE.MeshStandardMaterial( {
				side: THREE.DoubleSide,
			} ),
		);
		box2.position.y = - 1.5;
		box2.position.x = 0.75;
		box2.position.z = 0.5;
		box2.rotation.y = - Math.PI / 8;

		const { geometry, materials } = mergeMeshes( [ box, box2, leftWall, rightWall, backWall, ceiling ], true );
		const merged = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
		scene.add( merged );

		geometry.computeBoundsTree( { strategy: SAH, maxLeafTris: 1 } );
		models[ 'Cornell Box' ] = { mesh: merged, materials, floorHeight: - 2 };

	}

	// Load dragon
	models[ 'Dragon' ] = null;
	new GLTFLoader().load( '../models/DragonAttenuation.glb', gltf => {

		let mesh;
		gltf.scene.traverse( c => {

			if ( c.isMesh && c.name === 'Dragon' ) {

				mesh = c;

			}

		} );

		mesh.material = new THREE.MeshStandardMaterial();
		mesh.geometry.center().scale( 0.25, 0.25, 0.25 ).rotateX( Math.PI / 2 );
		mesh.position.set( 0, 0, 0 );
		mesh.scale.set( 1, 1, 1 );
		mesh.quaternion.identity();

		const { geometry, materials } = mergeMeshes( [ mesh ], true );
		const merged = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
		const generator = new GenerateMeshBVHWorker();
		generator
			.generate( geometry, { maxLeafTris: 1, strategy: SAH } )
			.then( bvh => {

				models[ 'Dragon' ] = { mesh: merged, materials, floorHeight: mesh.geometry.boundingBox.min.y };
				geometry.boundsTree = bvh;
				generator.dispose();
				scene.add( merged );

			} );

	} );

	models[ 'Engine' ] = null;
	new GLTFLoader().setMeshoptDecoder( MeshoptDecoder ).load( '../models/internal_combustion_engine/model.gltf', gltf => {

		const originalMesh = gltf.scene.children[ 0 ];
		const originalGeometry = originalMesh.geometry;
		const newGeometry = new THREE.BufferGeometry();

		const ogPosAttr = originalGeometry.attributes.position;
		const ogNormAttr = originalGeometry.attributes.normal;
		const posAttr = new THREE.BufferAttribute( new Float32Array( ogPosAttr.count * 3 ), 3, false );
		const normAttr = new THREE.BufferAttribute( new Float32Array( ogNormAttr.count * 3 ), 3, false );

		const vec = new THREE.Vector3();
		for ( let i = 0, l = ogPosAttr.count; i < l; i ++ ) {

			vec.fromBufferAttribute( ogPosAttr, i );
			posAttr.setXYZ( i, vec.x, vec.y, vec.z );

			vec.fromBufferAttribute( ogNormAttr, i );
			vec.multiplyScalar( 1 / 127 );
			normAttr.setXYZ( i, vec.x, vec.y, vec.z );

		}

		originalMesh.scale.multiplyScalar( 5 );
		originalMesh.updateMatrixWorld();
		newGeometry.setAttribute( 'position', posAttr );
		newGeometry.setAttribute( 'normal', normAttr );
		newGeometry.setAttribute( 'materialIndex', new THREE.BufferAttribute( new Uint8Array( posAttr.count ), 1, false ) );
		newGeometry.setIndex( originalGeometry.index );
		newGeometry.applyMatrix4( originalMesh.matrixWorld ).center();
		newGeometry.computeBoundingBox();

		const mesh = new THREE.Mesh( newGeometry, new THREE.MeshStandardMaterial() );
		const generator = new GenerateMeshBVHWorker();
		generator
			.generate( newGeometry, { maxLeafTris: 1, strategy: CENTER } )
			.then( bvh => {

				models[ 'Engine' ] = {
					mesh,
					materials: [ new THREE.MeshStandardMaterial() ],
					floorHeight: newGeometry.boundingBox.min.y,
				};
				newGeometry.boundsTree = bvh;
				generator.dispose();

				scene.add( mesh );

			} );

	} );

	samples = 0;
	clock = new THREE.Clock();

	const gui = new GUI();
	gui.add( params, 'model', Object.keys( models ) ).onChange( resetImage );

	const resolutionFolder = gui.addFolder( 'resolution' );
	resolutionFolder.add( params.resolution, 'resolutionScale', 0.1, 1, 0.01 ).onChange( onResize );
	resolutionFolder.add( params.resolution, 'smoothImageScaling' ).onChange( onResize );
	resolutionFolder.add( params.resolution, 'stretchImage' ).onChange( onResize );
	resolutionFolder.open();

	const pathTracingFolder = gui.addFolder( 'path tracing' );
	pathTracingFolder.add( params.pathTracing, 'pause' );
	pathTracingFolder.add( params.pathTracing, 'displayScanLine' ).onChange( v => {

		scanLineElement.style.visibility = v ? 'visible' : 'hidden';

	} );
	pathTracingFolder.add( params.pathTracing, 'antialiasing' ).onChange( resetImage );
	pathTracingFolder.add( params.pathTracing, 'directLightSampling' ).onChange( resetImage );
	pathTracingFolder.add( params.pathTracing, 'smoothNormals' ).onChange( resetImage );
	pathTracingFolder.add( params.pathTracing, 'bounces', 1, 50, 1 ).onChange( resetImage );
	pathTracingFolder.add( params.pathTracing, 'filterGlossyFactor', 0, 1, 0.001 ).onChange( resetImage );
	pathTracingFolder.open();

	const materialFolder = gui.addFolder( 'model' );
	materialFolder.addColor( params.material, 'color' ).onChange( resetImage );
	materialFolder.addColor( params.material, 'emissive' ).onChange( resetImage );
	materialFolder.add( params.material, 'emissiveIntensity', 0, 5, 0.001 ).onChange( resetImage );
	materialFolder.add( params.material, 'roughness', 0, 1.0, 0.001 ).onChange( resetImage );
	materialFolder.add( params.material, 'metalness', 0, 1.0, 0.001 ).onChange( resetImage );
	materialFolder.add( params.material, 'transmission', 0, 1.0, 0.001 ).onChange( resetImage );
	materialFolder.add( params.material, 'ior', 1.0, 2.5, 0.001 ).onChange( resetImage );
	materialFolder.open();

	const floorFolder = gui.addFolder( 'floor' );
	floorFolder.add( params.floor, 'enable' ).onChange( resetImage );
	floorFolder.addColor( params.floor, 'color' ).onChange( resetImage );
	floorFolder.add( params.floor, 'roughness', 0, 1, 0.001 ).onChange( resetImage );
	floorFolder.add( params.floor, 'metalness', 0, 1, 0.001 ).onChange( resetImage );
	floorFolder.add( params.floor, 'width', 3, 20, 0.001 ).onChange( resetImage );
	floorFolder.add( params.floor, 'height', 3, 20, 0.001 ).onChange( resetImage );

	const lightFolder = gui.addFolder( 'light' );
	lightFolder.add( params.light, 'enable' ).onChange( resetImage );
	lightFolder.addColor( params.light, 'color' ).onChange( resetImage );
	lightFolder.add( params.light, 'intensity', 0, 100, 0.001 ).onChange( resetImage );
	lightFolder.add( params.light, 'width', 0, 5, 0.001 ).onChange( resetImage );
	lightFolder.add( params.light, 'height', 0, 5, 0.001 ).onChange( resetImage );
	lightFolder.add( params.light, 'position', [ 'Diagonal', 'Above', 'Below' ] ).onChange( resetImage );

	const envFolder = gui.addFolder( 'environment' );
	envFolder.add( params.environment, 'skyMode', [ 'sky', 'sun', 'checkerboard' ] ).onChange( resetImage );
	envFolder.add( params.environment, 'skyIntensity', 0, 5, 0.001 ).onChange( resetImage );

	onResize();

}

// Merges meshes into a single geometry, returns a series of materials and geometry with a vertex attribute buffer
// containing information about the material index to use
function mergeMeshes( meshes, cloneGeometry = true ) {

	const transformedGeometry = [];
	const materials = [];
	for ( let i = 0, l = meshes.length; i < l; i ++ ) {

		const mesh = meshes[ i ];
		const originalGeometry = meshes[ i ].geometry;
		const geom = cloneGeometry ? originalGeometry.clone() : cloneGeometry;
		mesh.updateMatrixWorld();
		geom.applyMatrix4( mesh.matrixWorld );

		const vertexCount = geom.attributes.position.count;
		const materialIndexArray = new Uint8Array( vertexCount ).fill( i );
		geom.setAttribute( 'materialIndex', new THREE.BufferAttribute( materialIndexArray, 1, false ) );

		transformedGeometry.push( geom );
		materials.push( mesh.material );

	}

	const geometry = BufferGeometryUtils.mergeBufferGeometries( transformedGeometry, false );
	return { geometry, materials };

}

function onResize() {

	function resizeDataTexture( w, h ) {

		if ( ! dataTexture || dataTexture.image.width !== w || dataTexture.image.height !== h ) {

			if ( dataTexture ) {

				dataTexture.dispose();

			}

			dataTexture = new THREE.DataTexture( new Float32Array( w * h * 4 ), w, h, THREE.RGBAFormat, THREE.FloatType );
			resetImage();

		}

	}

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	// compute the new resolution based on the use parameters
	const dpr = window.devicePixelRatio;
	const resolutionScale = params.resolution.resolutionScale;
	if ( params.resolution.stretchImage ) {

		containerElement.style.width = `${ window.innerWidth }px`;
		containerElement.style.height = `${ window.innerHeight }px`;
		renderer.setSize( window.innerWidth, window.innerHeight );
		renderer.setPixelRatio( dpr * resolutionScale );
		resizeDataTexture(
			Math.floor( window.innerWidth * dpr * resolutionScale ),
			Math.floor( window.innerHeight * dpr * resolutionScale ),
		);

	} else {

		containerElement.style.width = `${ window.innerWidth * resolutionScale }px`;
		containerElement.style.height = `${ window.innerHeight * resolutionScale }px`;
		renderer.setSize(
			Math.floor( window.innerWidth * resolutionScale ),
			Math.floor( window.innerHeight * resolutionScale )
		);
		renderer.setPixelRatio( dpr );
		resizeDataTexture(
			Math.floor( window.innerWidth * dpr * resolutionScale ),
			Math.floor( window.innerHeight * dpr * resolutionScale ),
		);

	}

	renderer.domElement.style.imageRendering = params.resolution.smoothImageScaling ? 'auto' : 'pixelated';

}

function resetImage() {

	// clear the draw buffer and restart the path tracing loop
	dataTexture.image.data.fill( 0 );
	dataTexture.needsUpdate = true;
	samples = 0;
	task = runPathTracingLoop();
	delay = 0;
	scanLineElement.style.visibility = 'hidden';
	scanLinePercent = 100;

	lightMesh.scale.set( params.light.width, params.light.height, 1 );
	lightMesh.material.color.set( params.light.color ).multiplyScalar( params.light.intensity );
	lightMesh.visible = params.light.enable;

	floorMesh.scale.set( params.floor.width, params.floor.height, 1 );
	floorMesh.material.color.set( params.floor.color );
	floorMesh.material.roughness = Math.pow( params.floor.roughness, 2.0 ); // perceptual roughness
	floorMesh.material.metalness = params.floor.metalness;
	floorMesh.visible = params.floor.enable;

}

function* runPathTracingLoop() {

	// extract options
	const { width, height, data } = dataTexture.image;
	const bounces = parseInt( params.pathTracing.bounces );
	const skyIntensity = parseFloat( params.environment.skyIntensity );
	const skyMode = params.environment.skyMode;
	const smoothNormals = params.pathTracing.smoothNormals;

	// reusable variables
	const radianceColor = new THREE.Color();
	const throughputColor = new THREE.Color();
	const halfVector = new THREE.Vector3();
	const normal = new THREE.Vector3();
	const ssPoint = new THREE.Vector2();
	const rayStack = new Array( bounces ).fill().map( () => new THREE.Ray() );
	const lightForward = new THREE.Vector3( 0, 0, 1 ).transformDirection( lightMesh.matrixWorld );
	const lightWidth = lightMesh.scale.x;
	const lightHeight = lightMesh.scale.y;
	const raycaster = new THREE.Raycaster();
	raycaster.firstHitOnly = true;

	const seedRay = new THREE.Ray();
	const sampleInfo = {
		pdf: 0,
		color: new THREE.Color(),
		direction: new THREE.Vector3(),
	};

	// initialization of progress variables
	let lastStartTime = performance.now();
	renderStartTime = performance.now();
	computationTime = 0;
	scanLinePercent = 100;
	scanLineElement.style.visibility = params.pathTracing.displayScanLine ? 'visible' : 'hidden';

	// ensure the materials are all set to double side for transmissive rendering
	mesh.material.side = THREE.DoubleSide;
	materials.forEach( material => {

		material.side = THREE.DoubleSide;

	} );

	while ( true ) {

		let randomOffsetX = 0;
		let randomOffsetY = 0;
		if ( params.pathTracing.antialiasing ) {

			const antiAliasIndex = ( samples ) % ANTIALIAS_OFFSETS.length;
			[ randomOffsetX, randomOffsetY ] = ANTIALIAS_OFFSETS[ antiAliasIndex ];
			randomOffsetX = ( randomOffsetX / ANTIALIAS_WIDTH ) / width;
			randomOffsetY = ( randomOffsetY / ANTIALIAS_WIDTH ) / height;

		}

		for ( let y = height - 1; y >= 0; y -- ) {

			for ( let x = 0; x < width; x ++ ) {

				// get the camera ray
				ssPoint.set( randomOffsetX + x / ( width - 1 ), randomOffsetY + y / ( height - 1 ) );
				raycaster.setFromCamera( { x: ssPoint.x * 2 - 1, y: ssPoint.y * 2 - 1 }, camera );

				// get the camera look direction
				tempVector.set( 0, 0, - 1 ).transformDirection( camera.matrixWorld );

				// copy the ray to the starting ray to pass into the pathTrace function and adjust it
				// so ti starts at the camera near clip plane
				seedRay.direction.copy( raycaster.ray.direction );
				seedRay.origin
					.copy( raycaster.ray.origin )
					.addScaledVector( raycaster.ray.direction, camera.near / raycaster.ray.direction.dot( tempVector ) );

				// run the path trace
				radianceColor.set( 0 );
				pathTrace( seedRay, radianceColor );

				// accumulate a rolling average color into the data texture
				const index = ( y * width + x ) * 4;
				const r = data[ index + 0 ];
				const g = data[ index + 1 ];
				const b = data[ index + 2 ];
				data[ index + 0 ] += ( radianceColor.r - r ) / ( samples + 1 );
				data[ index + 1 ] += ( radianceColor.g - g ) / ( samples + 1 );
				data[ index + 2 ] += ( radianceColor.b - b ) / ( samples + 1 );
				data[ index + 3 ] = 1.0;

				// if we've rendered for ~16ms then wait for the next tick
				const delta = performance.now() - lastStartTime;
				if ( delta > 16 ) {

					computationTime += delta;
					scanLinePercent = 100 * y / height;

					yield;
					lastStartTime = performance.now();

				}

			}

		}

		samples ++;

	}

	// extract other necessary information from the hit
	function expandHitInformation( hit, ray, accumulatedRoughness ) {

		const object = hit.object;
		const posAttr = object.geometry.attributes.position;
		const normalAttr = object.geometry.attributes.normal;
		const materialAttr = object.geometry.attributes.materialIndex;

		const face = hit.face;
		const geometryNormal = hit.face.normal;
		if ( smoothNormals ) {

			const point = hit.point;
			triangle.a.fromBufferAttribute( posAttr, face.a );
			triangle.b.fromBufferAttribute( posAttr, face.b );
			triangle.c.fromBufferAttribute( posAttr, face.c );

			normal0.fromBufferAttribute( normalAttr, face.a );
			normal1.fromBufferAttribute( normalAttr, face.b );
			normal2.fromBufferAttribute( normalAttr, face.c );

			triangle.getBarycoord( point, barycoord );

			normal
				.setScalar( 0 )
				.addScaledVector( normal0, barycoord.x )
				.addScaledVector( normal1, barycoord.y )
				.addScaledVector( normal2, barycoord.z )
				.normalize();

		} else {

			normal.copy( geometryNormal );

		}

		geometryNormal.transformDirection( object.matrixWorld );
		normal.transformDirection( object.matrixWorld );

		const hitFrontFace = geometryNormal.dot( ray.direction ) < 0;
		if ( ! hitFrontFace ) {

			normal.multiplyScalar( - 1 );
			geometryNormal.multiplyScalar( - 1 );

		}

		let material = object.material;
		if ( materialAttr ) {

			const materialIndex = materialAttr.getX( face.a );
			material = materials[ materialIndex ];

		}

		hit.material = material;
		hit.normal = normal;
		hit.geometryNormal = geometryNormal;
		hit.frontFace = hitFrontFace;

		// compute the filtered roughness value to use during specular reflection computations. A minimum
		// value of 1e-6 is needed because the GGX functions do not work with a roughness value of 0 and
		// the accumulated roughness value is scaled by a user setting and a "magic value" of 5.0.
		hit.filteredSurfaceRoughness = Math.min(
			Math.max(
				1e-6,
				material.roughness,
				accumulatedRoughness * params.pathTracing.filterGlossyFactor * 5.0,
			),
			1.0,
		);


	}

	// trace a path starting at the given ray
	function pathTrace( ray, targetColor ) {

		let currentRay = ray;
		let lastPdf = 0;
		let accumulatedRoughness = 0;
		throughputColor.set( 0xffffff );
		for ( let i = 0; i < bounces; i ++ ) {

			// get the ray intersection
			let hit = null;
			raycaster.ray.copy( currentRay );

			const objects = [ mesh ];
			if ( params.light.enable ) {

				objects.push( lightMesh );

			}

			if ( params.floor.enable ) {

				objects.push( floorMesh );

			}

			hit = raycaster.intersectObjects( objects, true )[ 0 ];

			// check if we hit the light or the model
			if ( hit ) {

				if ( hit.object === lightMesh ) {

					// only add light on one side
					if ( i === 0 ) {

						const lightColor = lightMesh.material.color;
						targetColor.r = Math.min( lightColor.r, 1.0 );
						targetColor.g = Math.min( lightColor.g, 1.0 );
						targetColor.b = Math.min( lightColor.b, 1.0 );

					} else if ( currentRay.direction.dot( lightForward ) < 0 ) {

						// only add light on one side
						const lightDistSq = hit.distance * hit.distance;
						const lightArea = lightWidth * lightHeight;
						const lightPdf = lightDistSq / ( lightArea * - currentRay.direction.dot( lightForward ) );

						const weight = lastPdf / ( lastPdf + lightPdf );
						targetColor.r += weight * throughputColor.r * lightMesh.material.color.r;
						targetColor.g += weight * throughputColor.g * lightMesh.material.color.g;
						targetColor.b += weight * throughputColor.b * lightMesh.material.color.b;

					}

					break;

				} else {

					expandHitInformation( hit, currentRay, accumulatedRoughness );
					const { material } = hit;
					const nextRay = rayStack[ i ];

					// get the local normal frame
					getBasisFromNormal( hit.normal, normalBasis );
					invBasis.copy( normalBasis ).invert();

					/* Direct Light Sampling */
					if ( params.light.enable ) {

						// get a random point on the surface of the light
						tempVector
							.set( Math.random() - 0.5, Math.random() - 0.5, 0 )
							.applyMatrix4( lightMesh.matrixWorld );

						// get a ray to the light point
						// note that the ray always starts on the front side of the face implying that transmissive
						// contributions are not included here.
						nextRay.origin.copy( hit.point ).addScaledVector( hit.geometryNormal, EPSILON );
						nextRay.direction.subVectors( tempVector, nextRay.origin ).normalize();

						if (
							nextRay.direction.dot( lightForward ) < 0
							&& isDirectionValid( nextRay.direction, hit.normal, hit.geometryNormal )
						) {

							// compute the probability of hitting the light on the hemisphere
							const lightArea = lightWidth * lightHeight;
							const lightDistSq = nextRay.origin.distanceToSquared( tempVector );
							const lightPdf = lightDistSq / ( lightArea * - nextRay.direction.dot( lightForward ) );

							raycaster.ray.copy( nextRay );
							const shadowHit = raycaster.intersectObjects( objects, true )[ 0 ];
							if ( shadowHit && shadowHit.object === lightMesh ) {

								// get the incoming and outgoing directions in the normal frame
								localDirection.copy( currentRay.direction ).applyMatrix4( invBasis ).multiplyScalar( - 1 ).normalize();
								tempVector.copy( nextRay.direction ).applyMatrix4( invBasis ).normalize();
								localDirection.normalize();

								// get the material color and pdf
								bsdfColor( localDirection, tempVector, material, hit, tempColor );

								// add light contribution to the final color
								const materialPdf = bsdfPdf( localDirection, tempVector, material, hit );
								const misWeight = lightPdf / ( materialPdf + lightPdf );
								targetColor.r += lightMesh.material.color.r * throughputColor.r * tempColor.r * misWeight / lightPdf;
								targetColor.g += lightMesh.material.color.g * throughputColor.g * tempColor.g * misWeight / lightPdf;
								targetColor.b += lightMesh.material.color.b * throughputColor.b * tempColor.b * misWeight / lightPdf;

							}

						}

					}

					/* BSDF Sampling */
					// compute the outgoing vector (towards the camera) to feed into the bsdf to get the
					// incident light vector.
					localDirection.copy( currentRay.direction ).applyMatrix4( invBasis )
						.multiplyScalar( - 1 ).normalize();

					// sample the surface to get the pdf, reflected color, and direction
					bsdfSample( localDirection, hit, material, sampleInfo );

					// accumulate a roughness based on the sin of the half vector with the surface normal which
					// can be used with subsequent ray bounces to avoid fireflies similar to Blender functionality
					halfVector.addVectors( localDirection, sampleInfo.direction ).normalize();
					accumulatedRoughness += Math.sin( Math.acos( halfVector.z ) );

					// transform ray back to world frame and offset from surface
					nextRay.direction.copy( sampleInfo.direction ).applyMatrix4( normalBasis ).normalize();

					const isBelowSurface = nextRay.direction.dot( hit.geometryNormal ) < 0;
					nextRay.origin.copy( hit.point )
						.addScaledVector( hit.geometryNormal, isBelowSurface ? - EPSILON : EPSILON );

					// emission contribution
					const { emissive, emissiveIntensity } = material;
					targetColor.r += ( emissiveIntensity * emissive.r * throughputColor.r );
					targetColor.g += ( emissiveIntensity * emissive.g * throughputColor.g );
					targetColor.b += ( emissiveIntensity * emissive.b * throughputColor.b );

					// If our PDF indicates there's a less than 0 probability of sampling this new direction then
					// don't include it in our sampling and terminate the ray modeling that the ray has been absorbed.
					if (
						sampleInfo.pdf <= 0
						|| ! isDirectionValid( nextRay.direction, hit.normal, hit.geometryNormal )
					) {

						break;

					}

					sampleInfo.color.multiplyScalar( 1 / sampleInfo.pdf );
					throughputColor.multiply( sampleInfo.color );
					currentRay = nextRay;
					lastPdf = sampleInfo.pdf;

				}

			} else {

				// TODO: is this contribution supposed to be weighted with multiple importance sampling, as well?
				sampleSkyBox( currentRay.direction, tempColor );
				tempColor.multiply( throughputColor );
				targetColor.add( tempColor );

				break;

			}

		}

	}

	// sample the skybox in the given direction and put the sampled color into "target"
	function sampleSkyBox( direction, target ) {

		if ( skyMode === 'checkerboard' ) {

			spherical.setFromVector3( direction );

			const angleStep = Math.PI / 10;
			const thetaEven = Math.floor( spherical.theta / angleStep ) % 2 === 0;
			const phiEven = Math.floor( spherical.phi / angleStep ) % 2 === 0;
			const isBlack = thetaEven === phiEven;
			target.set( isBlack ? 0 : 0xffffff ).multiplyScalar( 1.5 );
			target.multiplyScalar( skyIntensity );

		} else if ( skyMode === 'sun' ) {

			normal0.setScalar( 1 ).normalize();

			let value = Math.max( 0.0, direction.dot( normal0 ) + 1.0 ) / 2.0;
			value *= value;
			target.r = THREE.MathUtils.lerp( 0.01, 0.5, value );
			target.g = THREE.MathUtils.lerp( 0.01, 0.7, value );
			target.b = THREE.MathUtils.lerp( 0.01, 1.0, value );

			if ( value > 0.95 ) {

				let value2 = ( value - 0.95 ) / 0.05;
				value2 *= value2;
				target.r = THREE.MathUtils.lerp( 0.5, 10.0, value2 );
				target.g = THREE.MathUtils.lerp( 0.7, 10.0, value2 );
				target.b = THREE.MathUtils.lerp( 1.0, 10.0, value2 );

			}

			target.multiplyScalar( skyIntensity );

		} else {

			const value = ( direction.y + 0.5 ) / 2.0;
			target.r = THREE.MathUtils.lerp( 1.0, 0.5, value );
			target.g = THREE.MathUtils.lerp( 1.0, 0.7, value );
			target.b = THREE.MathUtils.lerp( 1.0, 1.0, value );
			target.multiplyScalar( skyIntensity );

		}

	}

}

function toHumanReadableTime( ms ) {

	ms = ms || 0;

	let seconds = ms * 1e-3;
	const minutes = Math.floor( seconds / 60 );
	seconds = seconds - minutes * 60;

	const minutesString = ( minutes < 10 ? '0' : '' ) + minutes;
	const secondsString = ( seconds < 10 ? '0' : '' ) + seconds.toFixed( 3 );

	return `${ minutesString }m ${ secondsString }s`;

}

function render() {

	requestAnimationFrame( render );

	for ( const key in models ) {

		if ( models[ key ] ) {

			models[ key ].mesh.visible = false;

		}

	}

	// select the model and initialize set the 0 material with the user settings
	if ( models[ params.model ] ) {

		const model = models[ params.model ];
		model.mesh.visible = true;
		mesh = model.mesh;
		materials = model.materials;
		floorMesh.position.y = model.floorHeight;

		// initialize ior and transmission not present on materials already
		materials.forEach( m => {

			if ( m.ior === undefined ) m.ior = 1;
			if ( m.transmission === undefined ) m.transmission = 0.0;

		} );

		const material = materials[ 0 ];
		material.color.set( params.material.color ).convertSRGBToLinear();
		material.emissive.set( params.material.emissive ).convertSRGBToLinear();
		material.emissiveIntensity = parseFloat( params.material.emissiveIntensity );
		material.ior = parseFloat( params.material.ior );
		material.metalness = parseFloat( params.material.metalness );
		material.transmission = parseFloat( params.material.transmission );

		// use a "perceptualRoughness" concept when interpreting user input
		// https://google.github.io/filament/Filament.html#materialsystem/standardmodelsummary
		material.roughness = Math.pow( parseFloat( params.material.roughness ), 2.0 );

		// adjust the position of the area light before rendering
		switch ( params.light.position ) {

			case 'Below':
				lightMesh.rotation.set( - Math.PI / 2, 0, 0 );
				lightMesh.position.set( 0, model.floorHeight + 1e-3, 0 );
				break;

			case 'Above':
				lightMesh.rotation.set( Math.PI / 2, 0, 0 );
				lightMesh.position.set( 0, 2 - 1e-3, 0 );
				break;

			default:
				lightMesh.position.set( 2, 2, 2 );
				lightMesh.lookAt( 0, 0, 0 );
				break;

		}

	} else {

		mesh = null;
		materials = null;
		floorMesh.position.y = 0;

	}

	// Fade the path traced image in after the user stops moving the camera
	let fade = 0;
	if ( delay > FADE_DELAY ) {

		fade = Math.min( ( delay - FADE_DELAY ) / ( DELAY_TIME - FADE_DELAY ), 1.0 );

	}

	// update the scan line
	scanLineElement.style.bottom = `${ scanLinePercent }%`;
	if ( params.resolution.stretchImage ) {

		scanLineElement.style.borderBottomWidth = `${ Math.ceil( 1 / params.resolution.resolutionScale ) }px`;

	} else {

		scanLineElement.style.borderBottomWidth = '1px';

	}

	// render the scene
	renderer.render( scene, camera );
	renderer.autoClear = false;

	// overlay the path traced image
	fsQuad.material.map = dataTexture;
	fsQuad.material.opacity = fade;
	fsQuad.render( renderer );
	renderer.autoClear = true;

	// run the path tracing
	// world matrices are up to date because of the above render
	if ( mesh && ! params.pathTracing.pause ) {

		task.next();

	}

	// force the data texture to upload now that it's changed but do it after render so the
	// upload happens asynchronously and will be ready next frame.
	dataTexture.needsUpdate = true;
	renderer.compile( fsQuad._mesh );

	// count down the fade
	if ( delay < DELAY_TIME ) {

		delay += clock.getDelta() * 1e3;

	}

	outputContainer.innerText =
		`completed samples : ${ samples }\n` +
		`computation time  : ${ toHumanReadableTime( computationTime ) }\n` +
		`elapsed time      : ${ toHumanReadableTime( performance.now() - renderStartTime ) }`;

}

