import * as THREE from 'three';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { radixSort } from 'three/examples/jsm/utils/SortUtils.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from '..';

THREE.BatchedMesh.prototype.computeBoundsTree = computeBoundsTree;
THREE.BatchedMesh.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BatchedMesh.prototype.raycast = acceleratedRaycast;

let stats, gui, guiStatsEl;
let camera, controls, scene, renderer;
let geometries, mesh, material;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2( 1, 1 );
const ids = [];
const matrix = new THREE.Matrix4();

//

const position = new THREE.Vector3();
const rotation = new THREE.Euler();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const color = new THREE.Color();
const white = new THREE.Color().setHex( 0xffffff );

//

const MAX_GEOMETRY_COUNT = 20000;

const Method = {
	BATCHED: 'BATCHED',
	NAIVE: 'NAIVE'
};

const api = {
	method: Method.BATCHED,
	count: 2,
	dynamic: 16,

	sortObjects: true,
	perObjectFrustumCulled: true,
	opacity: 1,
	useCustomSort: true,
};

init();
initGeometries();
initMesh();

//

function randomizeMatrix(matrix) {

	position.x = Math.random() * 40 - 20;
	position.y = Math.random() * 40 - 20;
	position.z = Math.random() * 40 - 20;

	rotation.x = Math.random() * 2 * Math.PI;
	rotation.y = Math.random() * 2 * Math.PI;
	rotation.z = Math.random() * 2 * Math.PI;

	quaternion.setFromEuler(rotation);

	scale.x = scale.y = scale.z = 0.5 + (Math.random() * 0.5);

	return matrix.compose(position, quaternion, scale);

}

function randomizeRotationSpeed(rotation) {

	rotation.x = Math.random() * 0.01;
	rotation.y = Math.random() * 0.01;
	rotation.z = Math.random() * 0.01;
	return rotation;

}

function initGeometries() {

	geometries = [
		new THREE.TorusKnotGeometry( 1, 0.4, 200, 50 ),
		new THREE.TorusKnotGeometry( 2, 0.8, 400, 100 )
	];

}

function createMaterial() {

	if (!material) {

		material = new THREE.MeshPhongMaterial();

	}

	return material;

}

function cleanup() {

	if (mesh) {

		mesh.parent.remove(mesh);

		if (mesh.dispose) {

			mesh.dispose();

		}

	}

}

function initMesh() {

	cleanup();

	if (api.method === Method.BATCHED) {

		initBatchedMesh();

	} else {

		initRegularMesh();

	}

}

function initRegularMesh() {

	mesh = new THREE.Group();
	const material = createMaterial();

	for (let i = 0; i < api.count; i++) {

		const child = new THREE.Mesh(geometries[i % geometries.length], material);
		randomizeMatrix(child.matrix);
		child.matrix.decompose(child.position, child.quaternion, child.scale);
		child.userData.rotationSpeed = randomizeRotationSpeed(new THREE.Euler());
		mesh.add(child);

	}

	scene.add(mesh);

}

function initBatchedMesh() {

	const geometryCount = api.count;
	// const vertexCount = geometries.length * 512;
	// const indexCount = geometries.length * 1024;

	const euler = new THREE.Euler();
	const matrix = new THREE.Matrix4();
	mesh = new THREE.BatchedMesh(geometryCount, 250000, 500000, createMaterial());
	mesh.userData.rotationSpeeds = [];

	// disable full-object frustum culling since all of the objects can be dynamic.
	mesh.frustumCulled = false;

	ids.length = 0;

	const geometryIds = [
		mesh.addGeometry(geometries[0]),
		mesh.addGeometry(geometries[1]),
	];

	for (let i = 0; i < api.count; i++) {

		const id = mesh.addInstance(geometryIds[i % geometryIds.length]);
		mesh.setMatrixAt(id, randomizeMatrix(matrix));
		mesh.setColorAt(id, white);

		const rotationMatrix = new THREE.Matrix4();
		rotationMatrix.makeRotationFromEuler(randomizeRotationSpeed(euler));
		mesh.userData.rotationSpeeds.push(rotationMatrix);

		ids.push(id);

	}

	scene.add(mesh);

	mesh.computeBoundsTree();

}

function init() {

	const width = window.innerWidth;
	const height = window.innerHeight;

	// camera

	camera = new THREE.PerspectiveCamera(70, width / height, 1, 100);
	camera.position.z = 30;

	// renderer

	renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.setSize(width, height);
	renderer.setAnimationLoop(animate);
	document.body.appendChild(renderer.domElement);

	// scene

	scene = new THREE.Scene();
	scene.background = new THREE.Color('gray');

	// controls

	controls = new OrbitControls(camera, renderer.domElement);
	controls.autoRotate = true;
	controls.autoRotateSpeed = 1.0;

	// lights

	const light = new THREE.HemisphereLight( 0xffffff, 0x888888, 3 );
	light.position.set( 0, 1, 0 );
	scene.add( light );

	// stats

	stats = new Stats();
	document.body.appendChild(stats.dom);

	// gui

	gui = new GUI();
	gui.add(api, 'count', 1, MAX_GEOMETRY_COUNT).step(1).onChange(initMesh);
	gui.add(api, 'dynamic', 0, MAX_GEOMETRY_COUNT).step(1);
	gui.add(api, 'method', Method).onChange(initMesh);
	gui.add(api, 'opacity', 0, 1).onChange(v => {

		if (v < 1) {

			material.transparent = true;
			material.depthWrite = false;

		} else {

			material.transparent = false;
			material.depthWrite = true;

		}

		material.opacity = v;
		material.needsUpdate = true;

	});
	gui.add(api, 'sortObjects');
	gui.add(api, 'perObjectFrustumCulled');
	gui.add(api, 'useCustomSort');

	guiStatsEl = document.createElement('li');
	guiStatsEl.classList.add('gui-stats');

	// listeners

	window.addEventListener('resize', onWindowResize);
	document.addEventListener( 'mousemove', onMouseMove );

}

//

function sortFunction(list) {

	// initialize options
	this._options = this._options || {
		get: el => el.z,
		aux: new Array(this.maxInstanceCount)
	};

	const options = this._options;
	options.reversed = this.material.transparent;

	let minZ = Infinity;
	let maxZ = - Infinity;
	for (let i = 0, l = list.length; i < l; i++) {

		const z = list[i].z;
		if (z > maxZ) maxZ = z;
		if (z < minZ) minZ = z;

	}

	// convert depth to unsigned 32 bit range
	const depthDelta = maxZ - minZ;
	const factor = (2 ** 32 - 1) / depthDelta; // UINT32_MAX / z range
	for (let i = 0, l = list.length; i < l; i++) {

		list[i].z -= minZ;
		list[i].z *= factor;

	}

	// perform a fast-sort using the hybrid radix sort function
	radixSort(list, options);

}

function onWindowResize() {

	const width = window.innerWidth;
	const height = window.innerHeight;

	camera.aspect = width / height;
	camera.updateProjectionMatrix();

	renderer.setSize(width, height);

}

function onMouseMove( event ) {

	event.preventDefault();

	mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
	mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;

}

function animate() {

	animateMeshes();
	
	raycaster.setFromCamera( mouse, camera );

	console.time("raycast");

	const intersection = raycaster.intersectObject( mesh );

	console.timeEnd("raycast");
	
	if ( intersection.length > 0 ) {

		const batchId = intersection[ 0 ].batchId;

		mesh.getColorAt( batchId, color );

		if ( color.equals( white ) ) {

			mesh.setColorAt( batchId, color.setHex( Math.random() * 0xffffff ) );

			// mesh.instanceColor.needsUpdate = true;

		}

	}

	controls.update();
	stats.update();

	render();

}

function animateMeshes() {

	const loopNum = Math.min(api.count, api.dynamic);

	if (api.method === Method.BATCHED) {

		for (let i = 0; i < loopNum; i++) {

			const rotationMatrix = mesh.userData.rotationSpeeds[i];
			const id = ids[i];

			mesh.getMatrixAt(id, matrix);
			matrix.multiply(rotationMatrix);
			mesh.setMatrixAt(id, matrix);

		}

	} else {

		for (let i = 0; i < loopNum; i++) {

			const child = mesh.children[i];
			const rotationSpeed = child.userData.rotationSpeed;

			child.rotation.set(
				child.rotation.x + rotationSpeed.x,
				child.rotation.y + rotationSpeed.y,
				child.rotation.z + rotationSpeed.z
			);

		}

	}

}

function render() {

	if (mesh.isBatchedMesh) {

		mesh.sortObjects = api.sortObjects;
		mesh.perObjectFrustumCulled = api.perObjectFrustumCulled;
		mesh.setCustomSort(api.useCustomSort ? sortFunction : null);

	}

	renderer.render(scene, camera);

}