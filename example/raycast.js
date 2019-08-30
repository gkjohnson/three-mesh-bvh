import Stats from '../node_modules/stats.js/src/Stats.js';
import * as dat from 'dat.gui';
import * as THREE from '../node_modules/three/build/three.module.js';
import MeshBVHVisualizer from '../src/MeshBVHVisualizer.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, CENTER, SAH, AVERAGE } from '../src/index.js';
import "@babel/polyfill";

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const bgColor = 0x263238 / 2;

// renderer setup
const renderer = new THREE.WebGLRenderer( { antialias: true } );
renderer.setPixelRatio( window.devicePixelRatio );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setClearColor( bgColor, 1 );
document.body.appendChild( renderer.domElement );

// scene setup
const scene = new THREE.Scene();
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

let boundsViz = null;
const containerObj = new THREE.Object3D();
const knotGeometry = new THREE.TorusKnotBufferGeometry( radius, tube, tubularSegments, radialSegments );
// const knotGeometry = new THREE.TorusKnotGeometry(radius, tube, tubularSegments, radialSegments);
const material = new THREE.MeshPhongMaterial( { color: 0xE91E63 } );
containerObj.scale.multiplyScalar( 10 );
scene.add( containerObj );

// camera setup
const camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
camera.position.z = 40;
camera.far = 100;
camera.updateProjectionMatrix();

// stats setup
const stats = new Stats();
document.body.appendChild( stats.dom );

// Create ray casters in the scene
const rayCasterObjects = [];
const raycaster = new THREE.Raycaster();
const sphere = new THREE.SphereGeometry( 0.25, 20, 20 );
const cylinder = new THREE.CylinderGeometry( 0.02, 0.02 );
const pointDist = 25;

const knots = [];
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
		speed: 1,
		visualBoundsDepth: 10
	}
};

// Delta timer
let lastFrameTime = null;
let deltaTime = 0;

const addKnot = () => {

	const mesh = new THREE.Mesh( knotGeometry, material );
	mesh.rotation.x = Math.random() * 10;
	mesh.rotation.y = Math.random() * 10;
	knots.push( mesh );
	containerObj.add( mesh );

};

const addRaycaster = () => {

	// Objects
	const obj = new THREE.Object3D();
	const material = new THREE.MeshBasicMaterial( { color: 0xffffff } );
	const origMesh = new THREE.Mesh( sphere, material );
	const hitMesh = new THREE.Mesh( sphere, material );
	hitMesh.scale.multiplyScalar( 0.5 );

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

	// reusable vectors
	const origVec = new THREE.Vector3();
	const dirVec = new THREE.Vector3();
	const xDir = ( Math.random() - 0.5 );
	const yDir = ( Math.random() - 0.5 );
	rayCasterObjects.push( {
		update: () => {

			obj.rotation.x += xDir * 0.0001 * params.raycasters.speed * deltaTime;
			obj.rotation.y += yDir * 0.0001 * params.raycasters.speed * deltaTime;

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

};

const updateFromOptions = () => {

	// Update raycaster count
	while ( rayCasterObjects.length > params.raycasters.count ) {

		rayCasterObjects.pop().remove();

	}

	while ( rayCasterObjects.length < params.raycasters.count ) {

		addRaycaster();

	}

	// Update whether or not to use the bounds tree
	if (
		! params.mesh.useBoundsTree && knotGeometry.boundsTree ||
		knotGeometry.boundsTree && params.mesh.splitStrategy !== knotGeometry.boundsTree.splitStrategy
	) {

		knotGeometry.disposeBoundsTree();

	}

	if ( params.mesh.useBoundsTree && ! knotGeometry.boundsTree ) {

		console.time( 'computing bounds tree' );
		knotGeometry.computeBoundsTree( { strategy: params.mesh.splitStrategy } );
		knotGeometry.boundsTree.splitStrategy = params.mesh.splitStrategy;
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
	const shouldDisplayBounds = params.mesh.visualizeBounds && knotGeometry.boundsTree;
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

	}

};

containerObj.rotation.x = 10.989999999999943;
containerObj.rotation.y = 10.989999999999943;
const render = () => {

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

	if ( boundsViz ) boundsViz.update();

	rayCasterObjects.forEach( f => f.update() );

	renderer.render( scene, camera );

	lastFrameTime = currTime;

	stats.end();

	requestAnimationFrame( render );

};

// Run
const gui = new dat.GUI();
const rcFolder = gui.addFolder( 'Raycasters' );
rcFolder.add( params.raycasters, 'count' ).min( 1 ).max( 500 ).step( 1 ).onChange( () => updateFromOptions() );
rcFolder.add( params.raycasters, 'speed' ).min( 0 ).max( 20 );
rcFolder.open();

const meshFolder = gui.addFolder( 'Mesh' );
meshFolder.add( params.mesh, 'splitStrategy', { 'CENTER': CENTER, 'SAH': SAH, 'AVERAGE': AVERAGE } ).onChange( () => updateFromOptions() );
meshFolder.add( params.mesh, 'count' ).min( 1 ).max( 300 ).step( 1 ).onChange( () => updateFromOptions() );
meshFolder.add( params.mesh, 'useBoundsTree' ).onChange( () => updateFromOptions() );
meshFolder.add( params.mesh, 'speed' ).min( 0 ).max( 20 );
meshFolder.add( params.mesh, 'visualizeBounds' ).onChange( () => updateFromOptions() );
meshFolder.add( params.mesh, 'visualBoundsDepth' ).min( 1 ).max( 40 ).step( 1 ).onChange( () => updateFromOptions() );
meshFolder.open();

window.addEventListener( 'resize', function () {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	renderer.setSize( window.innerWidth, window.innerHeight );

}, false );

updateFromOptions();
render();
