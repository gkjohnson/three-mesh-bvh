import * as THREE from '../node_modules/three/build/three.module.js';
import Stats from '../node_modules/stats.js/src/Stats.js';
import OctreeVisualizer from '../lib/OctreeVisualizer.js';
import Octree from '../lib/Octree.js';
import '../index.js';

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
const geom = new THREE.TorusKnotBufferGeometry( 1, 0.4, 40, 10 );
const material = new THREE.MeshPhongMaterial( { color: 0xE91E63 } );

geom.computeBoundingSphere();
geom.computeBoundingBox();
geom.computeBoundsTree();

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
const children = [];

const octree = new Octree();
boundsViz = new OctreeVisualizer( octree );
scene.add( boundsViz );
window.octree = octree;

// Raycast line
const lineMesh = new THREE.Line( new THREE.Geometry(), new THREE.LineBasicMaterial( { color: 0xffffff } ) );
lineMesh.geometry.vertices.push( new THREE.Vector3() );
lineMesh.geometry.vertices.push( new THREE.Vector3() );
lineMesh.frustumCulled = false;
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
	children.push( mesh );
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
	mesh.updateBoundingSphere = () => {

		mesh.boundingSphere.copy( mesh.geometry.boundingSphere );
		mesh.boundingSphere.applyMatrix4( mesh.matrixWorld );

	}

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

	o.updateBoundingSphere();
	octree.add( o );


	return o;

};

let failed = false;
const sphere = new THREE.Mesh( new THREE.SphereBufferGeometry( .1, 10, 10 ), new THREE.MeshBasicMaterial() );
scene.add( sphere );
const setRay = function ( x, y, z, dx, dy, dz ) {

	if ( failed ) return;

	containerObj.rotateX( 0.01 );
	containerObj.updateMatrix( true );
	containerObj.updateMatrixWorld( true );

	children.forEach(c => {

		c.updateBoundingSphere();
		octree.update( c );

	} );
	octree._runObjectActions();


	console.log( 'POSE', `setRay(${ [ ...arguments ].join( ', ' ) })` );

	children.forEach( o => o.material = material );

	const r = new THREE.Ray( new THREE.Vector3( x, y, z ), new THREE.Vector3( dx, dy, dz ).normalize() );
	const rc = new THREE.Raycaster();
	rc.ray.copy( r );


	lineMesh.geometry.vertices[ 0 ].copy( r.origin );
	lineMesh.geometry.vertices[ 1 ].copy( r.origin ).addScaledVector( r.direction.normalize(), 200 );
	lineMesh.geometry.verticesNeedUpdate = true;



	console.time( 'Octtree Raycast' );
	const intersects1 = octree.raycast( rc );
	console.log( intersects1 );
	console.timeEnd( 'Octtree Raycast' );

	console.time( 'THREE Raycast' );
	const intersects2 = rc.intersectObject( containerObj, true );
	console.log( intersects2 );
	console.timeEnd( 'THREE Raycast' );

	const c1 = intersects1 ? intersects1.map( i => i.distance ) : [];
	const c2 = intersects2 ? intersects2.map( i => i.distance ) : [];

	const c1str = c1.join( ',' );
	const c2str = c2.join( ',' );
	const same = c1str === c2str;
	if ( same !== true ) {

		console.log( c1str );
		console.log( c2str );
		failed = true;

		console.error( 'Raycast Failed' );

		boundsViz.parent.remove( boundsViz );

	}

	console.time( 'Octtree RaycastFirst' );
	const intersects3 = [];
	const res = octree.raycastFirst( rc );
	if ( res ) intersects3.push( res );
	console.log( intersects3 );
	console.timeEnd( 'Octtree RaycastFirst' );

	if ( intersects1.length > 0 && intersects3.length > 0 && intersects1[ 0 ].distance !== intersects3[ 0 ].distance ) {

		console.error( 'RaycastFirst is not equal' );
		console.log( intersects1[ 0 ], intersects3[ 0 ] );
		console.log( intersects1[ 0 ].object === intersects3[ 0 ].object );

		children.forEach( c => c.parent.remove( c ) );
		containerObj.add( intersects1[ 0 ].object );
		containerObj.add( intersects3[ 0 ].object );

		boundsViz.parent.remove( boundsViz );
		failed = true;

	}

	sphere.visible = false;
	if ( res ) {

		sphere.position.copy( res.point );
		lineMesh.geometry.vertices[ 1 ].copy( sphere.position );
		sphere.visible = true;

	}


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

scene.add(new THREE.AxesHelper())
let theta = 0;
let phi = 0;

const render = () => {

	theta += 0.01;
	phi += 0.002;

	const x = Math.cos( phi ) * 50;
	const z = Math.sin( phi ) * 50;
	const y = Math.sin( theta ) * 50;

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


