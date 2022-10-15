import Stats from 'stats.js';
import * as dat from 'three/examples/jsm/libs/lil-gui.module.min.js';
import * as THREE from 'three';
import {
	acceleratedRaycast, computeBoundsTree, disposeBoundsTree,
	CENTER, SAH, AVERAGE, MeshBVHVisualizer,
} from '..';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const bgColor = 0x263238 / 2;

let renderer, scene, stats, camera;
let geometry, material, boundsViz, containerObj;
const knots = [];
const rayCasterObjects = [];

// Create ray casters in the scene
const raycaster = new THREE.Raycaster();
const sphere = new THREE.SphereGeometry( 0.25, 20, 20 );
const cylinder = new THREE.CylinderGeometry( 0.01, 0.01 );
const pointDist = 25;

// Delta timer
let lastFrameTime = null;
let deltaTime = 0;

const params = {
	raycasters: {
		count: 150,
		speed: 1
	},

	mesh: {
		splitStrategy: CENTER,
		count: 1,
		useBoundsTree: true,
		visualizeBounds: false,
		displayParents: false,
		speed: 1,
		visualBoundsDepth: 10
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
	scene.fog = new THREE.Fog( 0x263238 / 2, 20, 60 );

	const light = new THREE.DirectionalLight( 0xffffff, 0.5 );
	light.position.set( 1, 1, 1 );
	scene.add( light );
	scene.add( new THREE.AmbientLight( 0xffffff, 0.4 ) );

	// geometry setup
	const radius = 1;
	const tube = 0.4;
	const tubularSegments = 400;
	const radialSegments = 100;

	containerObj = new THREE.Object3D();
	geometry = new THREE.TorusKnotGeometry( radius, tube, tubularSegments, radialSegments );
	// const knotGeometry = new THREE.TorusKnotGeometry(radius, tube, tubularSegments, radialSegments);
	material = new THREE.MeshPhongMaterial( { color: 0xE91E63 } );
	containerObj.scale.multiplyScalar( 10 );
	containerObj.rotation.x = 10.989999999999943;
	containerObj.rotation.y = 10.989999999999943;
	scene.add( containerObj );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.z = 40;
	camera.far = 100;
	camera.updateProjectionMatrix();

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	// Run
	const gui = new dat.GUI();
	const rcFolder = gui.addFolder( 'Raycasters' );
	rcFolder.add( params.raycasters, 'count' ).min( 1 ).max( 1000 ).step( 1 ).onChange( () => updateFromOptions() );
	rcFolder.add( params.raycasters, 'speed' ).min( 0 ).max( 20 );
	rcFolder.open();

	const meshFolder = gui.addFolder( 'Mesh' );
	meshFolder.add( params.mesh, 'useBoundsTree' ).onChange( () => updateFromOptions() );
	meshFolder.add( params.mesh, 'splitStrategy', { 'CENTER': CENTER, 'SAH': SAH, 'AVERAGE': AVERAGE } ).onChange( () => updateFromOptions() );
	meshFolder.add( params.mesh, 'count' ).min( 1 ).max( 300 ).step( 1 ).onChange( () => updateFromOptions() );
	meshFolder.add( params.mesh, 'speed' ).min( 0 ).max( 20 );
	meshFolder.add( params.mesh, 'visualizeBounds' ).onChange( () => updateFromOptions() );
	meshFolder.add( params.mesh, 'displayParents' ).onChange( () => updateFromOptions() );
	meshFolder.add( params.mesh, 'visualBoundsDepth' ).min( 1 ).max( 20 ).step( 1 ).onChange( () => updateFromOptions() );
	meshFolder.open();

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

}

function addKnot() {

	const mesh = new THREE.Mesh( geometry, material );
	mesh.rotation.x = Math.random() * 10;
	mesh.rotation.y = Math.random() * 10;
	knots.push( mesh );
	containerObj.add( mesh );

}

function addRaycaster() {

	// Objects
	const obj = new THREE.Object3D();
	const material = new THREE.MeshBasicMaterial( { color: 0xffffff } );
	const origMesh = new THREE.Mesh( sphere, material );
	const hitMesh = new THREE.Mesh( sphere, material );
	hitMesh.scale.multiplyScalar( 0.25 );
	origMesh.scale.multiplyScalar( 0.5 );

	const cylinderMesh = new THREE.Mesh( cylinder, new THREE.MeshBasicMaterial( { color: 0xffffff, transparent: true, opacity: 0.25 } ) );

	// Init the rotation root
	obj.add( cylinderMesh );
	obj.add( origMesh );
	obj.add( hitMesh );
	scene.add( obj );

	// set transforms
	origMesh.position.set( pointDist, 0, 0 );
	obj.rotation.x = Math.random() * 10;
	obj.rotation.y = Math.random() * 10;
	obj.rotation.z = Math.random() * 10;

	// reusable vectors
	const origVec = new THREE.Vector3();
	const dirVec = new THREE.Vector3();
	const xDir = ( Math.random() - 0.5 );
	const yDir = ( Math.random() - 0.5 );
	const zDir = ( Math.random() - 0.5 );
	rayCasterObjects.push( {
		update: () => {

			obj.rotation.x += xDir * 0.0001 * params.raycasters.speed * deltaTime;
			obj.rotation.y += yDir * 0.0001 * params.raycasters.speed * deltaTime;
			obj.rotation.z += zDir * 0.0001 * params.raycasters.speed * deltaTime;

			origMesh.updateMatrixWorld();
			origVec.setFromMatrixPosition( origMesh.matrixWorld );
			dirVec.copy( origVec ).multiplyScalar( - 1 ).normalize();

			raycaster.set( origVec, dirVec );
			raycaster.firstHitOnly = true;
			const res = raycaster.intersectObject( containerObj, true );
			const length = res.length ? res[ 0 ].distance : pointDist;

			hitMesh.position.set( pointDist - length, 0, 0 );

			cylinderMesh.position.set( pointDist - ( length / 2 ), 0, 0 );
			cylinderMesh.scale.set( 1, length, 1 );

			cylinderMesh.rotation.z = Math.PI / 2;

		},

		remove: () => {

			scene.remove( obj );

		}
	} );

}

function updateFromOptions() {

	// Update raycaster count
	while ( rayCasterObjects.length > params.raycasters.count ) {

		rayCasterObjects.pop().remove();

	}

	while ( rayCasterObjects.length < params.raycasters.count ) {

		addRaycaster();

	}

	if ( ! geometry ) {

		return;

	}

	// Update whether or not to use the bounds tree
	if (
		! params.mesh.useBoundsTree && geometry.boundsTree ||
		geometry.boundsTree && params.mesh.splitStrategy !== geometry.boundsTree.splitStrategy
	) {

		geometry.disposeBoundsTree();

	}

	if ( params.mesh.useBoundsTree && ! geometry.boundsTree ) {

		console.time( 'computing bounds tree' );
		geometry.computeBoundsTree( {
			maxLeafTris: 5,
			strategy: parseFloat( params.mesh.splitStrategy ),
		} );
		geometry.boundsTree.splitStrategy = params.mesh.splitStrategy;
		console.timeEnd( 'computing bounds tree' );

		if ( boundsViz ) {

			boundsViz.update();

		}

	}

	// Update knot count
	const oldLen = knots.length;
	while ( knots.length > params.mesh.count ) {

		containerObj.remove( knots.pop() );

	}

	while ( knots.length < params.mesh.count ) {

		addKnot();

	}

	if ( oldLen !== knots.length ) {

		const lerp = ( a, b, t ) => a + ( b - a ) * t;
		const lerpAmt = ( knots.length - 1 ) / ( 300 - 1 );
		const dist = lerp( 0, 2, lerpAmt );
		const scale = lerp( 1, 0.2, lerpAmt );

		knots.forEach( c => {

			c.scale.set( 1, 1, 1 ).multiplyScalar( scale );

			const vec3 = new THREE.Vector3( 0, 1, 0 );
			vec3.applyAxisAngle( new THREE.Vector3( 1, 0, 0 ), Math.PI * Math.random() );
			vec3.applyAxisAngle( new THREE.Vector3( 0, 1, 0 ), 2 * Math.PI * Math.random() );
			vec3.multiplyScalar( dist );

			c.position.set( vec3.x, vec3.y, vec3.z );

		} );

	}

	// Update bounds viz
	const shouldDisplayBounds = params.mesh.visualizeBounds && geometry.boundsTree;
	if ( boundsViz && ! shouldDisplayBounds ) {

		containerObj.remove( boundsViz );
		boundsViz = null;

	}

	if ( ! boundsViz && shouldDisplayBounds ) {

		boundsViz = new MeshBVHVisualizer( knots[ 0 ] );
		containerObj.add( boundsViz );

	}

	if ( boundsViz ) {

		boundsViz.depth = params.mesh.visualBoundsDepth;
		boundsViz.displayParents = params.mesh.displayParents;
		boundsViz.update();

	}

}

function render() {

	stats.begin();

	const currTime = window.performance.now();
	lastFrameTime = lastFrameTime || currTime;
	deltaTime = currTime - lastFrameTime;

	containerObj.rotation.x += 0.0001 * params.mesh.speed * deltaTime;
	containerObj.rotation.y += 0.0001 * params.mesh.speed * deltaTime;
	containerObj.children.forEach( c => {

		c.rotation.x += 0.0001 * params.mesh.speed * deltaTime;
		c.rotation.y += 0.0001 * params.mesh.speed * deltaTime;

	} );
	containerObj.updateMatrixWorld();

	rayCasterObjects.forEach( f => f.update() );

	renderer.render( scene, camera );

	lastFrameTime = currTime;

	stats.end();

	requestAnimationFrame( render );

}
