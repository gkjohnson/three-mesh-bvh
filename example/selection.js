import * as THREE from 'three';
import Stats from 'stats.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
	MeshBVHVisualizer,
	MeshBVH,
	CONTAINED,
	INTERSECTED,
	NOT_INTERSECTED,
} from '..';

const params = {

	toolMode: 'lasso',
	selectionMode: 'intersection',
	liveUpdate: false,
	selectModel: false,
	wireframe: false,
	useBoundsTree: true,

	displayHelper: false,
	helperDepth: 10,
	rotate: true,

};

let renderer, camera, scene, gui, stats, controls, selectionShape, mesh, helper;
let highlightMesh, highlightWireframeMesh, outputContainer, group;
const selectionPoints = [];
let dragging = false;
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
	renderer.shadowMap.enabled = true;
	renderer.outputEncoding = THREE.sRGBEncoding;
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();

	const light = new THREE.DirectionalLight( 0xffffff, 1 );
	light.castShadow = true;
	light.shadow.mapSize.set( 2048, 2048 );
	light.position.set( 10, 10, 10 );
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

	helper = new MeshBVHVisualizer( mesh, 10 );
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
	highlightMesh.material.color.set( 0xff9800 ).convertSRGBToLinear();
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
		new THREE.PlaneBufferGeometry(),
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
	selectionFolder.add( params, 'toolMode', [ 'lasso', 'box' ] );
	selectionFolder.add( params, 'selectionMode', [ 'centroid', 'centroid-visible', 'intersection' ] );
	selectionFolder.add( params, 'selectModel' );
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

	// handle building lasso shape
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
		dragging = true;

	} );

	renderer.domElement.addEventListener( 'pointerup', () => {

		selectionShape.visible = false;
		dragging = false;
		if ( selectionPoints.length ) {

			selectionNeedsUpdate = true;

		}

	} );

	renderer.domElement.addEventListener( 'pointermove', e => {

		// If the left mouse button is not pressed
		if ( ( 1 & e.buttons ) === 0 ) {

			return;

		}

		const ex = e.clientX;
		const ey = e.clientY;

		const nx = ( e.clientX / window.innerWidth ) * 2 - 1;
		const ny = - ( ( e.clientY / window.innerHeight ) * 2 - 1 );

		if ( params.toolMode === 'box' ) {

			// set points for the corner of the box
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

			// If the mouse hasn't moved a lot since the last point
			if (
				Math.abs( ex - prevX ) >= 3 ||
				Math.abs( ey - prevY ) >= 3
			) {

				// Check if the mouse moved in roughly the same direction as the previous point
				// and replace it if so.
				const i = ( selectionPoints.length / 3 ) - 1;
				const i3 = i * 3;
				let doReplace = false;
				if ( selectionPoints.length > 3 ) {

					// prev segment direction
					tempVec0.set( selectionPoints[ i3 - 3 ], selectionPoints[ i3 - 3 + 1 ] );
					tempVec1.set( selectionPoints[ i3 ], selectionPoints[ i3 + 1 ] );
					tempVec1.sub( tempVec0 ).normalize();

					// this segment direction
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

function render() {

	stats.update();
	requestAnimationFrame( render );

	mesh.material.wireframe = params.wireframe;
	helper.visible = params.displayHelper;

	// Update the selection lasso lines
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

		if ( selectionPoints.length > 0 ) {

			updateSelection();

		}

	}

	const yScale = Math.tan( THREE.MathUtils.DEG2RAD * camera.fov / 2 ) * selectionShape.position.z;
	selectionShape.scale.set( - yScale * camera.aspect, - yScale, 1 );

	renderer.render( scene, camera );

	if ( params.rotate ) {

		group.rotation.y += 0.01;
		if ( params.liveUpdate && dragging ) {

			selectionNeedsUpdate = true;

		}

	}

}

const invWorldMatrix = new THREE.Matrix4();
const camLocalPosition = new THREE.Vector3();
const tempRay = new THREE.Ray();
const centroid = new THREE.Vector3();
const screenCentroid = new THREE.Vector3();
const faceNormal = new THREE.Vector3();
const toScreenSpaceMatrix = new THREE.Matrix4();
const boxPoints = new Array( 8 ).fill().map( () => new THREE.Vector3() );
const boxLines = new Array( 12 ).fill().map( () => new THREE.Line3() );
const lassoSegments = [];
const perBoundsSegments = [];
function updateSelection() {

	// TODO: Possible improvements
	// - Correctly handle the camera near clip
	// - Improve line line intersect performance?

	toScreenSpaceMatrix
		.copy( mesh.matrixWorld )
		.premultiply( camera.matrixWorldInverse )
		.premultiply( camera.projectionMatrix );

	// create scratch points and lines to use for selection
	while ( lassoSegments.length < selectionPoints.length ) {

		lassoSegments.push( new THREE.Line3() );

	}

	lassoSegments.length = selectionPoints.length;

	for ( let s = 0, l = selectionPoints.length; s < l; s += 3 ) {

		const line = lassoSegments[ s ];
		const sNext = ( s + 3 ) % l;
		line.start.x = selectionPoints[ s ];
		line.start.y = selectionPoints[ s + 1 ];

		line.end.x = selectionPoints[ sNext ];
		line.end.y = selectionPoints[ sNext + 1 ];

	}

	invWorldMatrix.copy( mesh.matrixWorld ).invert();
	camLocalPosition.set( 0, 0, 0 ).applyMatrix4( camera.matrixWorld ).applyMatrix4( invWorldMatrix );

	const startTime = window.performance.now();
	const indices = [];
	mesh.geometry.boundsTree.shapecast( {
		intersectsBounds: ( box, isLeaf, score, depth ) => {

			// check if bounds intersect or contain the lasso region
			if ( ! params.useBoundsTree ) {

				return INTERSECTED;

			}

			// Get the bounding box points
			const { min, max } = box;
			let index = 0;

			let minY = Infinity;
			let maxY = - Infinity;
			let minX = Infinity;
			for ( let x = 0; x <= 1; x ++ ) {

				for ( let y = 0; y <= 1; y ++ ) {

					for ( let z = 0; z <= 1; z ++ ) {

						const v = boxPoints[ index ];
						v.x = x === 0 ? min.x : max.x;
						v.y = y === 0 ? min.y : max.y;
						v.z = z === 0 ? min.z : max.z;
						v.w = 1;
						v.applyMatrix4( toScreenSpaceMatrix );
						index ++;

						if ( v.y < minY ) minY = v.y;
						if ( v.y > maxY ) maxY = v.y;
						if ( v.x < minX ) minX = v.x;

					}

				}

			}

			// Find all the relevant segments here and cache them in the above array for
			// subsequent child checks to use.
			const parentSegments = perBoundsSegments[ depth - 1 ] || lassoSegments;
			const segmentsToCheck = perBoundsSegments[ depth ] || [];
			segmentsToCheck.length = 0;
			perBoundsSegments[ depth ] = segmentsToCheck;
			for ( let i = 0, l = parentSegments.length; i < l; i ++ ) {

				const line = parentSegments[ i ];
				const sx = line.start.x;
				const sy = line.start.y;
				const ex = line.end.x;
				const ey = line.end.y;
				if ( sx < minX && ex < minX ) continue;

				const startAbove = sy > maxY;
				const endAbove = ey > maxY;
				if ( startAbove && endAbove ) continue;

				const startBelow = sy < minY;
				const endBelow = ey < minY;
				if ( startBelow && endBelow ) continue;

				segmentsToCheck.push( line );

			}

			if ( segmentsToCheck.length === 0 ) {

				return NOT_INTERSECTED;

			}

			// Get the screen space hull lines
			const hull = getConvexHull( boxPoints );
			const lines = hull.map( ( p, i ) => {

				const nextP = hull[ ( i + 1 ) % hull.length ];
				const line = boxLines[ i ];
				line.start.copy( p );
				line.end.copy( nextP );
				return line;

			} );

			// If a lasso point is inside the hull then it's intersected and cannot be contained
			if ( pointRayCrossesSegments( segmentsToCheck[ 0 ].start, lines ) % 2 === 1 ) {

				return INTERSECTED;

			}

			// check if the screen space hull is in the lasso
			let crossings = 0;
			for ( let i = 0, l = hull.length; i < l; i ++ ) {

				const v = hull[ i ];
				const pCrossings = pointRayCrossesSegments( v, segmentsToCheck );

				if ( i === 0 ) {

					crossings = pCrossings;

				}

				// if two points on the hull have different amounts of crossings then
				// it can only be intersected
				if ( crossings !== pCrossings ) {

					return INTERSECTED;

				}

			}

			// check if there are any intersections
			for ( let i = 0, l = lines.length; i < l; i ++ ) {

				const boxLine = lines[ i ];
				for ( let s = 0, ls = segmentsToCheck.length; s < ls; s ++ ) {

					if ( lineCrossesLine( boxLine, segmentsToCheck[ s ] ) ) {

						return INTERSECTED;

					}

				}

			}

			return crossings % 2 === 0 ? NOT_INTERSECTED : CONTAINED;

		},

		intersectsTriangle: ( tri, index, contained, depth ) => {

			const i3 = index * 3;
			const a = i3 + 0;
			const b = i3 + 1;
			const c = i3 + 2;

			// check all the segments if using no bounds tree
			const segmentsToCheck = params.useBoundsTree ? perBoundsSegments[ depth ] : lassoSegments;
			if ( params.selectionMode === 'centroid' || params.selectionMode === 'centroid-visible' ) {

				// get the center of the triangle
				centroid.copy( tri.a ).add( tri.b ).add( tri.c ).multiplyScalar( 1 / 3 );
				screenCentroid.copy( centroid ).applyMatrix4( toScreenSpaceMatrix );

				// counting the crossings
				if (
					contained ||
					pointRayCrossesSegments( screenCentroid, segmentsToCheck ) % 2 === 1
				) {

					// if we're only selecting visible faces then perform a ray check to ensure the centroid
					// is visible.
					if ( params.selectionMode === 'centroid-visible' ) {

						tri.getNormal( faceNormal );
						tempRay.origin.copy( centroid ).addScaledVector( faceNormal, 1e-6 );
						tempRay.direction.subVectors( camLocalPosition, centroid );

						const res = mesh.geometry.boundsTree.raycastFirst( tempRay, THREE.DoubleSide );
						if ( res ) {

							return false;

						}

					}

					indices.push( a, b, c );
					return params.selectModel;

				}

			} else if ( params.selectionMode === 'intersection' ) {

				// if the parent bounds were marked as contained then we contain all the triangles within
				if ( contained ) {

					indices.push( a, b, c );
					return params.selectModel;

				}

				// get the projected vertices
				const vertices = [
					tri.a,
					tri.b,
					tri.c,
				];

				// check if any of the vertices are inside the selection and if so then the triangle is selected
				for ( let j = 0; j < 3; j ++ ) {

					const v = vertices[ j ];
					v.applyMatrix4( toScreenSpaceMatrix );

					const crossings = pointRayCrossesSegments( v, segmentsToCheck );
					if ( crossings % 2 === 1 ) {

						indices.push( a, b, c );
						return params.selectModel;

					}

				}

				// get the lines for the triangle
				const lines = [
					boxLines[ 0 ],
					boxLines[ 1 ],
					boxLines[ 2 ],
				];

				lines[ 0 ].start.copy( tri.a );
				lines[ 0 ].end.copy( tri.b );

				lines[ 1 ].start.copy( tri.b );
				lines[ 1 ].end.copy( tri.c );

				lines[ 2 ].start.copy( tri.c );
				lines[ 2 ].end.copy( tri.a );

				// check for the case where a selection intersects a triangle but does not contain any
				// of the vertices
				for ( let i = 0; i < 3; i ++ ) {

					const l = lines[ i ];
					for ( let s = 0, sl = segmentsToCheck.length; s < sl; s ++ ) {

						if ( lineCrossesLine( l, segmentsToCheck[ s ] ) ) {

							indices.push( a, b, c );
							return params.selectModel;

						}

					}

				}

			}

			return false;

		}

	} );

	const traverseTime = window.performance.now() - startTime;
	outputContainer.innerText = `${ traverseTime.toFixed( 3 ) }ms`;

	const indexAttr = mesh.geometry.index;
	const newIndexAttr = highlightMesh.geometry.index;
	if ( indices.length && params.selectModel ) {

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

// Math Functions
// https://www.geeksforgeeks.org/convex-hull-set-2-graham-scan/
function getConvexHull( points ) {

	function orientation( p, q, r ) {

		const val =
			( q.y - p.y ) * ( r.x - q.x ) -
			( q.x - p.x ) * ( r.y - q.y );

		if ( val == 0 ) {

			return 0; // colinear

		}

		// clockwise or counterclockwise
		return ( val > 0 ) ? 1 : 2;

	}

	function distSq( p1, p2 ) {

		return ( p1.x - p2.x ) * ( p1.x - p2.x ) +
			( p1.y - p2.y ) * ( p1.y - p2.y );

	}

	function compare( p1, p2 ) {

	   // Find orientation
	   const o = orientation( p0, p1, p2 );
	   if ( o == 0 )
		 return ( distSq( p0, p2 ) >= distSq( p0, p1 ) ) ? - 1 : 1;

	   return ( o == 2 ) ? - 1 : 1;

	}

	// find the lowest point in 2d
	let lowestY = Infinity;
	let lowestIndex = - 1;
	for ( let i = 0, l = points.length; i < l; i ++ ) {

		const p = points[ i ];
		if ( p.y < lowestY ) {

			lowestIndex = i;
			lowestY = p.y;

		}

	}

	// sort the points
	const p0 = points[ lowestIndex ];
	points[ lowestIndex ] = points[ 0 ];
	points[ 0 ] = p0;

	points = points.sort( compare );

	// filter the points
	let m = 1;
	const n = points.length;
	for ( let i = 1; i < n; i ++ ) {

		while ( i < n - 1 && orientation( p0, points[ i ], points[ i + 1 ] ) == 0 ) {

			i ++;

		}

		points[ m ] = points[ i ];
		m ++;

	}

	// early out if we don't have enough points for a hull
	if ( m < 3 ) return null;

	// generate the hull
	const hull = [ points[ 0 ], points[ 1 ], points[ 2 ] ];
	for ( let i = 3; i < m; i ++ ) {

		while ( orientation( hull[ hull.length - 2 ], hull[ hull.length - 1 ], points[ i ] ) !== 2 ) {

			hull.pop();

		}

		hull.push( points[ i ] );

	}

	return hull;

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

// https://stackoverflow.com/questions/3838329/how-can-i-check-if-two-segments-intersect
function lineCrossesLine( l1, l2 ) {

	function ccw( A, B, C ) {

		return ( C.y - A.y ) * ( B.x - A.x ) > ( B.y - A.y ) * ( C.x - A.x );

	}

	const A = l1.start;
	const B = l1.end;

	const C = l2.start;
	const D = l2.end;

	return ccw( A, C, D ) !== ccw( B, C, D ) && ccw( A, B, C ) !== ccw( A, B, D );

}
