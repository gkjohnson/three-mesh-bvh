import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { bsdfSample } from './pathtracing/materialSampling.js';

import { GUI } from 'dat.gui';
import {
	acceleratedRaycast,
	computeBoundsTree,
	disposeBoundsTree,
	SAH,
	CENTER,
	MeshBVH,
} from '../src/index.js';
import {
	GenerateMeshBVHWorker,
} from '../src/workers/GenerateMeshBVHWorker.js';
import { ANTIALIAS_OFFSETS, ANTIALIAS_WIDTH, EPSILON, getBasisFromNormal } from './pathtracing/utils.js';
import '@babel/polyfill';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

let scene, camera, renderer, light, clock;
let fsQuad, controls;
let raycaster, dataTexture, samples, ssPoint, task, delay, scanLinePercent;
let scanLineElement, containerElement, outputContainer;
let renderStartTime, computationTime;
let mesh, bvh, materials;
const MAX_BOUNCES = 30;
const DELAY_TIME = 300;
const FADE_DELAY = 150;
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

const models = {};
const params = {
	model: 'Dragon',
	resolution: {
		resolutionScale: 2,
		smoothImageScaling: false,
		stretchImage: true,
	},
	pathTracing: {
		pause: false,
		displayScanLine: false,
		antialiasing: true,
		bounces: 5,
		smoothNormals: true,
		directLightSampling: true,
	},
	material: {
		skyMode: 'sky',
		skyIntensity: 1.0,
		color: '#bbbbbb',
		emissive: '#000000',
		emissiveIntensity: 1,
		roughness: 1.0,
		metalness: 0.0,
		ior: 1.8,
		transmission: 0.0,
	},
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
	light = new THREE.DirectionalLight();
	light.position.set( 1, 1, 1 );
	// scene.add( light );

	light = new THREE.HemisphereLight( 0xffffff, 0x666666, 1 );
	scene.add( light );

	controls = new OrbitControls( camera, renderer.domElement );

	controls.addEventListener( 'change', resetImage );

	window.addEventListener( 'resize', onResize, false );
	onResize();

	// Load sphere
	models[ 'Sphere' ] = null;
	{

		const sphereMesh = new THREE.Mesh(
			new THREE.SphereBufferGeometry(),
			new THREE.MeshStandardMaterial(),
		);

		const planeMesh = new THREE.Mesh(
			new THREE.PlaneBufferGeometry(),
			new THREE.MeshStandardMaterial( { color: 0x7f7f7f, roughness: 0.5, metalness: 0.0 } ),
		);

		planeMesh.rotation.x = - Math.PI / 2;
		planeMesh.scale.setScalar( 10 );
		planeMesh.position.y = - 1;

		const { geometry, materials } = mergeMeshes( [ sphereMesh, planeMesh ], true );
		const merged = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
		scene.add( merged );

		bvh = new MeshBVH( geometry, { strategy: SAH, maxLeafTris: 1 } );

		models[ 'Sphere' ] = { mesh: merged, bvh, materials };

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

		const plane = new THREE.PlaneBufferGeometry();
		plane.rotateX( - Math.PI / 2 ).translate( 0, mesh.geometry.boundingBox.min.y, 0 ).scale( 10, 1, 10 );

		const ground = new THREE.Mesh(
			plane,
			new THREE.MeshStandardMaterial( { color: 0x7f7f7f, roughness: 0.2, metalness: 1 } ),
		);

		const { geometry, materials } = mergeMeshes( [ mesh, ground ], true );
		const merged = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );

		const generator = new GenerateMeshBVHWorker();
		generator
			.generate( geometry, { maxLeafTris: 1, strategy: SAH } )
			.then( bvh => {

				models[ 'Dragon' ] = { mesh: merged, bvh, materials };
				scene.add( merged );
				generator.terminate();

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

		const mesh = new THREE.Mesh( newGeometry, new THREE.MeshStandardMaterial() );
		const generator = new GenerateMeshBVHWorker();
		generator
			.generate( newGeometry, { maxLeafTris: 1, strategy: CENTER } )
			.then( bvh => {

				models[ 'Engine' ] = { mesh, bvh, materials: [ new THREE.MeshStandardMaterial() ] };
				scene.add( mesh );

				generator.terminate();

			} );

	} );

	models[ 'Rover' ] = null;
	new GLTFLoader().load( '../models/Perseverance.glb', gltf => {

		const meshes = [];
		gltf.scene.updateMatrixWorld( true );
		gltf.scene.traverse( c => {

			if ( c.isMesh ) {

				const g = c.geometry;
				for ( const key in g.attributes ) {

					if ( key !== 'position' && key !== 'normal' ) {

						delete g.attributes[ key ];

					}

				}

				meshes.push( c );

			}

		} );

		const plane = new THREE.PlaneBufferGeometry();
		delete plane.attributes.uv;

		const planeMesh = new THREE.Mesh( plane, new THREE.MeshStandardMaterial( { color: 0x7f7f7f } ) );
		planeMesh.rotateX( - Math.PI / 2 );
		planeMesh.scale.setScalar( 10 );

		const { geometry, materials } = mergeMeshes( [ ...meshes, planeMesh ], true );
		geometry.center();

		const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
		const generator = new GenerateMeshBVHWorker();
		generator
			.generate( geometry, { maxLeafTris: 1, strategy: SAH } )
			.then( bvh => {

				scene.add( mesh );
				models[ 'Rover' ] = { mesh, bvh, materials };

				generator.terminate();

			} );

	} );

	raycaster = new THREE.Raycaster();
	ssPoint = new THREE.Vector3();
	samples = 0;
	clock = new THREE.Clock();

	const gui = new GUI();
	gui.add( params, 'model', Object.keys( models ) ).onChange( resetImage );

	const resolutionFolder = gui.addFolder( 'resolution' );
	resolutionFolder.add( params.resolution, 'resolutionScale', 1, 5, 1 ).onChange( onResize );
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
	pathTracingFolder.add( params.pathTracing, 'bounces', 1, MAX_BOUNCES, 1 ).onChange( resetImage );
	pathTracingFolder.open();

	const materialFolder = gui.addFolder( 'material' );
	materialFolder.add( params.material, 'skyMode', [ 'sky', 'sun', 'checkerboard' ] ).onChange( resetImage );
	materialFolder.add( params.material, 'skyIntensity', 0, 2, 0.001 ).onChange( resetImage );
	materialFolder.addColor( params.material, 'color' ).onChange( resetImage );
	materialFolder.addColor( params.material, 'emissive' ).onChange( resetImage );
	materialFolder.add( params.material, 'emissiveIntensity', 0, 5, 0.001 ).onChange( resetImage );
	materialFolder.add( params.material, 'roughness', 0, 1.0, 0.001 ).onChange( resetImage );
	materialFolder.add( params.material, 'metalness', 0, 1.0, 0.001 ).onChange( resetImage );
	materialFolder.add( params.material, 'transmission', 0, 1.0, 0.001 ).onChange( resetImage );
	materialFolder.add( params.material, 'ior', 0.5, 2.5, 0.001 ).onChange( resetImage );
	materialFolder.open();

	onResize();

}

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

	const dpr = window.devicePixelRatio;
	const divisor = Math.pow( 2, parseFloat( params.resolution.resolutionScale ) - 1 );
	if ( params.resolution.stretchImage ) {

		containerElement.style.width = `${ window.innerWidth }px`;
		containerElement.style.height = `${ window.innerHeight }px`;
		renderer.setSize( window.innerWidth, window.innerHeight );
		renderer.setPixelRatio( dpr / divisor );
		resizeDataTexture(
			Math.floor( window.innerWidth * dpr / divisor ),
			Math.floor( window.innerHeight * dpr / divisor ),
		);

	} else {

		containerElement.style.width = `${ window.innerWidth / divisor }px`;
		containerElement.style.height = `${ window.innerHeight / divisor }px`;
		renderer.setSize(
			Math.floor( window.innerWidth / divisor ),
			Math.floor( window.innerHeight / divisor )
		);
		renderer.setPixelRatio( dpr );
		resizeDataTexture(
			Math.floor( window.innerWidth * dpr / divisor ),
			Math.floor( window.innerHeight * dpr / divisor ),
		);

	}

	renderer.domElement.style.imageRendering = params.resolution.smoothImageScaling ? 'auto' : 'pixelated';

}

function resetImage() {

	dataTexture.image.data.fill( 0 );
	dataTexture.needsUpdate = true;
	samples = 0;
	task = runPathTracing();
	delay = 0;
	scanLineElement.style.visibility = 'hidden';
	scanLinePercent = 100;

}

function* runPathTracing() {

	let lastStartTime = performance.now();
	const { width, height, data } = dataTexture.image;
	const bounces = parseInt( params.pathTracing.bounces );
	const skyIntensity = parseFloat( params.material.skyIntensity );
	const skyMode = params.material.skyMode;
	const smoothNormals = params.pathTracing.smoothNormals;
	const posAttr = bvh.geometry.attributes.position;
	const normalAttr = bvh.geometry.attributes.normal;
	const materialAttr = bvh.geometry.attributes.materialIndex;
	const radianceColor = new THREE.Color();
	const throughputColor = new THREE.Color();
	const normal = new THREE.Vector3();
	const rayStack = new Array( bounces ).fill().map( () => new THREE.Ray() );

	const sampleInfo = {
		pdf: 0,
		color: new THREE.Color(),
		direction: new THREE.Vector3(),
	};
	renderStartTime = performance.now();
	computationTime = 0;
	scanLinePercent = 100;
	scanLineElement.style.visibility = params.pathTracing.displayScanLine ? 'visible' : 'hidden';

	let aaIndex = 0;
	while ( true ) {

		let [ randomOffsetX, randomOffsetY ] = ANTIALIAS_OFFSETS[ aaIndex ];
		randomOffsetX = ( randomOffsetX / ANTIALIAS_WIDTH ) / width;
		randomOffsetY = ( randomOffsetY / ANTIALIAS_WIDTH ) / height;
		aaIndex = ( aaIndex + 1 ) % ANTIALIAS_OFFSETS.length;

		for ( let y = height - 1; y >= 0; y -- ) {

			for ( let x = 0; x < width; x ++ ) {

				ssPoint.set( randomOffsetX + x / ( width - 1 ), randomOffsetY + y / ( height - 1 ) );
				raycaster.setFromCamera( { x: ssPoint.x * 2 - 1, y: ssPoint.y * 2 - 1 }, camera );
				// TODO: transform ray into local space of bvh -- multiply by inverse of mesh.matrixWorld

				throughputColor.set( 0xffffff );
				radianceColor.set( 0 );
				getColorSample( raycaster.ray, throughputColor, radianceColor );

				const index = ( y * width + x ) * 4;
				if ( samples === 0 ) {

					data[ index + 0 ] = radianceColor.r;
					data[ index + 1 ] = radianceColor.g;
					data[ index + 2 ] = radianceColor.b;
					data[ index + 3 ] = 1.0;

				} else {

					// TODO: see if we can just accumulate and divide the total values out in a shader
					// to skip these calculations
					const r = data[ index + 0 ];
					const g = data[ index + 1 ];
					const b = data[ index + 2 ];
					data[ index + 0 ] += ( radianceColor.r - r ) / ( samples + 1 );
					data[ index + 1 ] += ( radianceColor.g - g ) / ( samples + 1 );
					data[ index + 2 ] += ( radianceColor.b - b ) / ( samples + 1 );

				}

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

	function expandHitInformation( hit, ray ) {

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
				.addScaledVector( normal2, barycoord.z );

		} else {

			normal.copy( geometryNormal );

		}

		const hitFrontFace = geometryNormal.dot( ray.direction ) < 0;
		if ( ! hitFrontFace ) {

			normal.multiplyScalar( - 1 );
			geometryNormal.multiplyScalar( - 1 );

		}

		const materialIndex = materialAttr.getX( face.a );
		const material = materials[ materialIndex ];
		hit.material = material;
		hit.materialIndex = materialIndex;
		hit.normal = normal;
		hit.geometryNormal = geometryNormal;
		hit.frontFace = hitFrontFace;

		normal.normalize();

	}

	function getColorSample( ray, throughput, targetColor, depth = 1 ) {

		const hit = bvh.raycastFirst( ray, THREE.DoubleSide );
		if ( hit ) {

			if ( depth !== bounces ) {

				expandHitInformation( hit, ray );
				const { material } = hit;
				const tempRay = rayStack[ depth ];

				const { emissive, emissiveIntensity } = material;

				// compute the outgoing vector (towards the camera) to feed into the bsdf to get the
				// incident light vector.
				getBasisFromNormal( hit.normal, normalBasis );
				invBasis.copy( normalBasis ).invert();
				localDirection.copy( ray.direction ).applyMatrix4( invBasis ).multiplyScalar( - 1 ).normalize();

				// sample the surface to get the pdf, reflected color, and direction
				bsdfSample( localDirection, hit, material, sampleInfo );

				// transform ray back to world frame and offset from surface
				tempRay.direction.copy( sampleInfo.direction ).applyMatrix4( normalBasis ).normalize();
				tempRay.origin.copy( hit.point );
				if ( tempRay.direction.dot( hit.geometryNormal ) < 0 ) {

					tempRay.origin.addScaledVector( hit.geometryNormal, - EPSILON );

				} else {

					tempRay.origin.addScaledVector( hit.geometryNormal, EPSILON );

				}

				targetColor.r += ( emissiveIntensity * emissive.r * throughput.r );
				targetColor.g += ( emissiveIntensity * emissive.g * throughput.g );
				targetColor.b += ( emissiveIntensity * emissive.b * throughput.b );

				// If our PDF indicates there's a less than 0 probability of sampling this direction then
				// don't include it in our sampling and terminate the ray modeling that the ray has been absorbed.
				if ( sampleInfo.pdf > 0 ) {

					sampleInfo.color.multiplyScalar( 1 / sampleInfo.pdf );
					throughput.multiply( sampleInfo.color );
					getColorSample( tempRay, throughput, targetColor, depth + 1 );

				}

			}

		} else {

			const direction = ray.direction;
			if ( skyMode === 'checkerboard' ) {

				spherical.setFromVector3( direction );

				const angleStep = Math.PI / 10;
				const thetaEven = Math.floor( spherical.theta / angleStep ) % 2 === 0;
				const phiEven = Math.floor( spherical.phi / angleStep ) % 2 === 0;
				const isBlack = thetaEven === phiEven;
				tempColor.set( isBlack ? 0 : 0xffffff ).multiplyScalar( 1.5 );
				tempColor.multiplyScalar( skyIntensity );

			} else if ( skyMode === 'sun' ) {

				normal0.setScalar( 1 ).normalize();

				let value = Math.max( 0.0, direction.dot( normal0 ) + 1.0 ) / 2.0;
				value *= value;
				tempColor.r = THREE.MathUtils.lerp( 0.01, 0.5, value );
				tempColor.g = THREE.MathUtils.lerp( 0.01, 0.7, value );
				tempColor.b = THREE.MathUtils.lerp( 0.01, 1.0, value );

				if ( value > 0.95 ) {

					let value2 = ( value - 0.95 ) / 0.05;
					value2 *= value2;
					tempColor.r = THREE.MathUtils.lerp( 0.5, 10.0, value2 );
					tempColor.g = THREE.MathUtils.lerp( 0.7, 10.0, value2 );
					tempColor.b = THREE.MathUtils.lerp( 1.0, 10.0, value2 );

				}

				tempColor.multiplyScalar( skyIntensity );

			} else {

				const value = ( direction.y + 0.5 ) / 2.0;
				tempColor.r = THREE.MathUtils.lerp( 1.0, 0.5, value );
				tempColor.g = THREE.MathUtils.lerp( 1.0, 0.7, value );
				tempColor.b = THREE.MathUtils.lerp( 1.0, 1.0, value );
				tempColor.multiplyScalar( skyIntensity );

			}

			tempColor.multiply( throughput );
			targetColor.add( tempColor );

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

	if ( models[ params.model ] ) {

		const model = models[ params.model ];
		model.mesh.visible = true;
		mesh = model.mesh;
		bvh = model.bvh;
		materials = model.materials;

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

	} else {

		mesh = null;
		bvh = null;
		materials = null;

	}

	let fade = 0;
	if ( delay > FADE_DELAY ) {

		fade = Math.min( ( delay - FADE_DELAY ) / ( DELAY_TIME - FADE_DELAY ), 1.0 );

	}

	fsQuad.material.map = dataTexture;
	fsQuad.material.opacity = fade;
	scanLineElement.style.bottom = `${ scanLinePercent }%`;
	if ( params.resolution.stretchImage ) {

		scanLineElement.style.borderBottomWidth = `${ Math.pow( 2, params.resolution.resolutionScale - 1 ) }px`;

	} else {

		scanLineElement.style.borderBottomWidth = '1px';

	}

	renderer.render( scene, camera );
	renderer.autoClear = false;
	fsQuad.render( renderer );
	renderer.autoClear = true;

	// run the path tracing
	scene.updateMatrixWorld( true );
	camera.updateMatrixWorld( true );
	if ( bvh && ! params.pathTracing.pause ) {

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

