import * as THREE from 'three';
import Stats from 'stats.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
	BVHHelper,
	MeshBVH,
} from 'three-mesh-bvh';
import { LassoSelection, BoxSelection } from './src/Selection.js';
import { computeSelectedTriangles } from './src/computeSelectedTriangles.js';

const params = {

	/** Selection tool: 'lasso' or 'box'. */
	toolMode: 'lasso',
	/**
	 * How triangles are marked for selection:
	 * - 'intersection': if any part of the triangle is within the selection shape.
	 * - 'centroid': if the center of the triangle is within the selection shape.
	 * - 'centroid-visible': if the center of the triangle is within the selection shape and the triangle is visible.
	 */
	selectionMode: 'intersection',
	liveUpdate: false,
	selectWholeModel: false,
	wireframe: false,
	useBoundsTree: true,

	displayHelper: false,
	helperDepth: 10,
	rotate: true,

};

let renderer, camera, scene, gui, stats, controls, selectionShape, mesh, helper;
let highlightMesh, highlightWireframeMesh, outputContainer, group;
let selectionShapeNeedsUpdate = false;
let selectionNeedsUpdate = false;
let tool = new LassoSelection();

init();
render();

/** Set up the scene, controls GUI, and event listeners. */
function init() {

	outputContainer = document.getElementById( 'output' );

	const bgColor = new THREE.Color( 0x263238 );

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.shadowMap.enabled = true;
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();

	const light = new THREE.DirectionalLight( 0xffffff, 3 );
	light.castShadow = true;
	light.shadow.mapSize.set( 2048, 2048 );
	light.position.set( 10, 10, 10 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xb0bec5, 2.5 ) );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 2, 4, 6 );
	camera.far = 100;
	camera.updateProjectionMatrix();
	scene.add( camera );

	// selection shape
	selectionShape = new THREE.Line();
	selectionShape.material.color.set( 0xff9800 );
	selectionShape.renderOrder = 1;
	selectionShape.position.z = - .2;
	selectionShape.depthTest = false;
	selectionShape.scale.setScalar( 1 );
	camera.add( selectionShape );

	// group for rotation
	group = new THREE.Group();
	scene.add( group );

	// base mesh
	mesh = new THREE.Mesh(
		new THREE.TorusKnotGeometry( 1.5, 0.5, 500, 60 ).toNonIndexed(),
		new THREE.MeshStandardMaterial( {
			polygonOffset: true,
			polygonOffsetFactor: 1,
		} )
	);
	mesh.geometry.boundsTree = new MeshBVH( mesh.geometry );
	mesh.geometry.setAttribute( 'color', new THREE.Uint8BufferAttribute(
		new Array( mesh.geometry.index.count * 3 ).fill( 255 ), 3, true
	) );
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	group.add( mesh );

	helper = new BVHHelper( mesh, 10 );
	group.add( helper );

	// meshes for selection highlights
	highlightMesh = new THREE.Mesh();
	highlightMesh.geometry = mesh.geometry.clone();
	highlightMesh.geometry.drawRange.count = 0;
	highlightMesh.material = new THREE.MeshBasicMaterial( {
		opacity: 0.05,
		transparent: true,
		depthWrite: false,
	} );
	highlightMesh.material.color.set( 0xff9800 );
	highlightMesh.renderOrder = 1;
	group.add( highlightMesh );

	highlightWireframeMesh = new THREE.Mesh();
	highlightWireframeMesh.geometry = highlightMesh.geometry;
	highlightWireframeMesh.material = new THREE.MeshBasicMaterial( {
		opacity: 0.25,
		transparent: true,
		wireframe: true,
		depthWrite: false,
	} );
	highlightWireframeMesh.material.color.copy( highlightMesh.material.color );
	highlightWireframeMesh.renderOrder = 2;
	group.add( highlightWireframeMesh );

	// add floor
	const gridHelper = new THREE.GridHelper( 10, 10, 0xffffff, 0xffffff );
	gridHelper.material.opacity = 0.2;
	gridHelper.material.transparent = true;
	gridHelper.position.y = - 2.75;
	scene.add( gridHelper );

	const shadowPlane = new THREE.Mesh(
		new THREE.PlaneGeometry(),
		new THREE.ShadowMaterial( { color: 0, opacity: 0.2, depthWrite: false } )
	);
	shadowPlane.position.y = - 2.74;
	shadowPlane.rotation.x = - Math.PI / 2;
	shadowPlane.scale.setScalar( 20 );
	shadowPlane.renderOrder = 2;
	shadowPlane.receiveShadow = true;
	scene.add( shadowPlane );

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.minDistance = 3;
	controls.touches.ONE = THREE.TOUCH.PAN;
	controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
	controls.touches.TWO = THREE.TOUCH.ROTATE;
	controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
	controls.enablePan = false;

	// gui
	gui = new GUI();
	const selectionFolder = gui.addFolder( 'selection' );
	selectionFolder.add( params, 'toolMode', [ 'lasso', 'box' ] ).onChange( ( v ) => {

		if ( v === 'box' ) {

			tool = new BoxSelection();

		} else {

			tool = new LassoSelection();

		}

	} );
	selectionFolder.add( params, 'selectionMode', [ 'centroid', 'centroid-visible', 'intersection' ] );
	selectionFolder.add( params, 'selectWholeModel' );
	selectionFolder.add( params, 'liveUpdate' );
	selectionFolder.add( params, 'useBoundsTree' );
	selectionFolder.open();

	const displayFolder = gui.addFolder( 'display' );
	displayFolder.add( params, 'wireframe' );
	displayFolder.add( params, 'rotate' );
	displayFolder.add( params, 'displayHelper' );
	displayFolder.add( params, 'helperDepth', 1, 30, 1 ).onChange( v => {

		helper.depth = v;
		helper.update();

	} );
	displayFolder.open();
	gui.open();

	renderer.domElement.addEventListener( 'pointerdown', ( e ) => {

		tool.handlePointerDown( e );

	} );

	renderer.domElement.addEventListener( 'pointerup', () => {

		tool.handlePointerUp();
		selectionShape.visible = false;
		if ( tool.points.length ) {

			selectionNeedsUpdate = true;

		}

	} );

	renderer.domElement.addEventListener( 'pointermove', e => {

		// If the left mouse button is not pressed
		if ( ( 1 & e.buttons ) === 0 ) {

			return;

		}

		const { changed } = tool.handlePointerMove( e );

		if ( changed ) {

			selectionShapeNeedsUpdate = true;
			selectionShape.visible = true;
			if ( params.liveUpdate ) {

				selectionNeedsUpdate = true;

			}

		}

	} );

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

}

function render() {

	stats.update();
	requestAnimationFrame( render );

	mesh.material.wireframe = params.wireframe;
	helper.visible = params.displayHelper;
	const selectionPoints = tool.points;

	// Update the selection lasso lines
	if ( selectionShapeNeedsUpdate ) {

		selectionShape.geometry.setAttribute(
			'position',
			new THREE.Float32BufferAttribute(
				selectionPoints.concat( selectionPoints.slice( 0, 3 ) ),
				3,
				false
			)
		);

		selectionShape.frustumCulled = false;
		selectionShapeNeedsUpdate = false;

	}

	if ( selectionNeedsUpdate ) {

		selectionNeedsUpdate = false;

		if ( selectionPoints.length > 0 ) {

			updateSelection();

		}

	}

	const yScale = Math.tan( THREE.MathUtils.DEG2RAD * camera.fov / 2 ) * selectionShape.position.z;
	selectionShape.scale.set( - yScale * camera.aspect, - yScale, 1 );

	renderer.render( scene, camera );

	if ( params.rotate ) {

		group.rotation.y += 0.01;
		if ( params.liveUpdate && tool.dragging ) {

			selectionNeedsUpdate = true;

		}

	}

}

/**
 * Compute selected triangles:
 *
 * 1. Construct a list of screen space line segments that represent the lasso shape drawn by the user.
 * 2. For every triangle in the geometry check if any part is within the lasso. If it is then consider the triangle selected.
 *
 * @see https://github.com/gkjohnson/three-mesh-bvh/issues/166#issuecomment-752194034
 */
function updateSelection() {

	const startTime = window.performance.now();
	const indices = computeSelectedTriangles( mesh, camera, tool, params );

	const traverseTime = window.performance.now() - startTime;
	outputContainer.innerText = `${ traverseTime.toFixed( 3 ) }ms`;

	const indexAttr = mesh.geometry.index;
	const newIndexAttr = highlightMesh.geometry.index;
	if ( indices.length && params.selectWholeModel ) {

		// if we found indices and we want to select the whole model
		for ( let i = 0, l = indexAttr.count; i < l; i ++ ) {

			const i2 = indexAttr.getX( i );
			newIndexAttr.setX( i, i2 );

		}

		highlightMesh.geometry.drawRange.count = Infinity;
		newIndexAttr.needsUpdate = true;

	} else {

		// update the highlight mesh
		for ( let i = 0, l = indices.length; i < l; i ++ ) {

			const i2 = indexAttr.getX( indices[ i ] );
			newIndexAttr.setX( i, i2 );

		}

		highlightMesh.geometry.drawRange.count = indices.length;
		newIndexAttr.needsUpdate = true;

	}

}
