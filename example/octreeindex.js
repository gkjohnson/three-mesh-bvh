import * as THREE from '../node_modules/three/build/three.module.js';
import Stats from '../node_modules/stats.js/src/Stats.js';
import OctreeVisualizer from '../lib/OctreeVisualizer.js';
import Octree from '../lib/Octree.js';

const bgColor = 0x263238 / 2;

// renderer setup
const renderer = new THREE.WebGLRenderer( { antialias: true } );
renderer.setPixelRatio( window.devicePixelRatio );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setClearColor( bgColor, 1 );
document.body.appendChild( renderer.domElement );

// scene setup
const scene = new THREE.Scene();
const light = new THREE.DirectionalLight( 0xffffff, 0.5 );
light.position.set( 1, 1, 1 );
scene.add( light );
scene.add( new THREE.AmbientLight( 0xffffff, 0.4 ) );

let boundsViz = null;
const containerObj = new THREE.Object3D();
const geom = new THREE.SphereBufferGeometry( 1, 30, 30 );
const material = new THREE.MeshPhongMaterial( { color: 0xE91E63 } );

scene.add( containerObj );

// camera setup
const camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
camera.position.z = 60;
camera.far = 1000;
camera.updateProjectionMatrix();

// stats setup
const stats = new Stats();
document.body.appendChild( stats.dom );

// Delta timer
let lastFrameTime = null;
let deltaTime = 0;
const knots = [];

const octree = new Octree();
boundsViz = new OctreeVisualizer( octree );
scene.add( boundsViz );
window.octree = octree;

// Raycast line
const lineMesh = new THREE.Line( new THREE.Geometry(), new THREE.LineBasicMaterial( { color: 0xffffff } ) );
lineMesh.geometry.vertices.push( new THREE.Vector3() );
lineMesh.geometry.vertices.push( new THREE.Vector3() );
scene.add( lineMesh );

var seed = 1;
function random() {

	const x = Math.sin( seed ++ ) * 10000;
	return x - Math.floor( x );

}

// Adds a mesh to the scene
const addMesh = () => {

	const mesh = new THREE.Mesh( geom, material );
	mesh.rotation.x = random() * 10;
	mesh.rotation.y = random() * 10;
	knots.push( mesh );
	containerObj.add( mesh );

	const dist = random() * 40 - 20;
	const scale = random() * 7.5 + 2.5;
	mesh.scale.set( 1, 1, 1 ).multiplyScalar( scale );

	const vec3 = new THREE.Vector3( 0, 1, 0 );
	vec3.applyAxisAngle( new THREE.Vector3( 1, 0, 0 ), Math.PI * random() );
	vec3.applyAxisAngle( new THREE.Vector3( 0, 1, 0 ), 2 * Math.PI * random() );
	vec3.multiplyScalar( dist );

	mesh.position.set( vec3.x, vec3.y, vec3.z );

	mesh.updateMatrix();
	mesh.updateMatrixWorld();

	mesh.geometry.computeBoundingSphere();
	mesh.geometry.computeBoundingBox();
	mesh.boundingSphere = mesh.geometry.boundingSphere.clone();
	mesh.boundingSphere.applyMatrix4( mesh.matrixWorld );

	return mesh;

};

const addMeshAtLocation = ( x = 0, y = 0, z = 0, s = 10 ) => {

	const o = addMesh();
	o.position.set( x, y, z );
	o.scale.set( 1, 1, 1 ).multiplyScalar( s );

	o.updateMatrix();
	o.updateMatrixWorld();

	o.boundingSphere.copy( o.geometry.boundingSphere );
	o.boundingSphere.applyMatrix4( o.matrixWorld );

	octree.add( o );

	return o;

};

const setRay = function ( x, y, z, dx, dy, dz ) {

	console.log( 'POSE', `setRay(${ [ ...arguments ].join( ', ' ) })` );

	knots.forEach( o => o.material = material );

	const r = new THREE.Ray( new THREE.Vector3( x, y, z ), new THREE.Vector3( dx, dy, dz ).normalize() );
	const rc = new THREE.Raycaster();
	rc.ray.copy( r );

	console.time( 'oct raycast' );
	const intersects = octree.raycast( rc );

	console.log( intersects );
	console.timeEnd( 'oct raycast' );

	console.time( 'OBJ' );
	const res = rc.intersectObject( scene, true );
	console.log( res );
	console.timeEnd( 'OBJ' );

	const c1 = res ? res.map( i => i.distance ) : [];
	const c2 = intersects ? intersects.map( i => i.distance ) : [];

	const c1str = c1.join( ',' );
	const c2str = c2.join( ',' );
	const same = c1str === c2str;
	if ( same !== true ) {

		console.log( c1str );
		console.log( c2str );
		throw 'NOT SAME';

	} else {

		console.log( 'SAME!' );

	}


	lineMesh.geometry.vertices[ 0 ].copy( r.origin );
	lineMesh.geometry.vertices[ 1 ].copy( r.origin ).addScaledVector( r.direction.normalize(), 200 );
	lineMesh.geometry.verticesNeedUpdate = true;

};
window.setRay = setRay;

const arr = [];
for ( let i = 0; i < 10000; i ++ ) {

	arr.push( addMeshAtLocation( random() * 40 - 20, random() * 40 - 20, random() * 40 - 20, random() * 1 ) );


	const o = arr[ i ];
	// o.position.y = Math.sin( i ) * 10;
	// o.position.z = Math.cos( i ) * 10;
	o.updateMatrix();
	o.updateMatrixWorld();
	o.boundingSphere.copy( o.geometry.boundingSphere );
	o.boundingSphere.applyMatrix4( o.matrixWorld );
	octree.update( o );

}

setRay( 30, 30, 30, - 1, - 1, - 1 );

let theta = 0;
let phi = 0;

const render = () => {

	theta += 0.001;
	phi += 0.02;

	const x = Math.cos( phi ) * 30;
	const z = Math.sin( phi ) * 30;
	const y = Math.sin( theta ) * 30;

	setRay( x, y, z, - x, - y, - z );


	controls.update();
	stats.begin();

	const currTime = window.performance.now();
	lastFrameTime = lastFrameTime || currTime;
	deltaTime = currTime - lastFrameTime;

	// containerObj.rotation.x += 0.0001 * options.mesh.speed * deltaTime;
	// containerObj.rotation.y += 0.0001 * options.mesh.speed * deltaTime;
	containerObj.updateMatrixWorld();

	if ( boundsViz ) boundsViz.update();

	renderer.render( scene, camera );

	lastFrameTime = currTime;

	stats.end();

	requestAnimationFrame( render );

};



window.addEventListener( 'resize', function () {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	renderer.setSize( window.innerWidth, window.innerHeight );

}, false );

const controls = new window.THREE.OrbitControls( camera );

render();


