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
const pos = new THREE.Vector3();
const rot = new THREE.Quaternion();
const euler = new THREE.Euler();
const sca = new THREE.Vector3();
const addMesh = ( x, y, z, s ) => {

	pos.set( x, y, z );
	euler.set( 0, 0, 0 );
	euler.x = random() * 10;
	euler.y = random() * 10;
	rot.setFromEuler( euler );
	sca.set( s, s, s );
	const obj = {

		index: allChildren.length,
		material: material,
		matrixWorld: new THREE.Matrix4().compose( pos, rot, sca ),
		boundingSphere: geom.boundingSphere.clone(),

		mesh: null,
		raycast( ...args ) {

			return this.mesh && this.mesh.raycast( ...args );

		}

	};

	obj.boundingSphere.applyMatrix4( obj.matrixWorld );
	octree.add( obj );
	allChildren.push( obj );

	return obj;

};

const addMeshes = ( function* addMeshes() {

	const size = 13000;
	const count = 2000000;
	for ( let i = 0; i < count; i ++ ) {

		if ( i % 10000 === 0 ) {

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
	while ( containerObj.children.length < res.length ) {

		const mesh = new THREE.Mesh( geom, material );
		mesh.frustumCulled = false;
		mesh.matrixAutoUpdate = false;
		containerObj.add( mesh );

	}

	while ( containerObj.children.length > res.length ) {

		containerObj.remove( containerObj.children[ 0 ] );

	}

	for ( let i = 0, l = res.length; i < l; i ++ ) {

		const o = res[ i ];
		const c = containerObj.children[ i ];
		c.matrix = o.matrixWorld;
		c.matrixWorld = o.matrixWorld;
		c.material = o.material;
		c.__proxy = o;
		o.mesh = c;

	}


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
// TODO: Use the Octree here for casting, though it's a little slow at the moment
// Hopefully SAH can speed it up.
window.addEventListener( 'mousemove', e => {

	mouse.x = ( e.pageX / window.innerWidth ) * 2 - 1;
	mouse.y = - ( e.pageY / window.innerHeight ) * 2 + 1;

	raycaster.firstHitOnly = true;
	raycaster.setFromCamera( mouse, camera );

	if ( lastHit ) lastHit.material = material;
	lastHit = null;

	const hit = octree.raycastFirst( raycaster );

	if ( hit ) {

		hit.object.__proxy.material = hoverMaterial;
		lastHit = hit.object.__proxy;

	}

}, true );

window.addEventListener( 'resize', resizeFunc, false );
resizeFunc();

const controls = new window.THREE.OrbitControls( camera );

render();


