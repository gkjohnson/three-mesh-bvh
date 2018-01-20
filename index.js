import * as THREE from './node_modules/three/build/three.module.js'
import TriangleBoundsTree from './TriangleBoundsTree.js'

const origRaycast = THREE.Mesh.prototype.raycast;

THREE.Mesh.prototype.raycast = function(...args) {
    
    // check if bounds tree exists and cast against it
    if (!this.geometry.__boundstree || this.geometry.morphTargets.length) {
        return origRaycast.call(this, ...args);
    } else {
        return this.__boundstree.cast(...args)
    }

    
}

THREE.Geometry.prototype.computeBoundsTree = function() {
    this.__boundstree = new TriangleBoundsTree(this);
}

THREE.Geometry.prototype.disponseBoundsTree = function() {
    this.__boundstree = null;
}

THREE.BufferGeometry.prototype.computeBoundsTree = function() {
    this.__boundstree = new TriangleBoundsTree(this);
}

THREE.BufferGeometry.prototype.disponseBoundsTree = function() {
    this.__boundstree = null;
}