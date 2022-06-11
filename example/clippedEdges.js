import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
// import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import Stats from 'stats.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { MeshBVH, MeshBVHVisualizer, CONTAINED } from '..';

const params = {
	useBVH: true,

	helperDisplay: false,
	helperDepth: 10,

	wireframeDisplay: false,
	displayModel: true,

	animate: true,
	animation: 'SPIN',
	invert: false,
};

let renderer, camera, scene, gui, stats;
let controls, clock;
let colliderBvh, colliderMesh, bvhHelper;
let frontSideModel, backSideModel, planeMesh;
let clippingPlanes, outlineLines;
let initialClip = false;
let outputElement = null;
let time = 0;

const tempVector = new THREE.Vector3();
const tempVector1 = new THREE.Vector3();
const tempVector2 = new THREE.Vector3();
const tempVector3 = new THREE.Vector3();
const tempLine = new THREE.Line3();
const inverseMatrix = new THREE.Matrix4();
const localPlane = new THREE.Plane();

init();
render();

function init() {

	outputElement = document.getElementById( 'output' );

	const bgColor = new THREE.Color( 0x263238 ).multiplyScalar( 0.1 );

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	renderer.outputEncoding = THREE.sRGBEncoding;
	renderer.localClippingEnabled = true;
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();
	scene.fog = new THREE.Fog( bgColor, 20, 70 );

	// lights
	const light = new THREE.DirectionalLight( 0xffffff, 0.8 );
	light.position.set( 1, 1.5, 2 ).multiplyScalar( 50 );
	scene.add( light );
	scene.add( new THREE.HemisphereLight( 0xffffff, 0x223344, 0.5 ) );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.01, 50 );
	camera.position.set( 0.4, 0.4, 0.4 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	controls = new OrbitControls( camera, renderer.domElement );

	clock = new THREE.Clock();

	// clippingPlanes
	clippingPlanes = [
		new THREE.Plane(),
	];

	planeMesh = new THREE.Mesh( new THREE.PlaneBufferGeometry(), new THREE.MeshBasicMaterial( {
		side: THREE.DoubleSide,
		stencilWrite: true,
		stencilFunc: THREE.NotEqualStencilFunc,
		stencilFail: THREE.ZeroStencilOp,
		stencilZFail: THREE.ZeroStencilOp,
		stencilZPass: THREE.ZeroStencilOp,
	} ) );
	planeMesh.scale.setScalar( 1.5 );
	planeMesh.material.color.set( 0x80deea ).convertLinearToSRGB();
	planeMesh.renderOrder = 2;
	scene.add( planeMesh );

	// create line geometry with enough data to hold 100000 segments
	const lineGeometry = new THREE.BufferGeometry();
	const linePosAttr = new THREE.BufferAttribute( new Float32Array( 300000 ), 3, false );
	linePosAttr.setUsage( THREE.DynamicDrawUsage );
	lineGeometry.setAttribute( 'position', linePosAttr );
	outlineLines = new THREE.LineSegments( lineGeometry, new THREE.LineBasicMaterial() );
	outlineLines.material.color.set( 0x00acc1 ).convertSRGBToLinear();
	outlineLines.frustumCulled = false;
	outlineLines.renderOrder = 3;

	// load the model
	const loader = new GLTFLoader();
	loader.setMeshoptDecoder( MeshoptDecoder );
	loader.load( '../models/internal_combustion_engine/model.gltf', gltf => {

		// merge the geometry if needed
		// let model = gltf.scene;
		// model.updateMatrixWorld( true );

		// create a merged version if it isn't already
		// const geometries = [];
		// model.traverse( c => {

		// 	if ( c.isMesh ) {

		// 		const clonedGeometry = c.geometry.clone();
		// 		clonedGeometry.applyMatrix4( c.matrixWorld );
		// 		for ( const key in clonedGeometry.attributes ) {

		// 			if ( key === 'position' || key === 'normal' ) {

		// 				continue;

		// 			}

		// 			clonedGeometry.deleteAttribute( key );

		// 		}

		// 		geometries.push( clonedGeometry );

		// 	}

		// } );

		// const mergedGeometry = BufferGeometryUtils.mergeBufferGeometries( geometries );
		// model = new THREE.Mesh( mergedGeometry, new THREE.MeshStandardMaterial() );

		// Render Order
		// 0. Render front model and back model with stencil
		// 1. Render surface color model
		// 2. Render clip pane cap
		// 3. Render outlines

		// use basic material because the using clip caps is expensive since the fragment
		// shader has to run always.
		const model = gltf.scene.children[ 0 ];
		const mergedGeometry = model.geometry;
		model.material = new THREE.MeshBasicMaterial();
		model.position.set( 0, 0, 0 );
		model.quaternion.identity();

		// color the surface of the geometry with an EQUAL depth to limit the amount of
		// fragment shading that has to run.
		const surfaceModel = model.clone();
		surfaceModel.material = new THREE.MeshStandardMaterial( {
			depthFunc: THREE.EqualDepth,
		} );
		surfaceModel.renderOrder = 1;

		outlineLines.scale.copy( model.scale );
		outlineLines.position.set( 0, 0, 0 );
		outlineLines.quaternion.identity();

		model.updateMatrixWorld( true );

		// Adjust all the materials to draw front and back side with stencil for clip cap
		const matSet = new Set();
		const materialMap = new Map();
		frontSideModel = model;
		frontSideModel.updateMatrixWorld( true );
		frontSideModel.traverse( c => {

			if ( c.isMesh ) {

				if ( materialMap.has( c.material ) ) {

					c.material = materialMap.get( c.material );
					return;

				}

				matSet.add( c.material );

				const material = c.material.clone();
				material.color.set( 0xffffff );
				material.roughness = 1.0;
				material.metalness = 0.0;
				material.side = THREE.FrontSide;
				material.stencilWrite = true;
				material.stencilFail = THREE.IncrementWrapStencilOp;
				material.stencilZFail = THREE.IncrementWrapStencilOp;
				material.stencilZPass = THREE.IncrementWrapStencilOp;
				material.clippingPlanes = clippingPlanes;

				materialMap.set( c.material, material );
				c.material = material;

			}

		} );

		materialMap.clear();

		backSideModel = frontSideModel.clone();
		backSideModel.traverse( c => {

			if ( c.isMesh ) {

				if ( materialMap.has( c.material ) ) {

					c.material = materialMap.get( c.material );
					return;

				}

				const material = c.material.clone();
				material.color.set( 0xffffff );
				material.roughness = 1.0;
				material.metalness = 0.0;
				material.colorWrite = false;
				material.depthWrite = false;
				material.side = THREE.BackSide;
				material.stencilWrite = true;
				material.stencilFail = THREE.DecrementWrapStencilOp;
				material.stencilZFail = THREE.DecrementWrapStencilOp;
				material.stencilZPass = THREE.DecrementWrapStencilOp;
				material.clippingPlanes = clippingPlanes;

				materialMap.set( c.material, material );
				c.material = material;

			}

		} );

		// create the collider and preview mesh
		colliderBvh = new MeshBVH( mergedGeometry, { maxLeafTris: 3 } );
		mergedGeometry.boundsTree = colliderBvh;

		colliderMesh = new THREE.Mesh( mergedGeometry, new THREE.MeshBasicMaterial( {
			wireframe: true,
			transparent: true,
			opacity: 0.01,
			depthWrite: false,
		} ) );
		colliderMesh.renderOrder = 2;
		colliderMesh.position.copy( model.position );
		colliderMesh.rotation.copy( model.rotation );
		colliderMesh.scale.copy( model.scale );

		bvhHelper = new MeshBVHVisualizer( colliderMesh, parseInt( params.helperDepth ) );
		bvhHelper.depth = parseInt( params.helperDepth );
		bvhHelper.update();

		// create group of meshes and offset it so they're centered
		const group = new THREE.Group();
		group.add( frontSideModel, backSideModel, surfaceModel, colliderMesh, bvhHelper, outlineLines );

		const box = new THREE.Box3();
		box.setFromObject( frontSideModel );
		box.getCenter( group.position ).multiplyScalar( - 1 );
		group.updateMatrixWorld( true );
		scene.add( group );

	} );

	// dat.gui
	gui = new GUI();

	gui.add( params, 'invert' );
	gui.add( params, 'animate' );
	gui.add( params, 'animation', [ 'SPIN', 'OSCILLATE' ] ).onChange( () => {

		time = 0;

	} );
	gui.add( params, 'displayModel' );
	gui.add( params, 'useBVH' );

	const helperFolder = gui.addFolder( 'helper' );
	helperFolder.add( params, 'wireframeDisplay' );
	helperFolder.add( params, 'helperDisplay' );
	helperFolder.add( params, 'helperDepth', 1, 20, 1 ).onChange( v => {

		if ( bvhHelper ) {

			bvhHelper.depth = parseInt( v );
			bvhHelper.update();

		}

	} );
	helperFolder.open();

	gui.open();

	// stats
	stats = new Stats();
	document.body.appendChild( stats.domElement );

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );
		renderer.setPixelRatio( window.devicePixelRatio );

	}, false );

}

function render() {

	if ( bvhHelper ) {

		bvhHelper.visible = params.helperDisplay;
		colliderMesh.visible = params.wireframeDisplay;

		frontSideModel.visible = params.displayModel;
		backSideModel.visible = params.displayModel;

	}

	// make the outlines darker if the model is shown
	outlineLines.material.color
		.set( params.displayModel ? 0x00acc1 : 0x4dd0e1 )
		.convertSRGBToLinear();

	const delta = Math.min( clock.getDelta(), 0.03 );
	if ( params.animate ) {

		time += delta;

		if ( params.animation === 'SPIN' ) {

			planeMesh.rotation.x = 0.25 * time;
			planeMesh.rotation.y = 0.25 * time;
			planeMesh.rotation.z = 0.25 * time;
			planeMesh.position.set( 0, 0, 0 );

		} else {

			planeMesh.position.set( Math.sin( 0.25 * time ) * 0.325, 0, 0 );
			planeMesh.rotation.set( 0, Math.PI / 2, 0 );

		}

		planeMesh.updateMatrixWorld();

	}

	const clippingPlane = clippingPlanes[ 0 ];
	clippingPlane.normal.set( 0, 0, params.invert ? 1 : - 1 );
	clippingPlane.constant = 0;
	clippingPlane.applyMatrix4( planeMesh.matrixWorld );

	// Perform the clipping
	if ( colliderBvh && ( params.animate || ! initialClip ) ) {

		initialClip = true;

		// get the clipping plane in the local space of the BVH
		inverseMatrix.copy( colliderMesh.matrixWorld ).invert();
		localPlane.copy( clippingPlane ).applyMatrix4( inverseMatrix );

		let index = 0;
		const posAttr = outlineLines.geometry.attributes.position;
		const startTime = window.performance.now();
		colliderBvh.shapecast( {

			intersectsBounds: box => {

				// if we're not using the BVH then skip straight to iterating over all triangles
				if ( ! params.useBVH ) {

					return CONTAINED;

				}

				return localPlane.intersectsBox( box );

			},

			intersectsTriangle: tri => {

				// check each triangle edge to see if it intersects with the plane. If so then
				// add it to the list of segments.
				let count = 0;

				tempLine.start.copy( tri.a );
				tempLine.end.copy( tri.b );
				if ( localPlane.intersectLine( tempLine, tempVector ) ) {

					posAttr.setXYZ( index, tempVector.x, tempVector.y, tempVector.z );
					index ++;
					count ++;

				}

				tempLine.start.copy( tri.b );
				tempLine.end.copy( tri.c );
				if ( localPlane.intersectLine( tempLine, tempVector ) ) {

					posAttr.setXYZ( index, tempVector.x, tempVector.y, tempVector.z );
					count ++;
					index ++;

				}

				tempLine.start.copy( tri.c );
				tempLine.end.copy( tri.a );
				if ( localPlane.intersectLine( tempLine, tempVector ) ) {

					posAttr.setXYZ( index, tempVector.x, tempVector.y, tempVector.z );
					count ++;
					index ++;

				}

				// When the plane passes through a vertex and one of the edges of the triangle, there will be three intersections, two of which must be repeated
				if ( count === 3 ) {

					tempVector1.fromBufferAttribute( posAttr, index - 3 );
					tempVector2.fromBufferAttribute( posAttr, index - 2 );
					tempVector3.fromBufferAttribute( posAttr, index - 1 );
					// If the last point is a duplicate intersection
					if ( tempVector3.equals( tempVector1 ) || tempVector3.equals( tempVector2 ) ) {

						count --;
						index --;

					} else if ( tempVector1.equals( tempVector2 ) ) {

						// If the last point is not a duplicate intersection
						// Set the penultimate point as a distinct point and delete the last point
						posAttr.setXYZ( index - 2, tempVector3 );
						count --;
						index --;

					}

				}

				// If we only intersected with one or three sides then just remove it. This could be handled
				// more gracefully.
				if ( count !== 2 ) {

					index -= count;

				}

			},

		} );

		// set the draw range to only the new segments and offset the lines so they don't intersect with the geometry
		outlineLines.geometry.setDrawRange( 0, index );
		outlineLines.position.copy( clippingPlane.normal ).multiplyScalar( - 0.00001 );
		posAttr.needsUpdate = true;

		const delta = window.performance.now() - startTime;
		outputElement.innerText = `${ parseFloat( delta.toFixed( 3 ) ) }ms`;

	}

	stats.update();
	requestAnimationFrame( render );

	controls.update();

	renderer.render( scene, camera );

}

