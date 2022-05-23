import * as THREE from 'three';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshBVH } from '..';
import {
	generateEdges,
	isLineAbovePlane,
	isYProjectedTriangleDegenerate,
	isLineTriangleEdge,
	trimToBeneathTriPlane,
	edgesToGeometry,
	overlapsToLines,
	getProjectedOverlaps,
} from './utils/edgeUtils.js';
import { mergeBufferGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const params = {
	displayModel: true,
	displayEdges: false,
	displayProjection: true,
};

let renderer, camera, scene, gui, controls;
let lines, model, projection;
let outputContainer;

init();

async function init() {

	outputContainer = document.getElementById( 'output' );

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

	const group = new THREE.Group();
	scene.add( group );

	const gltf = await new GLTFLoader().loadAsync( new URL( './models/tables_and_chairs.gltf', import.meta.url ).toString() );
	model = gltf.scene;

	const box = new THREE.Box3();
	box.setFromObject( model );
	box.getCenter( group.position ).multiplyScalar( - 1 );
	group.position.y += 1;
	group.add( model );

	lines = new THREE.Group();
	model.traverse( c => {

		if ( c.geometry ) {

			const geomLines = new THREE.LineSegments( new THREE.EdgesGeometry( c.geometry, 45 ), new THREE.LineBasicMaterial( { color: 0 } ) );
			lines.add( geomLines );

		}

	} );
	group.add( lines );

	projection = new THREE.LineSegments( new THREE.BufferGeometry(), new THREE.LineBasicMaterial( { color: 0 } ) );
	scene.add( projection );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.01, 100 );
	camera.position.set( 4, 4, - 4 );
	camera.updateProjectionMatrix();

	controls = new OrbitControls( camera, renderer.domElement );

	gui = new GUI();
	gui.add( params, 'displayModel' );
	gui.add( params, 'displayEdges' );
	gui.add( params, 'displayProjection' );

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

	let timeStart = window.performance.now();
	const geometries = [];
	model.updateWorldMatrix( true, true );
	model.traverse( c => {

		if ( c.geometry ) {

			const clone = c.geometry.clone();
			clone.applyMatrix4( c.matrixWorld );
			geometries.push( clone );

		}

	} );
	const mergedGeometry = mergeBufferGeometries( geometries, false );
	const mergeTime = window.performance.now() - timeStart;

	timeStart = window.performance.now();
	const bvh = new MeshBVH( mergedGeometry );
	const bvhTime = window.performance.now() - timeStart;

	timeStart = window.performance.now();
	const edges = generateEdges( mergedGeometry, new THREE.Vector3( 0, 1, 0 ), 50 );
	const edgeGenerateTime = window.performance.now() - timeStart;

	const finalEdges = [];
	const tempLine = new THREE.Line3();
	const tempRay = new THREE.Ray();
	const tempVec = new THREE.Vector3();

	timeStart = window.performance.now();
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

				if ( isYProjectedTriangleDegenerate( tri ) ) {

					return false;

				}

				if ( isLineTriangleEdge( tri, line ) ) {

					return false;

				}

				trimToBeneathTriPlane( tri, line, tempLine );

				if ( isLineAbovePlane( tri.plane, tempLine ) ) {

					return false;

				}

				if ( tempLine.distance() < 1e-10 ) {

					return false;

				}

				getProjectedOverlaps( tri, tempLine, overlaps );

				// if we're hiding the edge entirely now then skip further checks
				if ( overlaps.length !== 0 ) {

					const [ d0, d1 ] = overlaps[ overlaps.length - 1 ];
					return d0 === 0.0 && d1 === 1.0;

				}

				return false;

			},

		} );

		overlapsToLines( line, overlaps, finalEdges );

	}

	projection.geometry.dispose();
	projection.geometry = edgesToGeometry( finalEdges, 0 );
	const trimTime = window.performance.now() - timeStart;

	outputContainer.innerText =
		`merge geometry  : ${ mergeTime.toFixed( 2 ) }ms\n` +
		`bvh generation  : ${ bvhTime.toFixed( 2 ) }ms\n` +
		`edge generation : ${ edgeGenerateTime.toFixed( 2 ) }ms\n` +
		`edge trimming   : ${ trimTime.toFixed( 2 ) }ms\n\n` +
		`total time      : ${ ( mergeTime + bvhTime + edgeGenerateTime + trimTime ).toFixed( 2 ) }ms`;

}


function render() {

	requestAnimationFrame( render );

	model.visible = params.displayModel;
	lines.visible = params.displayEdges;
	projection.visible = params.displayProjection;

	renderer.render( scene, camera );

}
