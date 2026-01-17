import Stats from 'stats.js';
import * as dat from 'three/examples/jsm/libs/lil-gui.module.min.js';
import * as THREE from 'three';
import {
	acceleratedRaycast, computeBoundsTree, disposeBoundsTree,
	CENTER, SAH, AVERAGE, BVHHelper,
} from 'three-mesh-bvh';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const bgColor = 0x131619;
const pointDist = 25;

const params = {
	// Raycasters
	raycasterCount: 150,
	raycasterSpeed: 1,
	raycasterNear: 0,
	raycasterFar: pointDist,

	// Mesh
	splitStrategy: CENTER,
	meshCount: 1,
	meshSpeed: 1,
	useBoundsTree: true,
	displayBVH: false,
	displayDepth: 10,
	displayParents: false,
};

let renderer, scene, stats, camera;
let geometry, material, bvhHelper, containerObj;
const knots = [];
const rayCasterObjects = [];

const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;

const sphere = new THREE.SphereGeometry( 0.25, 20, 20 );
const cylinder = new THREE.CylinderGeometry( 0.01, 0.01 );

let lastFrameTime = null;

init();
updateFromOptions();

function init() {

	// Renderer
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.setAnimationLoop( render );
	document.body.appendChild( renderer.domElement );

	// Scene
	scene = new THREE.Scene();
	scene.fog = new THREE.Fog( bgColor, 40, 80 );

	// Lights
	const directionalLight = new THREE.DirectionalLight( 0xffffff, 0.5 );
	directionalLight.position.set( 1, 1, 1 );

	const ambientLight = new THREE.AmbientLight( 0xffffff, 0.4 );
	scene.add( directionalLight, ambientLight );

	// Geometry
	const radius = 1;
	const tube = 0.4;
	const tubularSegments = 400;
	const radialSegments = 100;

	containerObj = new THREE.Object3D();
	geometry = new THREE.TorusKnotGeometry( radius, tube, tubularSegments, radialSegments );
	material = new THREE.MeshPhongMaterial( { color: 0xE91E63 } );
	containerObj.scale.setScalar( 10 );
	containerObj.rotation.x = containerObj.rotation.y = 10.989999999999943;
	scene.add( containerObj );

	// Camera
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 100 );
	camera.position.z = 60;

	// Stats
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// GUI
	const gui = new dat.GUI();
	const rcFolder = gui.addFolder( 'Raycasters' );
	rcFolder.add( params, 'raycasterCount', 1, 1000, 1 ).onChange( updateFromOptions );
	rcFolder.add( params, 'raycasterSpeed', 0, 20 );
	rcFolder.add( params, 'raycasterNear', 0, pointDist ).onChange( updateFromOptions );
	rcFolder.add( params, 'raycasterFar', 0, pointDist ).onChange( updateFromOptions );
	rcFolder.open();

	const meshFolder = gui.addFolder( 'Mesh' );
	meshFolder.add( params, 'useBoundsTree' ).onChange( updateFromOptions );
	meshFolder.add( params, 'splitStrategy', { CENTER, SAH, AVERAGE } ).onChange( updateFromOptions );
	meshFolder.add( params, 'meshCount', 1, 300, 1 ).onChange( updateFromOptions );
	meshFolder.add( params, 'meshSpeed', 0, 20 );
	meshFolder.add( params, 'displayBVH' ).onChange( updateFromOptions );
	meshFolder.add( params, 'displayParents' ).onChange( v => {

		if ( bvhHelper ) {

			bvhHelper.displayParents = v;
			bvhHelper.update();

		}

	} );
	meshFolder.add( params, 'displayDepth', 1, 20, 1 ).onChange( v => {

		if ( bvhHelper ) {

			bvhHelper.depth = v;
			bvhHelper.update();

		}

	} );
	meshFolder.open();

	window.addEventListener( 'resize', () => {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize( window.innerWidth, window.innerHeight );

	} );

}

function addKnot() {

	const mesh = new THREE.Mesh( geometry, material );
	mesh.rotation.x = Math.random() * 10;
	mesh.rotation.y = Math.random() * 10;
	knots.push( mesh );
	containerObj.add( mesh );

}

function addRaycaster() {

	const obj = new THREE.Object3D();
	const whiteMaterial = new THREE.MeshBasicMaterial( { color: 0xffffff } );
	const origMesh = new THREE.Mesh( sphere, whiteMaterial );
	const hitMesh = new THREE.Mesh( sphere, whiteMaterial );
	hitMesh.scale.setScalar( 0.25 );
	origMesh.scale.setScalar( 0.5 );

	const cylinderMesh = new THREE.Mesh( cylinder, new THREE.MeshBasicMaterial( {
		color: 0xffffff,
		transparent: true,
		opacity: 0.25
	} ) );
	cylinderMesh.rotation.z = Math.PI / 2;

	obj.add( cylinderMesh, origMesh, hitMesh );
	scene.add( obj );

	origMesh.position.set( pointDist, 0, 0 );
	obj.rotation.x = Math.random() * 10;
	obj.rotation.y = Math.random() * 10;
	obj.rotation.z = Math.random() * 10;

	const origVec = new THREE.Vector3();
	const dirVec = new THREE.Vector3();
	const xDir = Math.random() - 0.5;
	const yDir = Math.random() - 0.5;
	const zDir = Math.random() - 0.5;

	rayCasterObjects.push( {
		update: deltaTime => {

			obj.rotation.x += xDir * 0.0001 * params.raycasterSpeed * deltaTime;
			obj.rotation.y += yDir * 0.0001 * params.raycasterSpeed * deltaTime;
			obj.rotation.z += zDir * 0.0001 * params.raycasterSpeed * deltaTime;

			origMesh.updateMatrixWorld();
			origVec.setFromMatrixPosition( origMesh.matrixWorld );
			dirVec.copy( origVec ).multiplyScalar( - 1 ).normalize();

			raycaster.set( origVec, dirVec );
			const res = raycaster.intersectObject( containerObj, true );
			const length = res.length ? res[ 0 ].distance : pointDist;

			hitMesh.position.set( pointDist - length, 0, 0 );

			const lineLength = res.length ? length - raycaster.near : length - raycaster.near - ( pointDist - raycaster.far );
			cylinderMesh.position.set( pointDist - raycaster.near - ( lineLength / 2 ), 0, 0 );
			cylinderMesh.scale.set( 1, lineLength, 1 );

		},

		remove: () => scene.remove( obj )
	} );

}

function updateFromOptions() {

	raycaster.near = params.raycasterNear;
	raycaster.far = params.raycasterFar;

	// Update raycaster count
	while ( rayCasterObjects.length > params.raycasterCount ) {

		rayCasterObjects.pop().remove();

	}

	while ( rayCasterObjects.length < params.raycasterCount ) {

		addRaycaster();

	}

	if ( ! geometry ) return;

	// Update bounds tree
	if (
		! params.useBoundsTree && geometry.boundsTree ||
		geometry.boundsTree && params.splitStrategy !== geometry.boundsTree.splitStrategy
	) {

		geometry.disposeBoundsTree();

	}

	if ( params.useBoundsTree && ! geometry.boundsTree ) {

		console.time( 'computing bounds tree' );
		geometry.computeBoundsTree( {
			maxLeafSize: 5,
			strategy: parseFloat( params.splitStrategy ),
		} );
		geometry.boundsTree.splitStrategy = params.splitStrategy;
		console.timeEnd( 'computing bounds tree' );

		if ( bvhHelper ) bvhHelper.update();

	}

	// Update knot count
	const oldLen = knots.length;
	while ( knots.length > params.meshCount ) {

		containerObj.remove( knots.pop() );

	}

	while ( knots.length < params.meshCount ) {

		addKnot();

	}

	if ( oldLen !== knots.length ) {

		const lerp = ( a, b, t ) => a + ( b - a ) * t;
		const lerpAmt = ( knots.length - 1 ) / 299;
		const dist = lerp( 0, 2, lerpAmt );
		const scale = lerp( 1, 0.2, lerpAmt );

		knots.forEach( c => {

			c.scale.setScalar( scale );

			const vec3 = new THREE.Vector3( 0, 1, 0 );
			vec3.applyAxisAngle( new THREE.Vector3( 1, 0, 0 ), Math.PI * Math.random() );
			vec3.applyAxisAngle( new THREE.Vector3( 0, 1, 0 ), 2 * Math.PI * Math.random() );
			vec3.multiplyScalar( dist );

			c.position.copy( vec3 );

		} );

	}

	// Update bounds visualization
	const shouldDisplayBounds = params.displayBVH && geometry.boundsTree;
	if ( bvhHelper && ! shouldDisplayBounds ) {

		containerObj.remove( bvhHelper );
		bvhHelper = null;

	}

	if ( ! bvhHelper && shouldDisplayBounds ) {

		bvhHelper = new BVHHelper( knots[ 0 ] );
		containerObj.add( bvhHelper );

	}

}

function render() {

	stats.begin();

	const currTime = window.performance.now();
	lastFrameTime = lastFrameTime || currTime;
	const deltaTime = currTime - lastFrameTime;

	// Update GUI settings
	if ( bvhHelper ) bvhHelper.visible = params.displayBVH;

	containerObj.rotation.x += 0.0001 * params.meshSpeed * deltaTime;
	containerObj.rotation.y += 0.0001 * params.meshSpeed * deltaTime;
	containerObj.children.forEach( c => {

		c.rotation.x += 0.0001 * params.meshSpeed * deltaTime;
		c.rotation.y += 0.0001 * params.meshSpeed * deltaTime;

	} );
	containerObj.updateMatrixWorld();

	rayCasterObjects.forEach( f => f.update( deltaTime ) );

	renderer.render( scene, camera );

	lastFrameTime = currTime;

	stats.end();

}
