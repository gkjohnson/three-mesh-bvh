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
const raycastarr = [{}, {}, {}];

const tempplane = new THREE.Plane();
const tempsphere = new THREE.Sphere();
const tempvec = new THREE.Vector3();
const tempvec2 = new THREE.Vector3();
const tempbox = new THREE.Box3();

/* Utilities */
// returns whether or not the provided range is within
// the give min max bounds
const isInside = (middle, range, min, max) => {
    return middle - min > range && max - middle > range;
}

const getOctantFlag = (spPos, radius, centPos, i, width, overlapPerc) => {
    let flags = 0;
    
    const w2 = width / 2;
    const margin = w2 * overlapPerc;
    const negmin = centPos - w2 - margin;
    const negmax = centPos + margin;

    const posmin = centPos - margin;
    const posmax = centPos + w2 + margin;

    // checks if the sphere is within given min max ranges (edges of the bounds)
    const inNeg = isInside(spPos, radius, negmin, negmax);
    const inPos = isInside(spPos, radius, posmin, posmax);

    if (inPos) flags |= 1 << i;
    if (inNeg) flags |= 1 << (i + 3);

    return flags;
}

// asks for where the next octant to place the sphere in within a node
// about "center" with width "width"
const getSphereOctantFlag = (sphere, center, width, overlapPerc) => {
    // if any of the planes doesn't fully contain the
    // object, then it can't be put in any cell
    const xflags = getOctantFlag(sphere.center.x, sphere.radius, center.x, 0, width, overlapPerc);
    if (xflags === 0) return 0;

    const yflags = getOctantFlag(sphere.center.y, sphere.radius, center.y, 1, width, overlapPerc);
    if (yflags === 0) return 0;

    const zflags = getOctantFlag(sphere.center.z, sphere.radius, center.z, 2, width, overlapPerc);
    if (zflags === 0) return 0;

    return xflags | yflags | zflags;
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

                let octant = 0;
                if (x === 0) octant |= X_FLAG;
                if (y === 0) octant |= Y_FLAG;
                if (z === 0) octant |= Z_FLAG;

                cb(octant);
            }
        }
    }
}

/* Classes */
class OctreeObject {

    constructor() {
        this.boundingSphere = new THREE.Sphere();
    }

    raycastAll(raycaster, intersects) {

    }

    raycast(raycaster) {

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
        this._width = 0;

        this._objects = [];
        this._nodes = null;
    }

    /* Public API */
    raycast(raycaster, intersects) {
        const w2 = this._width / 2;
        tempvec2.set(w2, w2, w2);
        tempbox.min.copy(this._center).sub(tempvec2);
        tempbox.max.copy(this._center).add(tempvec2);

        if (!ray.intersectsBox(tempbox)) return;

        this._objects.forEach(o => {
            o.raycast(raycaster, intersects)
        })

        if (this._nodes) this._nodes.forEach(n => n && n.raycast(raycaster, ray, intersects));
    }

    raycastFirst(raycaster) {
        // TODO: Order, intersect, and take the first hit

        const w2 = this._width / 2;
        tempvec2.set(w2, w2, w2);
        tempbox.min.copy(this._center).sub(tempvec2);
        tempbox.max.copy(this._center).add(tempvec2);

        if (!ray.intersectsBox(tempbox)) return;

        if (this._nodes) this._nodes.forEach(n => n && n.raycast(raycaster, ray));
    }

    /* Private API */
    _search(sphere, cb) {
        if (this._objects.length) cb(this);

        if(this._nodes) {
            const flags = getSphereOctantFlag(sphere, this._center, this._width, this._root._overlapPerc);

            iterateOverOctants(flags, octant => {
                const n = this._nodes && this._nodes[octant];
                if (n) n._search(sphere, cb);
            })
        }
    }

    _add(object) {
        if (!object.boundingSphere) throw new Error('Object has no boundingSphere', object);
        
        // insert into appropriate children
        const flags = getSphereOctantFlag(object.boundingSphere, this._center, this._width, this._root._overlapPerc);
        if (flags === 0 || this._root._maxDepth === this._depth) {
            this._objects.push(object); 
        } else {
            // find the node it belongs in.
            iterateOverOctants(flags, octant => {
                let n = this._nodes && this._nodes[octant];

                if (!n) {
                    this._nodes = this._nodes || new Array(8);
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
        const index = this._objects.indexOf(object);
        if (index !== -1) {
            this._objects.splice(index, 1);
            if (this._objects.length === 0 && !this._nodes) {
                this._root._addJob(() => this._tryConsolidate());
            }
            return true;
        }
        return false;
    }

    // reverts this node into the node containing all objects
    // with no children
    _tryConsolidate() {
        if (this._nodes) {

            let inNodes = 0;
            this._nodes.forEach((n, i) => {
                if (!n) return;

                if (n._objects.length === 0 && !n._nodes) {
                    this._nodes[i] = null;
                } else {
                    inNodes += n._objects.length;
                    inNodes ++;
                }
            })
            if (inNodes === 0) this._nodes = null;
        }
        if (this._parent && this._objects.length === 0 && this._nodes === null) this._parent._tryConsolidate();
    }
}

export default
class Octree extends OctreeNode {

    constructor(depth = Infinity, maxObjects = 8, overlapPerc = 0.15) {
        super(null);
        this._root = this;
        this._depth = 0;
        this._maxDepth = 20;
        this._maxObjects = maxObjects;
        this._overlapPerc = 0.1 //0.15;// 0.15;

        // Store references from obj => prevous sphere
        // so we can dirty check it
        this._objectMap = new Map();

        this._width = 45;

        this._jobs = [];
    }

    add(object) {
        if (this._objectMap.get(object)) {
            this.update(object);
            return;
        }

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

        this._runJobs();

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