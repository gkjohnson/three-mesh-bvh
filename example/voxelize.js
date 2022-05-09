import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import Stats from 'stats.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { MeshBVH } from '..';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

let renderer, camera, scene, gui, stats, outputContainer;
let bvh, model, voxels, controls, boxHelper;
let needsUpdate = false;
let voxelTask = null;

const params = {
	scale: 3,
	resolution: 50,
	solid: true,
	displayMesh: true,
	displayBounds: false,
	insideOnly: false,
	rebuild: () => needsUpdate = true,
};

init();
render();

// TODO: afford use of materials on the final model to validate

function init() {

	const bgColor = 0x111111;

	outputContainer = document.getElementById( 'output' );

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
	light.position.set( 3, 6, 9 );
	scene.add( light );

	const revLight = new THREE.DirectionalLight( 0xffffff, 0.1 );
	revLight.position.set( - 3, - 6, - 9 );
	scene.add( revLight );

	const ambient = new THREE.AmbientLight( 0xffffff, 0.25 );
	scene.add( ambient );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 2, 2, 2 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	controls = new OrbitControls( camera, renderer.domElement );

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// load the model
	setTimeout( () => {

		model = new THREE.Mesh( new THREE.TorusKnotBufferGeometry( 1, 0.3, 200, 30 ), new THREE.MeshBasicMaterial( {

			transparent: true,
			wireframe: true,
			depthWrite: false,
			opacity: 0.1,

		} ) );
		scene.add( model );

		bvh = new MeshBVH( model.geometry );

		const boxHelperMesh = new THREE.Mesh( new THREE.BoxBufferGeometry() );
		boxHelper = new THREE.BoxHelper( boxHelperMesh, 0xffffff );
		scene.add( boxHelper );

		needsUpdate = true;

	}, 100 );

	gui = new GUI();
	const computeFolder = gui.addFolder( 'voxelize' );
	computeFolder.add( params, 'resolution', 5, 75, 1 ).onChange( () => {

		needsUpdate = true;

	} );
	computeFolder.add( params, 'scale', 1, 10 ).onChange( () => {

		needsUpdate = true;

	} );
	computeFolder.add( params, 'solid' ).onChange( () => {

		needsUpdate = true;

	} );
	computeFolder.add( params, 'insideOnly' ).onChange( () => {

		needsUpdate = true;

	} );
	computeFolder.add( params, 'rebuild' );

	const helpersFolder = gui.addFolder( 'helpers' );
	helpersFolder.add( params, 'displayMesh' );
	helpersFolder.add( params, 'displayBounds' );

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

}

// regenerate the mesh and bvh
function* rebuildVoxels() {

	const resolution = params.resolution;
	const totalCount = resolution ** 3;
	const dimensions = params.scale;
	const step = dimensions / resolution;
	const color = new THREE.Color( 0xffffff );
	if ( voxels && voxels.instanceMatrix.count !== totalCount ) {

		voxels.material.dispose();
		voxels.dispose();
		voxels.parent.remove( voxels );
		voxels = null;

	}

	if ( ! voxels ) {

		// set color here to force a color buffer to initialize
		voxels = new THREE.InstancedMesh( new RoundedBoxGeometry( 1, 1, 1, 4, 0.1 ), new THREE.MeshStandardMaterial(), totalCount );
		voxels.setColorAt( 0, color );
		scene.add( voxels );

	}

	const minStart = ( - dimensions / 2.0 ) + step * 0.5;
	const position = new THREE.Vector3();
	const quaternion = new THREE.Quaternion();
	const scale = new THREE.Vector3().setScalar( step );
	const worldMatrix = new THREE.Matrix4();
	const boxMat = new THREE.Matrix4();
	const box = new THREE.Box3();
	const ray = new THREE.Ray();
	ray.direction.set( 0, 0, 1 );
	let voxelCount = 0;

	// TODO: add animation
	for ( let y = 0; y < resolution; y ++ ) {

		for ( let x = 0; x < resolution; x ++ ) {

			for ( let z = 0; z < resolution; z ++ ) {

				position.set(
					minStart + x * step,
					minStart + y * step,
					minStart + z * step,
				);

				box.min.setScalar( - 0.5 * step ).add( position );
				box.max.setScalar( 0.5 * step ).add( position );

				const res = bvh.intersectsBox( box, boxMat );
				if ( res ) {

					if ( ! params.insideOnly ) {

						color.set( 0xffffff );
						worldMatrix.compose( position, quaternion, scale );
						voxels.setMatrixAt( voxelCount, worldMatrix );
						voxels.setColorAt( voxelCount, color );
						voxels.instanceMatrix.needsUpdate = true;
						voxels.instanceColor.needsUpdate = true;

						voxelCount ++;

					}

				} else if ( params.solid ) {

					ray.origin.copy( position );

					// If we hit a face backside we know we're inside the mesh. Alternatively we
					// could check if we jot an odd number of faces when checking all intersections.
					const res = bvh.raycastFirst( ray, 2 );
					if ( res && res.face.normal.dot( ray.direction ) > 0.0 ) {

						color.set( 0xFFC107 ).convertSRGBToLinear();
						worldMatrix.compose( position, quaternion, scale );
						voxels.setMatrixAt( voxelCount, worldMatrix );
						voxels.setColorAt( voxelCount, color );
						voxels.instanceMatrix.needsUpdate = true;
						voxels.instanceColor.needsUpdate = true;

						voxelCount ++;

					}

				}

				voxels.count = voxelCount;
				yield;

			}

		}

	}

	voxels.count = voxelCount;

}

function render() {

	stats.update();
	requestAnimationFrame( render );

	scene.updateMatrixWorld( true );

	if ( needsUpdate ) {

		voxelTask = rebuildVoxels();
		needsUpdate = false;

	}

	if ( voxelTask ) {

		let startTime = window.performance.now();
		while ( window.performance.now() - startTime < 16 ) {

			const res = voxelTask.next();
			if ( res.done ) {

				voxelTask = null;
				break;

			}

		}

	}

	if ( boxHelper ) {

		boxHelper.object.scale.setScalar( params.scale );
		boxHelper.object.updateMatrixWorld( true );
		boxHelper.update();

		model.visible = params.displayMesh;
		boxHelper.visible = params.displayBounds;

	}

	renderer.render( scene, camera );

}
