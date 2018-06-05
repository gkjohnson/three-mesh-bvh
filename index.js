import * as THREE from './node_modules/three/build/three.module.js';
import MeshBVH from './lib/MeshBVH.js';

const ray = new THREE.Ray();
const inverseMatrix = new THREE.Matrix4();
const origRaycast = THREE.Mesh.prototype.raycast;
const origIntersectObject = THREE.Raycaster.prototype.intersectObject;
const origIntersectObjects = THREE.Raycaster.prototype.intersectObjects;

THREE.Mesh.prototype.raycast = function (raycaster, intersects) {

    if (this.geometry.boundsTree) {

        if (this.material === undefined) return;

        inverseMatrix.getInverse(this.matrixWorld);
        ray.copy(raycaster.ray).applyMatrix4(inverseMatrix);

        if (raycaster.firstHitOnly === true) {

            const res = this.geometry.boundsTree.raycastFirst(this, raycaster, ray);
            if (res) intersects.push(res);

        } else {

            let seenFaces = {};
            this.geometry.boundsTree.raycast(this, raycaster, ray, intersects, seenFaces);

        }

    } else {

        origRaycast.call(this, raycaster, intersects);

    }

};

THREE.Raycaster.prototype.intersectObject = function (object, recursive, optionalTarget, firstHitOnly = false) {

    this.firstHitOnly = firstHitOnly;
    return origIntersectObject.call(this, object, recursive, optionalTarget);

};

THREE.Raycaster.prototype.intersectObjects = function (objects, recursive, optionalTarget, firstHitOnly = false) {

    this.firstHitOnly = firstHitOnly;
    return origIntersectObjects.call(this, objects, recursive, optionalTarget);

};

THREE.Geometry.prototype.computeBoundsTree = function (strat) {

    this.boundsTree = new MeshBVH(this, strat);
    return this.boundsTree;

};

THREE.Geometry.prototype.disposeBoundsTree = function () {

    this.boundsTree = null;

};

THREE.BufferGeometry.prototype.computeBoundsTree = function (strat) {

    this.boundsTree = new MeshBVH(this, strat);
    return this.boundsTree;

};

THREE.BufferGeometry.prototype.disposeBoundsTree = function () {

    this.boundsTree = null;

};
