import * as THREE from 'three';
import Stats from 'stats.js';
import { GUI } from 'dat.gui';
import { acceleratedRaycast } from '../src/index.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
	MeshBVHVisualizer,
	MeshBVH,
	CONTAINED,
	INTERSECTED,
	NOT_INTERSECTED,
} from '../src/index.js';

THREE.Mesh.raycast = acceleratedRaycast;

const params = {

	toolMode: 'lasso',
	selectionMode: 'intersection',
	liveUpdate: false,
	wireframe: false,
	useBoundsTree: true,

	displayHelper: false,
	helperDepth: 10,

};

let renderer, camera, scene, gui, stats, controls, selectionShape, mesh, helper;
let highlightMesh, highlightWireframeMesh, outputContainer;
const tempMatrix = new THREE.Matrix4();
const selectionPoints = [];
let selectionShapeNeedsUpdate = false;
let selectionNeedsUpdate = false;

init();
render();

function init() {

	outputContainer = document.getElementById( 'output' );

	const bgColor = new THREE.Color( 0x263238 );

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.gammaOutput = true;
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();

	const light = new THREE.DirectionalLight( 0xffffff, 1 );
	light.position.set( 1, 1, 1 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xb0bec5, 0.8 ) );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 2, 4, 6 );
	camera.far = 100;
	camera.updateProjectionMatrix();
	scene.add( camera );

	// selection shape
	selectionShape = new THREE.Line();
	selectionShape.material.color.set( 0xff9800 ).convertSRGBToLinear();
	selectionShape.renderOrder = 1;
	selectionShape.position.z = - .2;
	selectionShape.depthTest = false;
	selectionShape.scale.setScalar( 1 );
	camera.add( selectionShape );

	mesh = new THREE.Mesh(
		new THREE.TorusKnotBufferGeometry( 1.5, 0.5, 500, 60 ).toNonIndexed(),
		new THREE.MeshStandardMaterial( {
			polygonOffset: true,
			polygonOffsetFactor: 1,
		} )
	);
	mesh.geometry.boundsTree = new MeshBVH( mesh.geometry, { lazyGeneration: false } );
	mesh.geometry.setAttribute( 'color', new THREE.Uint8BufferAttribute(
		new Array( mesh.geometry.index.count * 3 ).fill( 255 ), 3, true
	) );
	scene.add( mesh );

	highlightMesh = new THREE.Mesh();
	highlightMesh.geometry = mesh.geometry.clone();
	highlightMesh.geometry.drawRange.count = 0;
	highlightMesh.material = new THREE.MeshBasicMaterial( {
		opacity: 0.05,
		transparent: true,
		depthWrite: false,
	} );
	highlightMesh.material.color.set( 0xff9800 ).convertSRGBToLinear();
	highlightMesh.renderOrder = 1;
	scene.add( highlightMesh );

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
	scene.add( highlightWireframeMesh );

	helper = new MeshBVHVisualizer( mesh, 10 );
	scene.add( helper );

	const gridHelper = new THREE.GridHelper( 10, 10, 0xffffff, 0xffffff );
	gridHelper.material.opacity = 0.5;
	gridHelper.material.transparent = true;
	gridHelper.position.y = - 2.5;

	scene.add( gridHelper );

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
	gui.add( params, 'selectionMode', [ 'centroid', 'intersection' ] );
	gui.add( params, 'liveUpdate' );
	gui.add( params, 'useBoundsTree' );

	gui.add( params, 'wireframe' );
	gui.add( params, 'displayHelper' );
	gui.add( params, 'helperDepth', 1, 30, 1 ).onChange( v => {

		helper.depth = v;
		helper.update();

	} );
	gui.open();

	let startX = - Infinity;
	let startY = - Infinity;

	let prevX = - Infinity;
	let prevY = - Infinity;

	const tempVec0 = new THREE.Vector2();
	const tempVec1 = new THREE.Vector2();
	const tempVec2 = new THREE.Vector2();
	renderer.domElement.addEventListener( 'pointerdown', e => {

		prevX = e.clientX;
		prevY = e.clientY;
		startX = ( e.clientX / window.innerWidth ) * 2 - 1;
		startY = - ( ( e.clientY / window.innerHeight ) * 2 - 1 );
		selectionPoints.length = 0;

	} );

	renderer.domElement.addEventListener( 'pointerup', () => {

		selectionShape.visible = false;

		if ( selectionPoints.length ) {

			selectionNeedsUpdate = true;

		}

	} );

	renderer.domElement.addEventListener( 'pointermove', e => {

		if ( ( 1 & e.buttons ) === 0 ) {

			return;

		}

		const ex = e.clientX;
		const ey = e.clientY;

		const nx = ( e.clientX / window.innerWidth ) * 2 - 1;
		const ny = - ( ( e.clientY / window.innerHeight ) * 2 - 1 );

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
			if ( params.liveUpdate ) {

				selectionNeedsUpdate = true;

			}

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

				if ( params.liveUpdate ) {

					selectionNeedsUpdate = true;

				}

			}

		}

	} );

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

}

function pointRayCrossesLine( point, line, prevDirection, thisDirection ) {

	const { start, end } = line;
	const px = point.x;
	const py = point.y;

	const sy = start.y;
	const ey = end.y;

	if ( sy === ey ) return false;

	if ( py > sy && py > ey ) return false; // above
	if ( py < sy && py < ey ) return false; // below

	const sx = start.x;
	const ex = end.x;
	if ( px > sx && px > ex ) return false; // right
	if ( px < sx && px < ex ) { // left

		if ( py === sy && prevDirection !== thisDirection ) {

			return false;

		}

		return true;

	}

	// check the side
	const dx = ex - sx;
	const dy = ey - sy;
	const perpx = dy;
	const perpy = - dx;

	const pdx = px - sx;
	const pdy = py - sy;

	const dot = perpx * pdx + perpy * pdy;

	if ( Math.sign( dot ) !== Math.sign( perpx ) ) {

		return true;

	}

	return false;

}

function pointRayCrossesSegments( point, segments ) {

	let crossings = 0;
	const firstSeg = segments[ segments.length - 1 ];
	let prevDirection = firstSeg.start.y > firstSeg.end.y;
	for ( let s = 0, l = segments.length; s < l; s ++ ) {

		const line = segments[ s ];
		const thisDirection = line.start.y > line.end.y;
		if ( pointRayCrossesLine( point, line, prevDirection, thisDirection ) ) {

			crossings ++;

		}

		prevDirection = thisDirection;

	}

	return crossings;

}

function lineCrossesLine( l1, l2 ) {

	// https://stackoverflow.com/questions/3838329/how-can-i-check-if-two-segments-intersect
	function ccw( A, B, C ) {

		return ( C.y - A.y ) * ( B.x - A.x ) > ( B.y - A.y ) * ( C.x - A.x );

	}

	const A = l1.start;
	const B = l1.end;

	const C = l2.start;
	const D = l2.end;

	return ccw( A, C, D ) !== ccw( B, C, D ) && ccw( A, B, C ) !== ccw( A, B, D );

}

function render() {

	stats.update();
	requestAnimationFrame( render );

	mesh.material.wireframe = params.wireframe;
	helper.visible = params.displayHelper;

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

		selectionNeedsUpdate = false;
		tempMatrix
			.copy( mesh.matrixWorld )
			.premultiply( camera.matrixWorldInverse )
			.premultiply( camera.projectionMatrix );

		const boxPoints = new Array( 8 ).fill().map( () => new THREE.Vector4() );
		const boxLines = new Array( 12 ).fill().map( () => new THREE.Line3() );
		const segmentLines = new Array( selectionPoints.length ).fill().map( () => new THREE.Line3() );
		for ( let s = 0, l = selectionPoints.length; s < l; s += 3 ) {

			const line = segmentLines[ s ];
			const sNext = ( s + 3 ) % l;
			line.start.x = selectionPoints[ s ];
			line.start.y = selectionPoints[ s + 1 ];

			line.end.x = selectionPoints[ sNext ];
			line.end.y = selectionPoints[ sNext + 1 ];

		}

		const squarePoints = new Array( 4 ).fill().map( () => new THREE.Vector3() );
		const squareLines = new Array( 4 ).fill().map( () => new THREE.Line3() );

		const minVec = new THREE.Vector3();
		const maxVec = new THREE.Vector3();

		const startTime = window.performance.now();
		const indices = [];
		mesh.geometry.boundsTree.shapecast(
			mesh,
			box => {

				if ( ! params.useBoundsTree ) {

					return INTERSECTED;

				}

				// TODO: get the min and max bounds
				minVec.setScalar( Infinity );
				maxVec.setScalar( - Infinity );

				const { min, max } = box;
				let i = 0;
				for ( let x = 0; x <= 1; x ++ ) { // 4 stride

					for ( let y = 0; y <= 1; y ++ ) { // 2 stride

						for ( let z = 0; z <= 1; z ++ ) { // 1 stride

							const v = boxPoints[ i ];
							v.x = x === 0 ? min.x : max.x;
							v.y = y === 0 ? min.y : max.y;
							v.z = z === 0 ? min.z : max.z;
							v.w = 1;
							v.applyMatrix4( tempMatrix );
							v.multiplyScalar( 1 / v.w );
							i ++;

							minVec.x = minVec.x > v.x ? v.x : minVec.x;
							maxVec.x = maxVec.x < v.x ? v.x : maxVec.x;

							minVec.y = minVec.y > v.y ? v.y : minVec.y;
							maxVec.y = maxVec.y < v.y ? v.y : maxVec.y;

						}

					}

				}

				squarePoints[ 0 ].set( minVec.x, minVec.y );
				squarePoints[ 1 ].set( maxVec.x, minVec.y );
				squarePoints[ 2 ].set( maxVec.x, maxVec.y );
				squarePoints[ 3 ].set( minVec.x, maxVec.y );

				// check if the screen space bb is in the lasso
				let crossings = 0;
				for ( let p = 0; p < 4; p ++ ) {

					const v = squarePoints[ p ];
					const pCrossings = pointRayCrossesSegments( v, segmentLines );

					if ( p === 0 ) {

						crossings = pCrossings;

					}

					if ( crossings !== pCrossings ) {

						return INTERSECTED;

					}

				}

				const sPoint = segmentLines[ 0 ].start;
				if (
					sPoint.x < maxVec.x && sPoint.x > minVec.x &&
					sPoint.y < maxVec.y && sPoint.y > minVec.y
				) {

					return INTERSECTED;

				}

				// TODO: it would be best to use a convex hull out of the points here instead of using a square
				// because if we use a square we can never return CONTAINED.
				squareLines[ 0 ].start.copy( squarePoints[ 0 ] );
				squareLines[ 0 ].end.copy( squarePoints[ 1 ] );

				squareLines[ 1 ].start.copy( squarePoints[ 1 ] );
				squareLines[ 1 ].end.copy( squarePoints[ 2 ] );

				squareLines[ 2 ].start.copy( squarePoints[ 2 ] );
				squareLines[ 2 ].end.copy( squarePoints[ 3 ] );

				squareLines[ 3 ].start.copy( squarePoints[ 3 ] );
				squareLines[ 3 ].end.copy( squarePoints[ 0 ] );

				for ( let li = 0, l = squareLines.length; li < l; li ++ ) {

					const boxLine = squareLines[ li ];
					for ( let s = 0, ls = segmentLines.length; s < ls; s ++ ) {

						if ( lineCrossesLine( boxLine, segmentLines[ s ] ) ) {

							return INTERSECTED;

						}

					}

				}

				return crossings % 2 === 0 ? NOT_INTERSECTED : INTERSECTED;

				// X lines
				// -X>+X -Y -Z
				boxLines[ 0 ].start.copy( boxPoints[ 0 ] );
				boxLines[ 0 ].end.copy( boxPoints[ 4 ] );

				// -X>+X -Y +Z
				boxLines[ 1 ].start.copy( boxPoints[ 1 ] );
				boxLines[ 1 ].end.copy( boxPoints[ 5 ] );

				// -X>+X +Y -Z
				boxLines[ 2 ].start.copy( boxPoints[ 2 ] );
				boxLines[ 2 ].end.copy( boxPoints[ 6 ] );

				// -X>+X +Y +Z
				boxLines[ 3 ].start.copy( boxPoints[ 3 ] );
				boxLines[ 3 ].end.copy( boxPoints[ 7 ] );


				// Y lines
				// -X -Y>+Y -Z
				boxLines[ 4 ].start.copy( boxPoints[ 0 ] );
				boxLines[ 4 ].end.copy( boxPoints[ 2 ] );

				// +X -Y>+Y -Z
				boxLines[ 5 ].start.copy( boxPoints[ 4 ] );
				boxLines[ 5 ].end.copy( boxPoints[ 6 ] );

				// -X -Y>+Y +Z
				boxLines[ 6 ].start.copy( boxPoints[ 1 ] );
				boxLines[ 6 ].end.copy( boxPoints[ 3 ] );

				// +X -Y>+Y +Z
				boxLines[ 7 ].start.copy( boxPoints[ 5 ] );
				boxLines[ 7 ].end.copy( boxPoints[ 7 ] );


				// Z lines
				// -X -Y -Z>+Z
				boxLines[ 8 ].start.copy( boxPoints[ 0 ] );
				boxLines[ 8 ].end.copy( boxPoints[ 1 ] );

				// +X -Y -Z>+Z
				boxLines[ 9 ].start.copy( boxPoints[ 4 ] );
				boxLines[ 9 ].end.copy( boxPoints[ 5 ] );

				// -X +Y -Z>+Z
				boxLines[ 10 ].start.copy( boxPoints[ 2 ] );
				boxLines[ 10 ].end.copy( boxPoints[ 3 ] );

				// +X +Y -Z>+Z
				boxLines[ 11 ].start.copy( boxPoints[ 5 ] );
				boxLines[ 11 ].end.copy( boxPoints[ 6 ] );

				for ( let li = 0, l = boxLines.length; li < l; li ++ ) {

					const boxLine = boxLines[ li ];
					for ( let s = 0, ls = segmentLines.length; s < ls; s ++ ) {

						if ( lineCrossesLine( boxLine, segmentLines[ s ] ) ) {

							return INTERSECTED;

						}

					}

				}

				return crossings % 2 === 0 ? NOT_INTERSECTED : INTERSECTED;

			},
			( tri, a, b, c, contained ) => {

				if ( contained ) {

					indices.push( a, b, c );
					return false;

				}

				if ( params.selectionMode === 'centroid' ) {

					const centroid = tri.a.add( tri.b ).add( tri.c ).multiplyScalar( 1 / 3 );
					centroid.applyMatrix4( tempMatrix );

					const crossings = pointRayCrossesSegments( centroid, segmentLines );
					if ( crossings % 2 === 1 ) {

						indices.push( a, b, c );

					}

					return false;

				} else if ( params.selectionMode === 'intersection' ) {

					const vecs = [ tri.a, tri.b, tri.c ];

					for ( let j = 0; j < 3; j ++ ) {

						const v = vecs[ j ];
						v.applyMatrix4( tempMatrix );

						const crossings = pointRayCrossesSegments( v, segmentLines );
						if ( crossings % 2 === 1 ) {

							indices.push( a, b, c );
							return false;

						}

					}

					const lines = new Array( 3 ).fill().map( () => new THREE.Line3() );

					lines[ 0 ].start.copy( tri.a );
					lines[ 0 ].end.copy( tri.b );

					lines[ 1 ].start.copy( tri.b );
					lines[ 1 ].end.copy( tri.c );

					lines[ 2 ].start.copy( tri.c );
					lines[ 2 ].end.copy( tri.a );

					for ( let i = 0; i < 3; i ++ ) {

						const l = lines[ i ];
						for ( let s = 0, sl = segmentLines.length; s < sl; s ++ ) {

							if ( lineCrossesLine( l, segmentLines[ s ] ) ) {

								indices.push( a, b, c );
								return false;

							}

						}

					}

				}

			}
		);

		const traverseTime = window.performance.now() - startTime;
		outputContainer.innerText = `${ traverseTime.toFixed( 3 ) }ms`;

		const indexAttr = mesh.geometry.index;
		const newIndexAttr = highlightMesh.geometry.index;
		for ( let i = 0, l = indices.length; i < l; i ++ ) {

			const i2 = indexAttr.getX( indices[ i ] );
			newIndexAttr.setX( i, i2 );

		}

		highlightMesh.geometry.drawRange.count = indices.length;
		newIndexAttr.needsUpdate = true;

	}

	const yScale = Math.tan( THREE.MathUtils.DEG2RAD * camera.fov / 2 ) * selectionShape.position.z;
	selectionShape.scale.set( - yScale * camera.aspect, - yScale, 1 );

	renderer.render( scene, camera );

}
