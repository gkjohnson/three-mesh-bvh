import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BufferGeometryUtils } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import Stats from 'stats.js';
import { GUI } from 'dat.gui';
import { MeshBVH, MeshBVHVisualizer, CONTAINED } from '../src/index.js';

const params = {
	useBVH: true,

	helperDisplay: false,
	helperDepth: 10,

	wireframeDisplay: false,
	displayModel: true,

	animate: true,
};

let renderer, camera, scene, gui, stats;
let controls, clock;
let collider, colliderMesh, bvhHelper;
let frontSideModel, backSideModel, plane;
let planesArray, outlineLines;
let initialClip = false;

init();
render();

// TODO
// - display timing in the bottom left to compare bvh vs non bvh timing

function init() {

	const bgColor = new THREE.Color( 0x263238 ).multiplyScalar( 0.1 );

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	renderer.gammaOutput = true;
	renderer.localClippingEnabled = true;
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();
	scene.fog = new THREE.Fog( bgColor, 20, 70 );

	// lights
	const light = new THREE.DirectionalLight( 0xffffff, 1 );
	light.position.set( 1, 1.5, 1 ).multiplyScalar( 50 );


	scene.add( light );
	scene.add( new THREE.HemisphereLight( 0xffffff, 0x223344, 0.4 ) );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 0.4, 0.4, 0.4 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	window.camera = camera;

	controls = new OrbitControls( camera, renderer.domElement );

	clock = new THREE.Clock();

	planesArray = [
		new THREE.Plane(),
	];

	plane = new THREE.Mesh( new THREE.PlaneBufferGeometry(), new THREE.MeshBasicMaterial( {
		stencilWrite: true,
		stencilFunc: THREE.NotEqualStencilFunc,
		stencilFail: THREE.ZeroStencilOp,
		stencilZFail: THREE.ZeroStencilOp,
		stencilZPass: THREE.ZeroStencilOp,
	} ) );
	plane.scale.setScalar( 4 );
	plane.material.color.set( 0x80deea ).convertLinearToSRGB();
	plane.renderOrder = 1;
	scene.add( plane );

	const lineGeometry = new THREE.BufferGeometry();
	lineGeometry.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( 300000 ), 3, false ) );
	outlineLines = new THREE.LineSegments( lineGeometry, new THREE.LineBasicMaterial() );
	outlineLines.material.color.set( 0x00bcd4 ).convertSRGBToLinear();
	outlineLines.frustumCulled = false;

	new GLTFLoader().load( '../models/internal_combustion_engine/scene.gltf', gltf => {

		let model = gltf.scene;
		model.updateMatrixWorld( true );

		const geometries = [];
		model.traverse( c => {

			if ( c.isMesh ) {

				const clonedGeometry = c.geometry.clone();
				clonedGeometry.applyMatrix4( c.matrixWorld );
				for ( const key in clonedGeometry.attributes ) {

					if ( key === 'position' || key === 'normal' ) {

						continue;

					}

					console.log( 'HERE', key );

					clonedGeometry.deleteAttribute( key );

				}

				geometries.push( clonedGeometry );

			}

		} );

		const mergedGeometry = BufferGeometryUtils.mergeBufferGeometries( geometries );
		model = new THREE.Mesh( mergedGeometry, new THREE.MeshStandardMaterial() );

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
				material.clippingPlanes = planesArray;

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
				material.clippingPlanes = planesArray;

				materialMap.set( c.material, material );
				c.material = material;

			}

		} );

		collider = new MeshBVH( mergedGeometry, { maxLeafTris: 3 } );
		mergedGeometry.boundsTree = collider;

		colliderMesh = new THREE.Mesh( mergedGeometry, new THREE.MeshBasicMaterial( {
			wireframe: true,
			transparent: true,
			opacity: 0.1,
			depthWrite: false,
		} ) );
		colliderMesh.renderOrder = 2;

		bvhHelper = new MeshBVHVisualizer( colliderMesh, parseInt( params.helperDepth ) );
		bvhHelper.depth = parseInt( params.helperDepth );
		bvhHelper.update();

		const group = new THREE.Group();
		group.add( frontSideModel, backSideModel, colliderMesh, bvhHelper, outlineLines );

		const box = new THREE.Box3();
		box.setFromObject( frontSideModel );
		box.getCenter( group.position ).multiplyScalar( - 1 );
		group.updateMatrixWorld( true );
		scene.add( group );

	} );

	// dat.gui
	gui = new GUI();

	gui.add( params, 'animate' );
	gui.add( params, 'displayModel' );
	gui.add( params, 'useBVH' );

	const helperFolder = gui.addFolder( 'helper' );
	helperFolder.add( params, 'helperDisplay' );
	helperFolder.add( params, 'helperDepth', 1, 20, 1 ).onChange( v => {

		if ( bvhHelper ) {

			bvhHelper.depth = parseInt( v );
			bvhHelper.update();

		}

	} );
	helperFolder.add( params, 'wireframeDisplay' );
	helperFolder.open();

	gui.open();


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

	const delta = Math.min( clock.getDelta(), 0.03 );
	if ( params.animate ) {

		plane.rotation.x += 0.25 * delta;
		plane.rotation.y += 0.25 * delta;
		plane.rotation.z += 0.25 * delta;
		plane.updateMatrixWorld();

	}

	const clippingPlane = planesArray[ 0 ];
	clippingPlane.normal.set( 0, 0, - 1 ).applyMatrix4( plane.matrixWorld );

	if ( collider && ( params.animate || ! initialClip ) ) {

		initialClip = true;

		const tempVector = new THREE.Vector3();
		const tempLine = new THREE.Line3();
		const inverseMatrix = new THREE.Matrix4().copy( colliderMesh.matrixWorld ).invert();
		const localPlane = clippingPlane.clone().applyMatrix4( inverseMatrix );

		let index = 0;
		const posAttr = outlineLines.geometry.attributes.position;
		collider.shapecast( null, {

			intersectsBounds: box => {

				if ( ! params.useBVH ) {

					return CONTAINED;

				}

				let side = null;
				const { min, max } = box;
				for ( let x = - 1; x <= 1; x += 2 ) {

					for ( let y = - 1; y <= 1; y += 2 ) {

						for ( let z = - 1; z <= 1; z += 2 ) {

							tempVector.x = x === - 1 ? min.x : max.x;
							tempVector.y = y === - 1 ? min.y : max.y;
							tempVector.z = z === - 1 ? min.z : max.z;

							const newSide = localPlane.distanceToPoint( tempVector ) > 0;
							if ( side === null ) side = newSide;
							else if ( side !== newSide ) return true;

						}

					}

				}

				return false;

			},

			intersectsTriangle: tri => {

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

				if ( count !== 2 ) {

					index -= count;

				}

			},

		} );

		outlineLines.geometry.setDrawRange( 0, index );
		outlineLines.position.copy( clippingPlane.normal ).multiplyScalar( - 0.00001 );
		posAttr.needsUpdate = true;

	}

	stats.update();
	requestAnimationFrame( render );

	controls.update();

	renderer.render( scene, camera );

}

