import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from '../src';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;
// raycaster.far = 0.1;

const radius = 10;
const tube = 0.4;
const tubularSegments = 400;
const radialSegments = 100;
const geometry = new THREE.TorusKnotGeometry(radius, tube, tubularSegments, radialSegments);
geometry.computeBoundsTree();
const knot = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());

const testCount = 500000;
const testCases = new Array(testCount);

const distanceFromCenter = 25;
const knotCenter = new THREE.Vector3(0, 0, 0);

function mulberry32(a) {
	let t = a += 0x6D2B79F5;
	t = Math.imul(t ^ t >>> 15, t | 1);
	t ^= t + Math.imul(t ^ t >>> 7, t | 61);
	return ((t ^ t >>> 14) >>> 0) / 4294967296;
}

for (let i = 0; i < testCount; i++) {

	const rand1 = mulberry32(i);
	const rand2 = mulberry32(i + testCount);

	const rayOrigin = new THREE.Vector3().setFromSphericalCoords(distanceFromCenter, rand1 * Math.PI * 2, rand2 * Math.PI * 2);
	const rayDir = new THREE.Vector3().subVectors(knotCenter, rayOrigin).normalize();

	const testCase = { o: rayOrigin, d: rayDir };

	testCases[i] = testCase;
}

for (let j = 0; j < 20; j++) {

	console.time("raycasting");

	for (let i = 0; i < testCount; i++) {

		const testCase = testCases[i];

		raycaster.set(testCase.o, testCase.d);

		raycaster.intersectObject(knot, false);

	}

	console.timeEnd("raycasting");
}
