import Stats from 'stats.js';
import * as dat from 'three/examples/jsm/libs/lil-gui.module.min.js';
import * as THREE from 'three';
import {
	acceleratedRaycast, computeBoundsTree, disposeBoundsTree,
	computeBatchedBoundsTree, disposeBatchedBoundsTree,
	CENTER, SAH, AVERAGE,
} from 'three-mesh-bvh';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

THREE.BatchedMesh.prototype.raycast = acceleratedRaycast;
THREE.BatchedMesh.prototype.computeBoundsTree = computeBatchedBoundsTree;
THREE.BatchedMesh.prototype.disposeBoundsTree = disposeBatchedBoundsTree;

const bgColor = 0xcfd8dc;
const meshColor = 0x263238;
const lineColor = 0xd81b60;

let renderer, scene, stats, camera;
let material, containerObj, batchedMesh;
const rayCasterObjects = [];

// Create ray casters in the scene
const raycaster = new THREE.Raycaster();
const sphere = new THREE.SphereGeometry( 0.25, 20, 20 );
const cylinder = new THREE.CylinderGeometry( 0.01, 0.01 );
const pointDist = 23;

const dolly = new THREE.Object3D();

// Delta timer
const params = {
	raycasters: {
		count: 150,
		near: 0,
		far: pointDist
	},

	mesh: {
		splitStrategy: CENTER,
		useBoundsTree: true,
		indirect: false,
	}
};

init();
updateFromOptions();
render();

function init() {

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new THREE.Scene();
	scene.fog = new THREE.Fog( bgColor, 40, 100 );

	const light = new THREE.DirectionalLight( 0xffffff, 1.5 );
	light.position.set( 1, 1, 1 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xffffff, 1.2 ) );

	containerObj = new THREE.Object3D();
	material = new THREE.MeshPhongMaterial( { color: meshColor } );
	containerObj.scale.multiplyScalar( 10 );
	containerObj.rotation.x = 10.989999999999943;
	containerObj.rotation.y = 10.989999999999943;
	scene.add( containerObj );

	createBatchedMesh();

	// camera setup
	camera = new THREE.PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.z = 50;
	camera.far = 100;
	camera.updateProjectionMatrix();

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// Run
	const gui = new dat.GUI();
	const rcFolder = gui.addFolder( 'Raycasters' );
	rcFolder.add( params.raycasters, 'count' ).min( 1 ).max( 1000 ).step( 1 ).onChange( () => updateFromOptions() );
	rcFolder.add( params.raycasters, 'near' ).min( 0 ).max( pointDist ).onChange( () => updateFromOptions() );
	rcFolder.add( params.raycasters, 'far' ).min( 0 ).max( pointDist ).onChange( () => updateFromOptions() );
	rcFolder.open();

	const meshFolder = gui.addFolder( 'Mesh' );
	meshFolder.add( params.mesh, 'useBoundsTree' ).onChange( () => updateFromOptions() );
	meshFolder.add( params.mesh, 'indirect' ).onChange( () => updateFromOptions() );
	meshFolder.add( params.mesh, 'splitStrategy', { 'CENTER': CENTER, 'SAH': SAH, 'AVERAGE': AVERAGE } ).onChange( () => updateFromOptions() );
	meshFolder.open();

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

}

function createBatchedMesh() {

	const radius = 0.5;

	const knotGeometry = new THREE.TorusKnotGeometry( radius, 0.2, 200, 100, 2, 3 );
	const knot2Geometry = new THREE.TorusKnotGeometry( radius, 0.2, 200, 100, 3, 4 );
	const sphereGeometry = new THREE.SphereGeometry( radius, 100, 100 );

	const knotVertices = knotGeometry.attributes.position.count;
	const knot2Vertices = knot2Geometry.attributes.position.count;
	const sphereVertices = sphereGeometry.attributes.position.count;
	const maxVertices = knotVertices + knot2Vertices + sphereVertices;

	const knotIndexes = knotGeometry.index.count;
	const knot2Indexes = knot2Geometry.index.count;
	const sphereIndexes = sphereGeometry.index.count;
	const maxIndexes = knotIndexes + knot2Indexes + sphereIndexes;

	batchedMesh = new THREE.BatchedMesh( 3, maxVertices, maxIndexes, material );

	const knotGeometryId = batchedMesh.addGeometry( knotGeometry );
	const knot2GeometryId = batchedMesh.addGeometry( knot2Geometry );
	const sphereGeometryId = batchedMesh.addGeometry( sphereGeometry );

	batchedMesh.addInstance( knotGeometryId );
	batchedMesh.addInstance( knot2GeometryId );
	batchedMesh.addInstance( sphereGeometryId );

	dolly.position.x = - 1.5;
	dolly.updateMatrix();
	batchedMesh.setMatrixAt( 0, dolly.matrix );

	dolly.position.x = 0;
	dolly.updateMatrix();
	batchedMesh.setMatrixAt( 1, dolly.matrix );

	dolly.position.x = 1.5;
	dolly.updateMatrix();
	batchedMesh.setMatrixAt( 2, dolly.matrix );

	batchedMesh.rotation.x = Math.random() * 10;
	batchedMesh.rotation.y = Math.random() * 10;

	containerObj.add( batchedMesh );

}

function updateBatchedMeshInstances() {

	const time = window.performance.now();

	// Instance 0: update rotation state and apply
	batchedMesh.getMatrixAt( 0, dolly.matrix );
	dolly.matrix.decompose( dolly.position, dolly.quaternion, dolly.scale );
	dolly.rotation.set( 0.0003 * time, 0.0003 * time, 0 );
	dolly.updateMatrix();
	batchedMesh.setMatrixAt( 0, dolly.matrix );

	// Instance 1: update rotation state and apply
	batchedMesh.getMatrixAt( 1, dolly.matrix );
	dolly.matrix.decompose( dolly.position, dolly.quaternion, dolly.scale );
	dolly.rotation.set( 0.0009 * time, 0.0009 * time, 0 );
	dolly.updateMatrix();
	batchedMesh.setMatrixAt( 1, dolly.matrix );

	// Instance 2: update rotation state and apply
	batchedMesh.getMatrixAt( 2, dolly.matrix );
	dolly.matrix.decompose( dolly.position, dolly.quaternion, dolly.scale );
	dolly.rotation.set( 0.0005 * time, 0.0005 * time, 0 );
	dolly.updateMatrix();
	batchedMesh.setMatrixAt( 2, dolly.matrix );

}

function addRaycaster() {

	// Objects
	const obj = new THREE.Object3D();
	const material = new THREE.MeshBasicMaterial( { color: lineColor } );
	const origMesh = new THREE.Mesh( sphere, material );
	const hitMesh = new THREE.Mesh( sphere, material );
	hitMesh.scale.multiplyScalar( 0.25 );
	origMesh.scale.multiplyScalar( 0.5 );

	const cylinderMesh = new THREE.Mesh( cylinder, new THREE.MeshBasicMaterial( { color: lineColor, transparent: true, opacity: 0.5 } ) );

	// Init the rotation root
	obj.add( cylinderMesh );
	obj.add( origMesh );
	obj.add( hitMesh );
	scene.add( obj );

	// set transforms
	origMesh.position.set( pointDist, 0, 0 );
	const x = Math.random() * 10;
	const y = Math.random() * 10;
	const z = Math.random() * 10;

	// reusable vectors
	const origVec = new THREE.Vector3();
	const dirVec = new THREE.Vector3();
	const xDir = ( Math.random() - 0.5 );
	const yDir = ( Math.random() - 0.5 );
	const zDir = ( Math.random() - 0.5 );

	rayCasterObjects.push( {
		update: () => {

			const time = window.performance.now();
			obj.rotation.x = xDir * 0.0001 * time + x;
			obj.rotation.y = yDir * 0.0001 * time + y;
			obj.rotation.z = zDir * 0.0001 * time + z;

			origMesh.updateMatrixWorld();
			origVec.setFromMatrixPosition( origMesh.matrixWorld );
			dirVec.copy( origVec ).multiplyScalar( - 1 ).normalize();

			raycaster.set( origVec, dirVec );
			raycaster.firstHitOnly = true;
			const res = raycaster.intersectObject( containerObj, true );
			const length = res.length ? res[ 0 ].distance : pointDist;

			hitMesh.position.set( pointDist - length, 0, 0 );

			const lineLength = res.length ? length - raycaster.near : length - raycaster.near - ( pointDist - raycaster.far );

			cylinderMesh.position.set( pointDist - raycaster.near - ( lineLength / 2 ), 0, 0 );
			cylinderMesh.scale.set( 1, lineLength, 1 );

			cylinderMesh.rotation.z = Math.PI / 2;

		},

		remove: () => {

			scene.remove( obj );

		}
	} );

}

function updateFromOptions() {

	raycaster.near = params.raycasters.near;
	raycaster.far = params.raycasters.far;

	// Update raycaster count
	while ( rayCasterObjects.length > params.raycasters.count ) {

		rayCasterObjects.pop().remove();

	}

	while ( rayCasterObjects.length < params.raycasters.count ) {

		addRaycaster();

	}

	if ( ! batchedMesh ) {

		return;

	}

	// Update whether or not to use the bounds tree
	if (
		! params.mesh.useBoundsTree && batchedMesh.boundsTrees ||
		batchedMesh.boundsTrees && (
			params.mesh.splitStrategy !== batchedMesh.boundsTrees.splitStrategy ||
			params.mesh.indirect !== batchedMesh.boundsTrees.indirect
		)
	) {

		batchedMesh.disposeBoundsTree();
		batchedMesh.boundsTrees = null;

	}

	if ( params.mesh.useBoundsTree && ! batchedMesh.boundsTrees ) {

		console.time( 'computing bounds tree' );
		batchedMesh.computeBoundsTree( - 1, {
			maxLeafSize: 5,
			strategy: parseFloat( params.mesh.splitStrategy ),
			indirect: params.mesh.indirect,
		} );
		batchedMesh.boundsTrees.splitStrategy = params.mesh.splitStrategy;
		batchedMesh.boundsTrees.indirect = params.mesh.indirect;
		console.timeEnd( 'computing bounds tree' );

	}

}

function render() {

	stats.begin();

	const time = window.performance.now();
	containerObj.rotation.x = 0.0001 * time;
	containerObj.rotation.y = 0.0001 * time;
	containerObj.updateMatrixWorld();

	updateBatchedMeshInstances();

	rayCasterObjects.forEach( f => f.update() );

	renderer.render( scene, camera );

	stats.end();

	requestAnimationFrame( render );

}
