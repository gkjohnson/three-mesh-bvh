import Stats from 'stats.js/src/Stats';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import {
	acceleratedRaycast, computeBoundsTree, disposeBoundsTree, MeshBVHVisualizer, INTERSECTED, NOT_INTERSECTED,
	SAH, CENTER, AVERAGE,
} from '..';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

let stats;
let scene, camera, renderer, bvhMesh, helper, pointCloud, outputContainer;
let mouse = new THREE.Vector2();
let sphereCollision;

const plyPath = '../models/point_cloud_porsche_911_1.7M_vertices/scene.ply';
const raycaster = new THREE.Raycaster();
const params = {

	displayHelper: false,
	helperDepth: 10,
	displayParents: false,

	strategy: CENTER,
	pointSize: 0.005,
	raycastThreshold: 0.005,
	useBVH: true,

};

function init() {

	const bgColor = 0x263238 / 2;

	outputContainer = document.getElementById( 'output' );

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 3, 3, 3 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	new OrbitControls( camera, renderer.domElement );

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );


	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

	// Load point cloud
	const loader = new PLYLoader();
	loader.load( plyPath, geometry => {

		geometry.center();
		const material = new THREE.PointsMaterial( { size: params.pointSize, vertexColors: true } );
		pointCloud = new THREE.Points( geometry, material );
		pointCloud.matrixAutoUpdate = false;

		scene.add( pointCloud );

		// BVH Mesh creation
		const indices = [];
		const bvhGeometry = geometry.clone();
		let verticesLength = bvhGeometry.attributes.position.count;
		for ( let i = 0, l = verticesLength; i < l; i ++ ) {

			indices.push( i, i, i );

		}

		bvhGeometry.setIndex( indices );
		const bvhMaterial = new THREE.MeshBasicMaterial( { color: 0xff0000 } );
		bvhMesh = new THREE.Mesh( bvhGeometry, bvhMaterial );

		console.time( 'computeBoundsTree' );
		bvhMesh.geometry.computeBoundsTree( { mode: params.mode } );
		console.timeEnd( 'computeBoundsTree' );

		helper = new MeshBVHVisualizer( bvhMesh, params.depth );
		scene.add( helper );

	} );

	const geometry = new THREE.SphereGeometry( 0.01, 32, 32 );
	const material = new THREE.MeshBasicMaterial( { color: 0xffff00, opacity: 0.9, transparent: true } );
	sphereCollision = new THREE.Mesh( geometry, material );
	sphereCollision.visible = false;
	scene.add( sphereCollision );

	const gui = new GUI();
	const helperFolder = gui.addFolder( 'helper' );
	helperFolder.add( params, 'displayHelper' );
	helperFolder.add( params, 'displayParents' ).onChange( v => {

		helper.displayParents = v;
		helper.update();

	} );
	helperFolder.add( params, 'helperDepth', 1, 20, 1 ).name( 'depth' ).onChange( v => {

		helper.depth = parseInt( v );
		helper.update();

	} );
	helperFolder.open();

	const pointsFolder = gui.addFolder( 'points' );
	pointsFolder.add( params, 'useBVH' );
	pointsFolder.add( params, 'strategy', { CENTER, AVERAGE, SAH } ).onChange( v => {

		console.time( 'computeBoundsTree' );
		bvhMesh.geometry.computeBoundsTree( { strategy: parseInt( v ) } );
		console.timeEnd( 'computeBoundsTree' );
		helper.update();

	} );
	pointsFolder.add( params, 'pointSize', 0.001, 0.01, 0.001 );
	pointsFolder.add( params, 'raycastThreshold', 0.001, 0.01, 0.001 );
	pointsFolder.open();

}

window.addEventListener( 'pointermove', ( event ) => {

	if ( ! bvhMesh ) {

		return;

	}

	mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
	mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;
	raycaster.setFromCamera( mouse, camera );

	const startTime = window.performance.now();
	if ( params.useBVH ) {

		sphereCollision.visible = false;

		const inverseMatrix = new THREE.Matrix4();
		inverseMatrix.copy( bvhMesh.matrixWorld ).invert();
		raycaster.ray.applyMatrix4( inverseMatrix );

		const threshold = raycaster.params.Points.threshold;
		const localThreshold = threshold / ( ( bvhMesh.scale.x + bvhMesh.scale.y + bvhMesh.scale.z ) / 3 );
		const localThresholdSq = localThreshold * localThreshold;

		const { ray } = raycaster;
		let closestDistance = Infinity;
		bvhMesh.geometry.boundsTree.shapecast( {
			boundsTraverseOrder: box => {

				// traverse the closer bounds first.
				return box.distanceToPoint( ray.origin );

			},
			intersectsBounds: ( box, isLeaf, score ) => {

				// if we've already found a point that's closer then the full bounds then
				// don't traverse further.
				if ( score > closestDistance ) {

					return NOT_INTERSECTED;

				}

				box.expandByScalar( localThreshold );
				return ray.intersectsBox( box ) ? INTERSECTED : NOT_INTERSECTED;

			},
			intersectsTriangle: triangle => {

				const distancesToRaySq = ray.distanceSqToPoint( triangle.a );
				if ( distancesToRaySq < localThresholdSq ) {

					// track the closest found point distance so we can early out traversal and only
					// use the closest point along the ray.
					const distanceToPoint = ray.origin.distanceTo( triangle.a );
					if ( distanceToPoint < closestDistance ) {

						closestDistance = distanceToPoint;
						sphereCollision.position.copy( triangle.a ).applyMatrix4( bvhMesh.matrixWorld );
						sphereCollision.visible = true;

					}

				}

			},
		} );

	} else {

		const intersects = raycaster.intersectObject( pointCloud, true );
		const hit = intersects[ 0 ];
		if ( hit ) {

			sphereCollision.position.copy( hit.point );
			sphereCollision.visible = true;

		} else {

			sphereCollision.visible = false;

		}

	}

	const delta = window.performance.now() - startTime;
	outputContainer.innerText = `${ delta.toFixed( 2 ) }ms`;

}, false );

function render() {

	requestAnimationFrame( render );

	if ( pointCloud ) {

		pointCloud.material.size = params.pointSize;
		helper.visible = params.displayHelper;
		raycaster.params.Points.threshold = params.raycastThreshold;

	}

	stats.begin();

	renderer.render( scene, camera );
	stats.end();

}


init();
render();
