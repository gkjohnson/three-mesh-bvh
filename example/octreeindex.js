import * as THREE from '../node_modules/three/build/three.module.js';
import Stats from '../node_modules/stats.js/src/Stats.js';
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

const containerObj = new THREE.Object3D();
const geom = new THREE.TorusKnotBufferGeometry( 1, 0.4, 100, 30 );
const material = new THREE.MeshPhongMaterial( { color: 0xE91E63 } );
const hoverMaterial = new THREE.MeshPhongMaterial( { color: 0xFFC107, emissive: 0xFFC107, emissiveIntensity: 0.5 } );

geom.computeBoundingSphere();
geom.computeBoundingBox();
geom.computeBoundsTree();

scene.add( containerObj );

// camera setup
const camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
camera.position.z = 60;
camera.far = 750;
camera.updateProjectionMatrix();

const sceneFog = new THREE.Fog( 0x263238 / 2, 20, camera.far );

const cameraHelper = new THREE.CameraHelper( camera );
scene.add( cameraHelper );

// stats setup
const stats = new Stats();
document.body.appendChild( stats.dom );

const octree = new Octree();
const allChildren = [];
var seed = 1;
function random() {

	const x = Math.sin( seed ++ ) * 10000;
	return x - Math.floor( x );

}

// Adds a mesh to the scene
const addMesh = ( x, y, z, s ) => {

	const mesh = new THREE.Mesh( geom, material );
	mesh.rotation.x = random() * 10;
	mesh.rotation.y = random() * 10;

	mesh.scale.set( 1, 1, 1 ).multiplyScalar( s );
	mesh.position.set( x, y, z );
	mesh.boundingSphere = mesh.geometry.boundingSphere.clone();

	mesh.updateMatrix();
	mesh.updateMatrixWorld();
	mesh.updateBoundingSphere = () => {

		mesh.boundingSphere.copy( mesh.geometry.boundingSphere );
		mesh.boundingSphere.applyMatrix4( mesh.matrixWorld );

	};

	mesh.updateBoundingSphere();
	octree.add( mesh );
	mesh.frustumCulled = false;
	mesh.matrixAutoUpdate = false;

	allChildren.push( mesh );

	return mesh;

};

const addMeshes = ( function* addMeshes() {

	const size = 10000;
	const count = 1000000;
	for ( let i = 0; i < 1000000; i ++ ) {

		if ( i % 1000 === 0 ) {

			document.getElementById( 'loaded' ).style.width = `${ ( ( i + 1 ) / count ) * 100 }%`;
			yield null;

		}

		addMesh( random() * size - size / 2, random() * size - size / 2, random() * size - size / 2, 5 + random() * 10 );

	}

	document.getElementById( 'loaded' ).remove();

} )();

function addMeshesLoop() {

	const res = addMeshes.next();
	if ( ! res.done ) requestAnimationFrame( addMeshesLoop );

}

function resizeFunc() {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );

	camera2.aspect = el2.clientWidth / el2.clientHeight;
	camera2.updateProjectionMatrix();
	renderer2.setSize( el2.clientWidth, el2.clientHeight );


}


addMeshesLoop();


const renderer2 = new THREE.WebGLRenderer( { antialias: true } );
renderer2.setPixelRatio( window.devicePixelRatio );
renderer2.setClearColor( bgColor, 1 );

const el2 = renderer2.domElement;
el2.setAttribute( 'picture-in-picture', true );
document.body.appendChild( el2 );


const camera2 = new THREE.PerspectiveCamera();
camera2.position.z = 60;
camera2.far = 10000;
camera2.updateProjectionMatrix();
camera2.position.set( 4000, 4000, 4000 );
camera2.lookAt( 0, 0, 0 );

const render = () => {

	stats.begin();

	// Update the camera position
	controls.update();
	camera.updateMatrixWorld();
	camera.updateProjectionMatrix();
	cameraHelper.update();


	// Get the frustum
	const mat = new THREE.Matrix4();
	mat.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );

	const frustum = new THREE.Frustum();
	frustum.setFromMatrix( mat );

	const res = octree.frustumCast( frustum );
	containerObj.remove( ...containerObj.children );
	if ( res && res.length ) containerObj.add( ...res );

	document.getElementById( 'in-frame' ).innerText = `${ res && res.length || 0 } / ${ allChildren.length } meshes in view`;

	// Render the scenes
	scene.fog = sceneFog;
	scene.remove( cameraHelper );
	renderer.render( scene, camera );

	scene.fog = null;
	scene.add( cameraHelper );
	renderer2.render( scene, camera2 );

	stats.end();

	requestAnimationFrame( render );

};

const mouse = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
let lastHit = null;
window.addEventListener( 'mousemove', e => {

	mouse.x = ( e.pageX / window.innerWidth ) * 2 - 1;
	mouse.y = - ( e.pageY / window.innerHeight ) * 2 + 1;

	raycaster.setFromCamera( mouse, camera );

	if ( lastHit ) lastHit.material = material;
	lastHit = null;

	const hit = octree.raycastFirst( raycaster );

	if ( hit ) {

		hit.object.material = hoverMaterial;
		lastHit = hit.object;

	}

} );

window.addEventListener( 'resize', resizeFunc, false );
resizeFunc();

const controls = new window.THREE.OrbitControls( camera );

render();


