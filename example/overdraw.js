import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import Stats from 'stats.js';
import { GUI } from 'dat.gui';
import MeshBVH from '../src/MeshBVH.js';

const params = {

	sort: true,
	frontToBack: false,
	useBVH: true,
	overdraw: false,

};

let renderer, camera, scene, mesh, gui, stats, bvh, outputContainer;
let overdrawMaterial, originalMaterial;
const indexObjectPool = [];
const triA = new THREE.Vector3();
const triB = new THREE.Vector3();
const triC = new THREE.Vector3();

init();
render();

function init() {

	const bgColor = 0x222222;

	overdrawMaterial = new THREE.MeshBasicMaterial( {

		transparent: true,
		opacity: 0.15,
		side: THREE.DoubleSide,

	} );

	outputContainer = document.getElementById( 'output' );

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
	scene.add( new THREE.AmbientLight( 0xb0bec5, 0.1 ) );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 0, 0, 1 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	new OBJLoader().load( '../models/happy.obj', res => {

		mesh = res.children[ 0 ];
		mesh.material = new THREE.MeshStandardMaterial();
		mesh.geometry.clearGroups();

		const { geometry, material } = mesh;
		geometry.center().scale( 5, 5, 5 );

		if ( ! geometry.index ) {

			const indices = new Array( geometry.attributes.position.count )
				.fill()
				.map( ( v, i ) => i );

			geometry.setIndex( indices );

		}

		originalMaterial = mesh.material;

		const bvhGeometry = geometry.clone();
		bvhGeometry.index = bvhGeometry.index.clone();

		bvh = new MeshBVH( bvhGeometry );

		material.depthWrite = false;
		material.transparent = true;
		material.opacity = 0.75;
		material.side = THREE.DoubleSide;

		scene.add( mesh );

	} );

	new OrbitControls( camera, renderer.domElement );

	gui = new GUI();
	gui.open();
	gui.add( params, 'sort' );
	gui.add( params, 'frontToBack' );
	gui.add( params, 'useBVH' );
	gui.add( params, 'overdraw' );
	gui.open();

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

}

function updateWithoutBVH() {

	const geometry = mesh.geometry;
	const positionAttr = geometry.attributes.position;
	const indexAttr = geometry.index;

	for ( let i = 0, l = indexAttr.count; i < l; i += 3 ) {

		const i3 = i / 3;
		if ( i3 >= indexObjectPool.length ) {

			indexObjectPool.push( {
				indices: [ - 1, - 1, - 1 ],
				distance: - 1,
			} );

		}

		const ia = indexAttr.getX( i );
		const ib = indexAttr.getX( i + 1 );
		const ic = indexAttr.getX( i + 2 );

		triA.fromBufferAttribute( positionAttr, ia );
		triB.fromBufferAttribute( positionAttr, ib );
		triC.fromBufferAttribute( positionAttr, ic );
		triA.add( triB ).add( triC ).multiplyScalar( 1 / 3 ).applyMatrix4( mesh.matrixWorld );

		const distance = triA.distanceTo( camera.position );
		const object = indexObjectPool[ i3 ];
		object.distance = distance;
		object.indices[ 0 ] = ia;
		object.indices[ 1 ] = ib;
		object.indices[ 2 ] = ic;

	}

	indexObjectPool
		.sort( ( a, b ) => {

			if ( params.frontToBack ) {

				return a.distance - b.distance;

			} else {

				return b.distance - a.distance;

			}

		} );

	for ( let i = 0, l = indexObjectPool.length; i < l; i ++ ) {

		const o = indexObjectPool[ i ];
		indexAttr.setX( 3 * i + 0, o.indices[ 0 ] );
		indexAttr.setX( 3 * i + 1, o.indices[ 1 ] );
		indexAttr.setX( 3 * i + 2, o.indices[ 2 ] );

	}

	indexAttr.needsUpdate = true;

}

function updateWithBVH() {

	const geometry = mesh.geometry;
	const ogIndex = geometry.index;
	const bvhIndex = bvh.geometry.index;

	const invMatrix = new THREE.Matrix4().copy( mesh.matrixWorld ).invert();
	const posInMesh = camera.position.clone().applyMatrix4( invMatrix );

	const xyzFields = [ 'x', 'y', 'z' ];
	let currIndex = 0;
	bvh
		.shapecast(
			mesh,
			{
				intersectsBounds: () => true,

				intersectsRange: ( offset, count, contained, depth, nodeIndex ) => {

					// TODO: Would this still be faster if we sorted triangles internally?
					for ( let i = offset * 3, l = 3 * ( offset + count ); i < l; i += 3 ) {

						const i0 = bvhIndex.getX( i + 0 );
						const i1 = bvhIndex.getX( i + 1 );
						const i2 = bvhIndex.getX( i + 2 );

						ogIndex.setX( currIndex + 0, i0 );
						ogIndex.setX( currIndex + 1, i1 );
						ogIndex.setX( currIndex + 2, i2 );

						currIndex += 3;

					}

				},

				boundsTraverseOrder: ( box, splitAxis, splitPos, splitSide ) => {

					const order = params.frontToBack ? 1 : - 1;
					const cameraPos = posInMesh[ xyzFields[ splitAxis ] ];
					const camSide = Math.sign( cameraPos - splitPos );

					return order * ( camSide === splitSide ? - 1 : 1 );
					// return order * box.getCenter( triA ).distanceTo( posInMesh );

				},
			}
		);

	ogIndex.needsUpdate = true;

}

let lastTime = 0;
function render() {

	stats.update();

	requestAnimationFrame( render );
	if ( ! mesh ) {

		return;

	}

	const startTime = window.performance.now();
	if ( params.sort ) {

		if ( params.useBVH ) {

			updateWithBVH();

		} else {

			updateWithoutBVH();

		}

	}
	const delta = window.performance.now() - startTime;

	if ( startTime - lastTime > 250 ) {

		outputContainer.innerText = delta.toFixed() + 'ms';
		lastTime = startTime;

	}

	mesh.material = params.overdraw ? overdrawMaterial : originalMaterial;

	renderer.render( scene, camera );

}
