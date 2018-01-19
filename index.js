import * as THREE from './node_modules/three/build/three.module.js'

const origRaycast = THREE.Mesh.prototype.raycast;

THREE.Mesh.prototype.raycast = function(...args) {
    if (this.geometry.__boundstree) {
        return this.__boundstree.cast(...args)
    }
    
    // check if bounds tree exists and cast against it
    return origRaycast.call(this, ...args);
}

THREE.Geometry.prototype.computeBoundsTree = function() {

}

THREE.Geometry.prototype.disponseBoundsTree = function() {
    this.__boundstree = null;
}

THREE.BufferGeometry.prototype.computeBoundsTree = function() {

}

THREE.BufferGeometry.prototype.disponseBoundsTree = function() {
    this.__boundstree = null;
}