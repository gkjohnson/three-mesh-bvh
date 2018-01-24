import * as THREE from '../node_modules/three/build/three.module.js'
// https://geidav.wordpress.com/2014/07/18/advanced-octrees-1-preliminaries-insertion-strategies-and-max-tree-depth/

const X_FLAG = 1 << 0;
const Y_FLAG = 1 << 1;
const Z_FLAG = 1 << 2;

const xyzfields = ['x', 'y', 'z'];
const normalvec = xyzfields.map(f => {
    const vec = new THREE.Vector3();
    vec[f] = 1;
    return vec;
});

const tempplane = new THREE.Plane();
const tempsphere = new THREE.Sphere();

/* Utilities */
const getOctantFlag = (sphere, center, f, i) => {
    let flags = 0;
    
    // if the sphere intersects the plane, it belongs
    // in both nodes
    const plPos = center[f];
    const spPos = sphere.center[f];
    const dist = Math.abs(spPos - plPos);
    const split = dist < sphere.radius;

    // add to positive node
    if (split || spPos - plPos > 0) {
        flags |= 1 << i;
    }

    // add to negative node
    if (split || spPos - plPos < 0) {
        flags |= 1 << (i + 3);
    }
    return flags;
}

const getSphereOctantFlag = (sphere, center) => {
    const res =
        getOctantFlag(sphere, center, 'x', 0) |
        getOctantFlag(sphere, center, 'y', 1) |
        getOctantFlag(sphere, center, 'z', 2);
    return res;
}

const iterateOverOctants = (flags, cb) => {
    for (let x = 0; x <= 1; x++) {
        const xf = 1 << (0 + 3 * x);
        if (!(xf & flags)) continue;

        for (let y = 0; y <= 1; y++) {
            const yf = 1 << (1 + 3 * y);
            if (!(yf & flags)) continue;
            
            for (let z = 0; z <= 1; z++) {
                const zf = 1 << (2 + 3 * z);
                if (!(zf & flags)) continue;

                let res = 0;
                if (x === 0) res |= X_FLAG;
                if (y === 0) res |= Y_FLAG;
                if (z === 0) res |= Z_FLAG;

                cb(res);
            }
        }
    }
}


class OctreeObject {

    constructor() {
        this.boundingSphere = new THREE.Sphere();
    }

    raycastAll(raycaster, ray, intersects) {

    }

    raycast(ray, intersects) {

    }
}







class OctreeNode extends OctreeObject {

    constructor(root, parent = null) {
        super();

        this._octant = -1; 
        this._center = new THREE.Vector3();
        this._root = root;
        this._parent = parent;
        this._depth = parent ? parent._depth + 1 : 0;
        this._width = parent ? parent._width / 2 : 1;

        this._objects = [];
        this._nodes = null;
    }

    // raycasting
    raycastAll(raycaster, ray, intersects) {
        // ray casting can only traverse, at most, four child
        // nodes below any given node. 
        // - After crossing the _first_ plane, the three other nodes
        // on the first side of the plane won't be traversed
        // - After crossing the next plane, the other node on that
        // side of the plane won't traversed
        // - That leaves one more plane and one more node to be
        // traversed once passing the final plane
        // 8 - 3 - 1 = 4

        // traverse starting node based on ray origin

        // sort the remaining planes to know which nodes to cross next
        // skipping nodes with negative distance intesections

        // if no child nodes are present, raycast against all children
    }

    raycast(raycaster, ray) {

    }

    /* Private API */
    _search(sphere, cb) {
        if (this._objects.length) {
            cb(this);

        } else if(this._nodes) {
            const flags = getSphereOctantFlag(sphere, this._center);

            iterateOverOctants(flags, octant => {
                const n = this._nodes[octant];
                if (n) n._search(sphere, cb);
            })
        }
    }

    _add(object) {
        if (!object.boundingSphere) {
            throw new Error('Object has no boundingSphere', object);
        }

        if (!this._nodes) {
            this._objects.push(object);
            if (this._depth !== this._root._maxDepth && this._objects.length >= this._root._maxObjects) {
               this._split();
            }
        } else {
            // insert into appropriate children
            const flags = getSphereOctantFlag(object.boundingSphere, this._center);

            // find the node it belongs in.
            iterateOverOctants(flags, octant => {
                let n = this._nodes[octant];

                if (!n) {
                    n = new OctreeNode(this._root, this);
                    n._octant = octant;

                    const w = this._width / 2;
                    const c = w / 2;
                    n._width = w;
                    n._depth = this._depth + 1;
                    n._center.copy(this._center);
                    n._center.x += octant & X_FLAG ? c : -c;
                    n._center.y += octant & Y_FLAG ? c : -c;
                    n._center.z += octant & Z_FLAG ? c : -c;

                    this._nodes[octant] = n;
                }

                n._add(object);
            });

        }
    }

    _remove(object) {
        let removed = false;
        const index = this._objects.indexOf(object);
        if (index !== -1) {
            this._objects.splice(index, 1);
            this._root._addJob(() => this._parent && this._parent._tryConsolidate());
            return true;
        }
        return false;
    }

    // splits this node into children
    _split() {
        const objs = this._objects;
        this._objects = [];

        // If the nodes array exists, then add will
        // insert into the child nodes
        this._nodes = new Array(8);
        for (let obj of objs) this._add(obj);
    }

    // reverts this node into the node containing all objects
    // with no children
    _tryConsolidate() {
        if (!this._nodes) return;

        const inNodes = this._nodes.reduce((v, it) => v + it ? it._objects.length : 0, 0);
        if (inNodes < this._root._maxObjects) {
            this._nodes.forEach(n => {
                n._objects.forEach(o => {
                    if (this._objects.indexOf(o) === -1) this._objects.push(o);
                })
            });
            this._nodes = null;
        }
        if (this._parent) this._parent._tryConsolidate();
    }
}

export default
class Octree extends OctreeNode {

    constructor(depth = Infinity, maxObjects = 8) {
        super(null);
        this._root = this;
        this._depth = 0;
        this._maxDepth = 8;
        this._maxObjects = maxObjects;

        // Store references from obj => prevous sphere
        // so we can dirty check it
        this._objectMap = new Map();

        this._width = 45;

        this._jobs = [];
    }

    add(object) {
        this._add(object);

        const sp = object.boundingSphere.clone();
        this._objectMap.set(object, sp);

        // TODO: See if the root needs to grow
    }

    update(object) {
        const sp = this._objectMap.get(object);
        if (sp.equals(object.boundingSphere)) return;

        this._search(sp, n => n._remove(object));
        this._add(object);

        sp.copy(object.boundingSphere);

        // TODO: See if the root needs to grow or shrink
    }

    remove(object) {
        const sp = this._objectMap.get(object);
        if (!sp) return false;

        this._search(sp, n => n._remove(object));
        this._objectMap.delete(object);

        this._runJobs();

        // TODO: See if the root needs to shrink
        return true;
    }

    removeAll() {
        while (this._objectMap.size) {
            this.remove(this._objectMap.keys().next().value);
        }

        this._runJobs();
    }

    _addJob(job) { this._jobs.push(job); }
    _runJobs(job) { while (this._jobs.length) this._jobs.pop()(); }
}