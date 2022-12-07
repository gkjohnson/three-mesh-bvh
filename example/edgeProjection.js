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
	isYProjectedLineDegenerate,
	compressEdgeOverlaps,
} from './utils/edgeUtils.js';
import { mergeBufferGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const params = {
	displayModel: 'color',
	displayEdges: false,
	displayProjection: true,
	useBVH: true,
	sortEdges: true,
	rotate: () => {

		group.quaternion.random();
		group.position.set( 0, 0, 0 );
		group.updateMatrixWorld( true );

		const box = new THREE.Box3();
		box.setFromObject( model, true );
		box.getCenter( group.position ).multiplyScalar( - 1 );
		group.position.y = Math.max( 0, - box.min.y ) + 1;

	},
	regenerate: () => {

		task = updateEdges();

	},
};

let renderer, camera, scene, gui, controls;
let lines, model, projection, group, whiteModel;
let outputContainer;
let task = null;

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

	// lights
	const light = new THREE.DirectionalLight( 0xffffff, 1 );
	light.position.set( 1, 2, 3 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xb0bec5, 0.25 ) );

	// load model
	group = new THREE.Group();
	scene.add( group );

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

	const gltf = await new GLTFLoader().setMeshoptDecoder( MeshoptDecoder ).loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/nasa-m2020/Perseverance.glb' );
	model = gltf.scene;

	const whiteMaterial = new THREE.MeshStandardMaterial();
	whiteModel = model.clone();
	whiteModel.traverse( c => {

		if ( c.material ) {

			c.material = whiteMaterial;

		}

	} );

	group.updateMatrixWorld( true );

	// center model
	const box = new THREE.Box3();
	box.setFromObject( model, true );
	box.getCenter( group.position ).multiplyScalar( - 1 );
	group.position.y = Math.max( 0, - box.min.y ) + 1;
	group.add( model, whiteModel );

	// generate geometry line segments
	lines = new THREE.Group();
	model.traverse( c => {

		if ( c.geometry ) {

			const geomLines = new THREE.LineSegments( new THREE.EdgesGeometry( c.geometry, 50 ), new THREE.LineBasicMaterial( { color: 0x030303 } ) );
			geomLines.position.copy( c.position );
			geomLines.quaternion.copy( c.quaternion );
			geomLines.scale.copy( c.scale );
			lines.add( geomLines );

		}

	} );
	group.add( lines );

	// create projection display mesh
	projection = new THREE.LineSegments( new THREE.BufferGeometry(), new THREE.LineBasicMaterial( { color: 0x030303 } ) );
	scene.add( projection );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.01, 100 );
	camera.position.setScalar( 3.5 );
	camera.updateProjectionMatrix();

	controls = new OrbitControls( camera, renderer.domElement );

	gui = new GUI();
	gui.add( params, 'displayModel', [ 'none', 'color', 'white' ] );
	gui.add( params, 'displayEdges' );
	gui.add( params, 'displayProjection' );
	gui.add( params, 'useBVH' );
	gui.add( params, 'sortEdges' );
	gui.add( params, 'rotate' );
	gui.add( params, 'regenerate' );

	task = updateEdges();

	render();

}

function* updateEdges( runTime = 30 ) {

	outputContainer.innerText = 'processing: --';
	scene.remove( projection );

	// transform and merge geometries to project into a single model
	let timeStart = window.performance.now();
	const geometries = [];
	model.updateWorldMatrix( true, true );
	model.traverse( c => {

		if ( c.geometry ) {

			const clone = c.geometry.clone();
			clone.applyMatrix4( c.matrixWorld );
			for ( const key in clone.attributes ) {

				if ( key !== 'position' ) {

					clone.deleteAttribute( key );

				}

			}

			geometries.push( clone );

		}

	} );
	const mergedGeometry = mergeBufferGeometries( geometries, false );
	const mergeTime = window.performance.now() - timeStart;

	yield;

	// generate the bvh for acceleration
	timeStart = window.performance.now();
	const bvh = new MeshBVH( mergedGeometry );
	const bvhTime = window.performance.now() - timeStart;

	yield;

	// generate the candidate edges
	timeStart = window.performance.now();
	const edges = generateEdges( mergedGeometry, new THREE.Vector3( 0, 1, 0 ), 50 );

	if ( params.sortEdges ) {

		edges.sort( ( a, b ) => {

			return Math.min( a.start.y, a.end.y ) - Math.min( b.start.y, b.end.y );

		} );

	}

	const edgeGenerateTime = window.performance.now() - timeStart;

	yield;

	scene.add( projection );

	// trim the candidate edges
	const finalEdges = [];
	const tempLine = new THREE.Line3();
	const tempRay = new THREE.Ray();
	const tempVec = new THREE.Vector3();

	timeStart = window.performance.now();
	let trimTime = 0;
	for ( let i = 0, l = edges.length; i < l; i ++ ) {

		const line = edges[ i ];
		if ( isYProjectedLineDegenerate( line ) ) {

			continue;

		}

		const lowestLineY = Math.min( line.start.y, line.end.y );
		const overlaps = [];
		bvh.shapecast( {

			intersectsBounds: box => {

				if ( ! params.useBVH ) {

					return true;

				}

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

				// if the projected triangle is just a line then don't check it
				if ( isYProjectedTriangleDegenerate( tri ) ) {

					return false;

				}

				// if this line lies on a triangle edge then don't check it
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

				// compress the edge overlaps so we can easily tell if the whole edge is hidden already
				// and exit early
				if ( getProjectedOverlaps( tri, line, overlaps ) ) {

					compressEdgeOverlaps( overlaps );

				}

				// if we're hiding the edge entirely now then skip further checks
				if ( overlaps.length !== 0 ) {

					const [ d0, d1 ] = overlaps[ overlaps.length - 1 ];
					return d0 === 0.0 && d1 === 1.0;

				}

				return false;

			},

		} );

		overlapsToLines( line, overlaps, finalEdges );

		const delta = window.performance.now() - timeStart;
		if ( delta > runTime ) {

			outputContainer.innerText = `processing: ${ ( 100 * i / edges.length ).toFixed( 2 ) }%`;
			trimTime += delta;

			projection.geometry.dispose();
			projection.geometry = edgesToGeometry( finalEdges, 0 );
			yield;
			timeStart = window.performance.now();

		}

	}

	projection.geometry.dispose();
	projection.geometry = edgesToGeometry( finalEdges, 0 );
	trimTime += window.performance.now() - timeStart;

	outputContainer.innerText =
		`merge geometry  : ${ mergeTime.toFixed( 2 ) }ms\n` +
		`bvh generation  : ${ bvhTime.toFixed( 2 ) }ms\n` +
		`edge generation : ${ edgeGenerateTime.toFixed( 2 ) }ms\n` +
		`edge trimming   : ${ trimTime.toFixed( 2 ) }ms\n\n` +
		`total time      : ${ ( mergeTime + bvhTime + edgeGenerateTime + trimTime ).toFixed( 2 ) }ms\n` +
		`total edges     : ${ finalEdges.length } edges`;

}


function render() {

	requestAnimationFrame( render );

	if ( task ) {

		const res = task.next();
		if ( res.done ) {

			task = null;

		}

	}

	model.visible = params.displayModel === 'color';
	whiteModel.visible = params.displayModel === 'white';
	lines.visible = params.displayEdges;
	projection.visible = params.displayProjection;

	renderer.render( scene, camera );

}
