import * as THREE from 'three';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MeshBVH, ExtendedTriangle } from '..';
import { generateEdges, lineIntersectTrianglePoint } from './utils/edgeUtils.js';

const params = {

};

let renderer, camera, scene, model, clock, gui, helper, controls;
let bvh;

init();
render();

function init() {

	const bgColor = 0xeeeeee;

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.outputEncoding = THREE.sRGBEncoding;
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();
	scene.fog = new THREE.Fog( 0xffca28, 20, 60 );

	const light = new THREE.DirectionalLight( 0xffffff, 1 );
	light.position.set( 1, 1, 1 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xb0bec5, 0.8 ) );

	model = new THREE.Mesh( new THREE.TorusKnotBufferGeometry() );
	scene.add( model );

	bvh = new MeshBVH( model.geometry );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	// camera = new THREE.OrthographicCamera( - 10, 10, 10, - 10 );
	camera.position.set( 0, 0, 4 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	clock = new THREE.Clock();

	controls = new OrbitControls( camera, renderer.domElement );

	gui = new GUI();

	updateEdges();

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

}

function updateEdges() {

	const edges = generateEdges( model.geometry, new THREE.Vector3( 0, 1, 0 ), 90 );
	const tempLine = new THREE.Line3();
	const tempRay = new THREE.Ray();
	const tempVec = new THREE.Vector3();
	let target = {
		line: new THREE.Line3(),
		point: new THREE.Vector3(),
		type: '',
	};

	// TODO: iterate over all edges and check visibility upwards using BVH
	for ( let i = 0, l = edges.length; i < l; i ++ ) {

		const line = edges[ i ];
		line.start.y += 1e-5;
		line.end.y += 1e-5;

		const lowestLineY = Math.min( line.start.y, line.end.y );
		const highestLineY = Math.max( line.start.y, line.end.y );
		const overlaps = [];
		bvh.shapecast( {

			intersectsBounds: box => {

				// check if the box bounds are above the lowest line point
				box.min.y = Math.min( lowestLineY, box.min.y );
				tempRay.origin.copy( line.start );
				line.delta( tempRay.direction );

				tempRay.intersectsBox( box, tempVec );
				return line.start.distanceToSquared( tempVec ) < line.distanceSq();

			},

			intersectsTriangle: tri => {

				// skip the triangle if it is completely below the line
				const highestTriangleY = Math.max( tri.a.y, tri.b.y, tri.c.y );
				if ( highestTriangleY < lowestLineY ) {

					return false;

				}

				tempLine.copy( line );
				if ( lineIntersectTrianglePoint( tempLine, tri, target ) && target.type === 'point' ) {

					// shorten the edge to check to the line the falls below the triangle
					if ( tempLine.start.y > target.point.y ) {

						tempLine.start.copy( target.point );

					} else {

						tempLine.end.copy( target.point );

					}

				}

				// flatten them to a common plane
				tempLine.start.y = 0;
				tempLine.end.y = 0;
				tri.a.y = 0;
				tri.b.y = 0;
				tri.c.y = 0;
				tri.needsUpdate = true;

				if ( lineIntersectTrianglePoint( tempLine, tri, target ) && target.type === 'line' ) {

					// TODO:
					// - find the overlap by using directions and dot products
					// - The overlap should fall entirely on the edge we're checking

				}

			},

		} );

		// TODO: construct a final set of lines by sorting & merging the overlap lines and taking only the bits that don't overlap

	}

	const edgeArray = [];
	edges.forEach( l => {

		edgeArray.push( l.start.x, - 2, l.start.z );
		edgeArray.push( l.end.x, - 2, l.end.z );

	} );

	const edgeGeom = new THREE.BufferGeometry();
	const edgeBuffer = new THREE.BufferAttribute( new Float32Array( edgeArray ), 3, true );
	edgeGeom.setAttribute( 'position', edgeBuffer );
	scene.add( new THREE.LineSegments( edgeGeom, new THREE.LineBasicMaterial( { color: 0 } ) ) );

}

function render() {

	requestAnimationFrame( render );

	if ( helper ) {

		helper.visible = params.displayHelper;

	}

	renderer.render( scene, camera );

}
