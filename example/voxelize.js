import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import Stats from 'stats.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { MeshBVH } from '..';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GenerateMeshBVHWorker } from '../src/workers/GenerateMeshBVHWorker.js';

let renderer, camera, scene, gui, stats, outputContainer;
let voxels, controls, boxHelper;
let needsUpdate = false;
let voxelTask = null;

const params = {
	model: 'Torus Knot',
	scale: 0.75,
	resolution: 30,
	solid: true,
	displayMesh: true,
	displayBounds: false,
	insideOnly: false,
	rebuild: () => needsUpdate = true,
};

const models = {};

init();
render();

function init() {

	const bgColor = 0x161e1d;

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
	camera.position.set( 1, 0.5, 1 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	controls = new OrbitControls( camera, renderer.domElement );

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	const wireframeMaterial = new THREE.MeshBasicMaterial( {

		transparent: true,
		wireframe: true,
		depthWrite: false,
		opacity: 0.02,

	} );

	// load the model
	new GLTFLoader().setMeshoptDecoder( MeshoptDecoder ).load( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/happy-buddha/buddha.glb', gltf => {

		const model = gltf.scene.children[ 0 ];
		model.geometry.center();
		model.material = wireframeMaterial;
		model.scale.setScalar( 1.5 );
		model.rotation.y = - Math.PI / 2;

		const generator = new GenerateMeshBVHWorker();
		generator.generate( model.geometry ).then( bvh => {

			scene.add( model );
			models[ 'Buddha' ] = { model, bvh };
			if ( params.model === 'Buddha' ) {

				needsUpdate = true;

			}

		} );

	} );

	new GLTFLoader().setMeshoptDecoder( MeshoptDecoder ).load( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/stanford-bunny/bunny.glb', gltf => {

		const model = gltf.scene.children[ 0 ];
		model.geometry.center();
		model.material = wireframeMaterial;
		model.rotation.y = Math.PI / 2;
		model.scale.setScalar( 0.65 );

		const generator = new GenerateMeshBVHWorker();
		generator.generate( model.geometry ).then( bvh => {

			scene.add( model );
			models[ 'Bunny' ] = { model, bvh };
			if ( params.model === 'Bunny' ) {

				needsUpdate = true;

			}

		} );

	} );

	{

		const model = new THREE.Mesh( new THREE.TorusKnotGeometry( 0.3, 0.1, 400, 60 ), wireframeMaterial );
		const bvh = new MeshBVH( model.geometry );
		scene.add( model );

		models[ 'Torus Knot' ] = {
			bvh: bvh,
			model: model,
		};
		needsUpdate = true;

	}

	models[ 'Buddha' ] = { model: null, bvh: null };
	models[ 'Bunny' ] = { model: null, bvh: null };

	const boxHelperMesh = new THREE.Mesh( new THREE.BoxGeometry() );
	boxHelper = new THREE.BoxHelper( boxHelperMesh, 0xffffff );
	boxHelper.material.opacity = 0.35;
	boxHelper.material.transparent = true;
	scene.add( boxHelper );

	gui = new GUI();
	gui.add( params, 'model', Object.keys( models ) ).onChange( () => {

		needsUpdate = true;

	} );

	const computeFolder = gui.addFolder( 'voxelize' );
	computeFolder.add( params, 'resolution', 5, 75, 1 ).onChange( () => {

		needsUpdate = true;

	} );
	computeFolder.add( params, 'scale', 0.1, 4 ).onChange( () => {

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
	const outsideColor = new THREE.Color( 0xffffff );
	const insideColor = new THREE.Color( 0xFFC107 ).convertSRGBToLinear();
	if ( voxels && voxels.instanceMatrix.count !== totalCount ) {

		voxels.material.dispose();
		voxels.dispose();
		voxels.parent.remove( voxels );
		voxels = null;

	}

	const { model, bvh } = models[ params.model ];
	if ( ! model ) {

		return;

	}

	if ( ! voxels ) {

		// set color here to force a color buffer to initialize
		voxels = new THREE.InstancedMesh( new RoundedBoxGeometry( 1, 1, 1, 4, 0.1 ), new THREE.MeshStandardMaterial(), totalCount );
		voxels.setColorAt( 0, outsideColor );
		scene.add( voxels );

	}

	const minStart = ( - dimensions / 2.0 ) + step * 0.5;
	const position = new THREE.Vector3();
	const quaternion = new THREE.Quaternion();
	const scale = new THREE.Vector3().setScalar( step );
	const worldMatrix = new THREE.Matrix4();
	const box = new THREE.Box3();
	const invMat = new THREE.Matrix4().copy( model.matrixWorld ).invert();

	const ray = new THREE.Ray();
	ray.direction.set( 0, 0, 1 );

	let voxelCount = 0;

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

				const res = bvh.intersectsBox( box, invMat );
				if ( res ) {

					if ( ! params.insideOnly ) {

						worldMatrix.compose( position, quaternion, scale );
						voxels.setMatrixAt( voxelCount, worldMatrix );
						voxels.setColorAt( voxelCount, outsideColor );
						voxels.instanceMatrix.needsUpdate = true;
						voxels.instanceColor.needsUpdate = true;

						voxelCount ++;

					}

				} else if ( params.solid ) {

					// transform into the local frame of the model
					ray.origin.copy( position ).applyMatrix4( invMat );

					// If we hit a face backside we know we're inside the mesh. Alternatively we
					// could check if we jot an odd number of faces when checking all intersections.
					const res = bvh.raycastFirst( ray, 2 );
					if ( res && res.face.normal.dot( ray.direction ) > 0.0 ) {

						worldMatrix.compose( position, quaternion, scale );
						voxels.setMatrixAt( voxelCount, worldMatrix );
						voxels.setColorAt( voxelCount, insideColor );
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

	// kick off a new voxelization task
	if ( needsUpdate ) {

		voxelTask = rebuildVoxels();
		needsUpdate = false;

	}

	// tick the task forward
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

	}

	// hide the models
	for ( const key in models ) {

		const info = models[ key ];
		if ( info.model ) info.model.visible = false;

	}

	// show the select model
	const { model } = models[ params.model ];
	if ( model ) {

		model.visible = params.displayMesh;
		boxHelper.visible = params.displayBounds;

	}

	renderer.render( scene, camera );

}
