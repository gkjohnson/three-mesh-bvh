import * as THREE from 'three';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshBVH } from '..';
import {
	generateEdges,
	isLineAboveTriangle,
	isProjectedTriangleDegenerate,
	isLineTriangleEdge,
	trimToBeneathTriPlane,
	edgesToGeometry,
	overlapsToLines,
	getProjectedOverlaps,
} from './utils/edgeUtils.js';
import { mergeBufferGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const params = {

};

let renderer, camera, scene, model, gui, helper, controls;
let bvh;

init();

async function init() {

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

	const light = new THREE.DirectionalLight( 0xffffff, 1 );
	light.position.set( 1, 2, 3 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xb0bec5, 0.8 ) );

	const gltf = await new GLTFLoader().loadAsync( new URL( './models/tables_and_chairs.gltf', import.meta.url ).toString() );
	const mergedGeom = mergeBufferGeometries( gltf.scene.children[ 0 ].children.map( c => c.geometry ) );
	model = new THREE.Mesh( mergedGeom, new THREE.MeshStandardMaterial() );
	model.geometry.center();
	scene.add( model );

	bvh = new MeshBVH( model.geometry );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.01, 100 );
	camera.position.set( 0, 0, 4 );
	camera.updateProjectionMatrix();

	controls = new OrbitControls( camera, renderer.domElement );

	gui = new GUI();

	console.time( 'TEST' );
	updateEdges();
	console.timeEnd( 'TEST' );

	// scene.add( new THREE.LineSegments( new THREE.EdgesGeometry( model.geometry ), new THREE.LineBasicMaterial( { color: 0 } ) ) );


	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

	// scene.add( new THREE.AxesHelper ())
	render();

}

function updateEdges() {

	console.time( 'generate edges' );
	const edges = generateEdges( model.geometry, new THREE.Vector3( 0, 1, 0 ), 50 );
	console.timeEnd( 'generate edges' );

	const finalEdges = [];
	const tempLine = new THREE.Line3();
	const tempRay = new THREE.Ray();
	const tempVec = new THREE.Vector3();

	// TODO: iterate over all edges and check visibility upwards using BVH
	for ( let i = 0, l = edges.length; i < l; i ++ ) {

		const line = edges[ i ];
		const lowestLineY = Math.min( line.start.y, line.end.y );
		const overlaps = [];
		bvh.shapecast( {

			intersectsBounds: box => {

				// check if the box bounds are above the lowest line point
				box.min.y = Math.min( lowestLineY, box.min.y );
				tempRay.origin.copy( line.start );
				line.delta( tempRay.direction ).normalize();

				if ( box.containsPoint( tempRay.origin ) ) {

					return true;

				}

				if ( tempRay.intersectBox( box, tempVec ) ) {

					return tempRay.origin.distanceToSquared( tempVec ) < line.distanceSq();

				}

				return false;

			},

			intersectsTriangle: tri => {

				// skip the triangle if it is completely below the line
				const highestTriangleY = Math.max( tri.a.y, tri.b.y, tri.c.y );

				if ( highestTriangleY < lowestLineY ) {

					return false;

				}

				if ( isProjectedTriangleDegenerate( tri ) ) {

					return false;

				}

				if ( isLineTriangleEdge( tri, line ) ) {

					return false;

				}

				trimToBeneathTriPlane( tri, line, tempLine );

				if ( isLineAboveTriangle( tri, tempLine ) ) {

					return false;

				}

				if ( tempLine.distance() < 1e-10 ) {

					return false;

				}

				getProjectedOverlaps( tri, tempLine, overlaps );
				return false;

			},

		} );

		overlapsToLines( line, overlaps, finalEdges );

	}

	console.time( 'generate geometry' );
	scene.add( edgesToGeometry( finalEdges, - 2 ) );
	console.timeEnd( 'generate geometry' );

}


function render() {

	requestAnimationFrame( render );

	if ( helper ) {

		helper.visible = params.displayHelper;

	}

	renderer.render( scene, camera );

}
