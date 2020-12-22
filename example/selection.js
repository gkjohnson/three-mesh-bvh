import * as THREE from 'three';
import Stats from 'stats.js';
import { GUI } from 'dat.gui';
import { acceleratedRaycast } from '../src/index.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import MeshBVHVisualizer from '../src/MeshBVHVisualizer.js';
import MeshBVH from '../src/MeshBVH.js';

THREE.Mesh.raycast = acceleratedRaycast;

const params = {

	toolMode: 'lasso',
	selectionMode: 'centroid',
	wireframe: false,

	displayHelper: false,
	helperDepth: 10,

};

let renderer, camera, scene, gui, stats, controls, selectionShape;
const selectionPoints = [];
const tempMatrix = new THREE.Matrix4();
let selectionShapeNeedsUpdate = false;
let selectionNeedsUpdate = false;

init();
render();

function init() {

	const bgColor = 0xffca28;

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.gammaOutput = true;
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();
	scene.fog = new THREE.Fog( 0xffca28, 20, 60 );

	const light = new THREE.DirectionalLight( 0xffffff, 1 );
	light.position.set( 1, 1, 1 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xb0bec5, 0.8 ) );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 1, 2, 3 );
	camera.far = 100;
	camera.updateProjectionMatrix();
	scene.add( camera );

	// selection shape
	selectionShape = new THREE.Line();
	selectionShape.renderOrder = 1;
	selectionShape.position.z = - .2;
	selectionShape.depthTest = false;
	selectionShape.scale.setScalar( 1 );
	camera.add( selectionShape );

	scene.add( new THREE.GridHelper() )

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	controls = new OrbitControls( camera, renderer.domElement );
	controls.touches.ONE = THREE.TOUCH.PAN;
	controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
	controls.touches.TWO = THREE.TOUCH.ROTATE;
	controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
	controls.enablePan = false;

	gui = new GUI();
	gui.add( params, 'toolMode', [ 'lasso', 'box' ] );
	gui.open();

	let startX = - Infinity;
	let startY = - Infinity;

	let prevX = - Infinity;
	let prevY = - Infinity;

	const tempVec0 = new THREE.Vector2();
	const tempVec1 = new THREE.Vector2();
	const tempVec2 = new THREE.Vector2();
	document.addEventListener( 'pointerdown', e => {

		prevX = e.clientX;
		prevY = e.clientY;
		startX = ( e.clientX / window.innerWidth ) * 2 - 1;
		startY = ( e.clientY / window.innerHeight ) * 2 - 1;

		if ( params.toolMode === 'lasso' ) {

			selectionPoints.length = 0;

		}

	} );

	document.addEventListener( 'pointerup', () => {

		selectionShape.visible = false;
		selectionNeedsUpdate = true;

	} );

	document.addEventListener( 'pointermove', e => {

		if ( ( 1 & e.buttons ) === 0 ) {

			return;

		}

		const ex = e.clientX;
		const ey = e.clientY;

		const nx = ( e.clientX / window.innerWidth ) * 2 - 1;
		const ny = ( e.clientY / window.innerHeight ) * 2 - 1;

		if ( params.toolMode === 'box' ) {

			selectionPoints.length = 3 * 5;

			selectionPoints[ 0 ] = startX;
			selectionPoints[ 1 ] = startY;
			selectionPoints[ 2 ] = 0;

			selectionPoints[ 3 ] = nx;
			selectionPoints[ 4 ] = startY;
			selectionPoints[ 5 ] = 0;

			selectionPoints[ 6 ] = nx;
			selectionPoints[ 7 ] = ny;
			selectionPoints[ 8 ] = 0;

			selectionPoints[ 9 ] = startX;
			selectionPoints[ 10 ] = ny;
			selectionPoints[ 11 ] = 0;

			selectionPoints[ 12 ] = startX;
			selectionPoints[ 13 ] = startY;
			selectionPoints[ 14 ] = 0;

			if ( ex !== prevX || ey !== prevY ) {

				selectionShapeNeedsUpdate = true;

			}

			prevX = ex;
			prevY = ey;
			selectionShape.visible = true;

		} else {

			if (
				Math.abs( ex - prevX ) >= 3 ||
				Math.abs( ey - prevY ) >= 3
			) {

				const i = ( selectionPoints.length / 3 ) - 1;
				const i3 = i * 3;
				let doReplace = false;
				if ( selectionPoints.length > 3 ) {

					// prev segment
					tempVec0.set( selectionPoints[ i3 - 3 ], selectionPoints[ i3 - 3 + 1 ] );
					tempVec1.set( selectionPoints[ i3 ], selectionPoints[ i3 + 1 ] );
					tempVec1.sub( tempVec0 ).normalize();

					tempVec0.set( selectionPoints[ i3 ], selectionPoints[ i3 + 1 ] );
					tempVec2.set( nx, ny );
					tempVec2.sub( tempVec0 ).normalize();

					const dot = tempVec1.dot( tempVec2 );
					doReplace = dot > 0.99;

				}

				if ( doReplace ) {

					selectionPoints[ i3 ] = nx;
					selectionPoints[ i3 + 1 ] = ny;

				} else {

					selectionPoints.push( nx, ny, 0 );

				}

				selectionShapeNeedsUpdate = true;
				selectionShape.visible = true;

				prevX = ex;
				prevY = ey;

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

	if ( selectionShapeNeedsUpdate ) {

		if ( params.toolMode === 'lasso' ) {

			const ogLength = selectionPoints.length;
			selectionPoints.push(
				selectionPoints[ 0 ],
				selectionPoints[ 1 ],
				selectionPoints[ 2 ]
			);

			selectionShape.geometry.setAttribute(
				'position',
				new THREE.Float32BufferAttribute( selectionPoints, 3, false )
			);

			selectionPoints.length = ogLength;

		} else {

			selectionShape.geometry.setAttribute(
				'position',
				new THREE.Float32BufferAttribute( selectionPoints, 3, false )
			);

		}
		selectionShape.frustumCulled = false;
		selectionShapeNeedsUpdate = false;

	}

	if ( selectionNeedsUpdate ) {

		// TODO: run lasso selection
		// tempMatrix
		// 	.copy( mesh.matrixWorld )
		// 	.premultiply( camera.matrixWorldInverse )
		// 	.premultiply( camera.projectionMatrixInverse );

		// mesh.geometry.shapecast(
		// 	mesh,
		// 	box => {

		// 		// TODO:
		// 		// - check if all box points are inside the lasso
		// 		// - if they are not then it it does not intersect
		// 		// - if the crossings do not match then it intersects
		// 		// - check if any lasso and box lines intersect
		// 		// - if they do then the box is intersected

		// 	},
		// 	tri => {

		// 		// TODO:
		// 		// - check if the centroid or points are inside the lasso
		// 		// - check if the triangle edges intersect the lasso edges
		// 		// - if they are or do then the triangle is selected

		// 	}
		// );

	}

	const yScale = Math.tan( THREE.MathUtils.DEG2RAD * camera.fov / 2 ) * selectionShape.position.z;
	selectionShape.scale.set( - yScale * camera.aspect, yScale, 1 );

	renderer.render( scene, camera );

}
