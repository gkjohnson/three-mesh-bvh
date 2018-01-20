import * as THREE from './node_modules/three/build/three.module.js'
import './lib/ThreeMeshRewrite.js'
import TriangleBoundsTree from './lib/TriangleBoundsTree.js'

THREE.Geometry.prototype.computeBoundsTree = function() {
    this.boundsTree = new TriangleBoundsTree(this);
    return this.boundsTree;
}

THREE.Geometry.prototype.disposeBoundsTree = function() {
    this.boundsTree = null;
}

THREE.BufferGeometry.prototype.computeBoundsTree = function() {
    this.boundsTree = new TriangleBoundsTree(this);
    return this.boundsTree;
}

THREE.BufferGeometry.prototype.disposeBoundsTree = function() {
    this.boundsTree = null;
}