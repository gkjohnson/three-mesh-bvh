import  * as THREE from '../node_modules/three/build/three.module.js'

const cube = new THREE.CubeGeometry(1, 1, 1);
const wiremat = new THREE.LineBasicMaterial({ color: 0x00FF88, wireframe: true, wireframeLinewidth: 1, transparent: true, opacity: 0.3 });
const boxGeom = new THREE.Box3Helper().geometry;

console.log();

class MeshBVHVisualizer extends THREE.Object3D {
    constructor(mesh, depth = 10) {
        super();

        this.depth = depth;
        this._oldDepth = -1;
        this._mesh = mesh;
        this._boundsTree = null;

        this.update();
    }

    update() {
        if (this._mesh.geometry.boundsTree !== this._boundsTree || this._oldDepth !== this.depth) {
            this._oldDepth = this.depth;
            this._boundsTree = this._mesh.geometry.boundsTree;

            let requiredChildren = 0;
            if (this._boundsTree) {
                const recurse = (n, d) => {
                    if (d === this.depth) return;

                    if (d === this.depth - 1 || n.children.length === 0) {
                        let m = requiredChildren < this.children.length ? this.children[requiredChildren++] : null;
                        if (!m) {
                            m = new THREE.LineSegments(boxGeom, wiremat);
                            m.raycast = () => [];
                            this.add(m);
                        }
                        n.boundingBox.getCenter(m.position)
                        m.scale.subVectors(n.boundingBox.max, n.boundingBox.min).multiplyScalar(0.5);
                    }
                    n.children.forEach(n => recurse(n, d + 1))
                }

                recurse(this._boundsTree._root, 0);
            }

            while (this.children.length > requiredChildren) this.remove(this.children.pop());
        }

        this.position.copy(this._mesh.position);
        this.rotation.copy(this._mesh.rotation);
        this.scale.copy(this._mesh.scale);
    }
}

export default MeshBVHVisualizer;