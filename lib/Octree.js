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

class OctreeNode {

    constructor(root, parent, octant) {
        // hierarchy context        
        this._root = root;
        this._parent = parent;
        this._depth = 0;

        // position
        this._center = new THREE.Vector3();
        this._width = 0;
        
        // bounds checkers
        this._bounds = new THREE.Box3();
        this._sphere = new THREE.Sphere();

        this._objects = [];
        this._nodes = null;

        if (parent) {
            const w2 = parent._width / 4;
            this._width = parent._width / 2;
            this._center.copy(parent._center);
            this._center.x += octant & X_FLAG ? w2 : -w2;
            this._center.y += octant & Y_FLAG ? w2 : -w2;
            this._center.z += octant & Z_FLAG ? w2 : -w2;

            this._depth = parent._depth + 1; 
        }

        this._updateBounds();
    }

    /* Public API */
    raycast(raycaster, intersects) {
        // TODO: Verify these compare well with THREEjs' built in
        // raycasting.
        // Use a Map to dedupe unnecessary casts in cases where object
        // are in two nodes

        if (!raycaster.ray.intersectsSphere(this._sphere) || !raycaster.ray.intersectsBox(this._bounds)) return;

        this._objects.forEach(o => {
            o.raycast(raycaster, intersects);
        })

        if (this._nodes) this._nodes.forEach(n => n && n.raycast(raycaster, intersects));
    }

    raycastFirst(raycaster) {
        // TODO: Order, intersect, and take the first hit

        if (!raycaster.ray.intersectsBox(tempbox)) return;

        if (this._nodes) this._nodes.forEach(n => n && n.raycastFirst(raycaster));
    }

    /* Private API */
    _updateBounds() {
        const w2 = this._width / 2;
        tempvec.set(w2, w2, w2);

        // Set up box
        this._bounds.min.copy(this._center).sub(tempvec);
        this._bounds.max.copy(this._center).add(tempvec);

        // Set up sphere
        const mn = this._bounds.min, mx = this._bounds.max;
        const len = Math.max(mx.x - mn.x, mx.y - mn.y, mx.z - mn.z);
        this._sphere.radius = len / 2;
        this._bounds.getCenter(this._sphere.center);
    }

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
        if (this._root._maxDepth === this._depth) {
            this._objects.push(object);
        } else if (!this._nodes) {
            this._objects.push(object);
            this._root._updateNode(this);
        } else {
            const flags = getSphereOctantFlag(object.boundingSphere, this._center, this._width, this._root._overlapPerc);

            if (flags === 0) {
                this._objects.push(object);
            } else {
                // find the node it belongs in.
                iterateOverOctants(flags, octant => {
                    let n = this._nodes && this._nodes[octant];

                    if (!n) {
                        this._nodes = this._nodes || new Array(8);
                        this._nodes[octant] = new OctreeNode(this._root, this, octant);
                        n = this._nodes[octant];
                    }

                    n._add(object);
                });
            }
        }
    }

    _remove(object) {
        const index = this._objects.indexOf(object);
        if (index !== -1) {
            this._objects.splice(index, 1);
            if (this._objects.length === 0 && !this._nodes) {
                this._root._updateNode(this);
            }
            return true;
        }
        return false;
    }

    _tryGrowShrink() {
        this._tryShrink();
        this._tryGrow();
    }

    // reverts this node into the node containing all objects
    // with no children
    _tryShrink() {
        if (this._nodes) {

            let inNodes = 0;
            let neededNodes = 0;
            for (let i = 0; i < this._nodes.length; i ++) {
                const n = this._nodes[i];
                if (!n) continue;

                if (n._nodes) {
                    inNodes = Infinity;
                    break;
                } else {
                    inNodes += n._objects.length;
                }
            }
            if (inNodes <= this._root.maxObjects) {
                this._nodes.forEach(n => n && this._objects.push(...n._objects));
                this._nodes = null;
            }
        }
        if (this._parent && this._objects.length === 0 && this._nodes === null) this._parent._tryShrink();
    }

    _tryGrow() {
        if (!this._nodes && this._objects.length > this._root._maxObjects && this._root._maxDepth !== this._depth) {
            this._nodes = new Array(8);
            this._objects.forEach(o => this._add(o));
        }
    }
}

export default
class Octree {

    constructor(width = 64, maxDepth = Infinity, maxObjects = 8, overlapPerc = 0.15) {
        this.root = new OctreeNode(this, null, 0);
        this.root._width = width;
        this.root._updateBounds();

        this._maxDepth = maxDepth;
        this._maxObjects = maxObjects;
        this._overlapPerc = 0.15;

        // Store references from obj => prevous sphere
        // so we can dirty check it
        this._objectMap = new Map();

        // deferred updated structures
        this._nodeUpdateMap = new Map();
        this._nodeUpdateArr = [];

        this._objectActionMap = new Map();
        this._objectActionArr = [];
    }

    /* Raycasting */
    raycast(...args) { this.root.raycast(...args); }

    raycastFirst(...args) { this.root.raycastFirst(...args); }

    /* Object Updates */
    add(o) {
        this._addObjectAction(o, 'add');
    }

    update(o) {
        this._addObjectAction(o, 'update');
    }

    remove(object) {
        this._addObjectAction(o, 'remove');
    }

    /* Jobs */
    _runNodeUpdates() {
        while (this._nodeUpdateArr.length) this._nodeUpdateArr.pop()._tryGrowShrink();
        this._nodeUpdateMap.clear();
        this._tryShrinkRoot();
    }

    _updateNode(n) {
        if (this._nodeUpdateMap.get(n)) return;
        this._nodeUpdateMap.set(n, n);
        this._nodeUpdateArr.push(n);
    }

    _addObjectAction(object, action) {
        let prevAction = this._objectActionMap.get(object);
        if (!prevAction) {
            const alreadyAdded = this._objectMap.get(object);
            if (alreadyAdded || !alreadyAdded && action === 'add') {
                this._objectActionMap.set(object, action);
            }
        } else if (prevAction === 'add' && action === 'remove') {
            this._objectActionMap.delete(object);
        }
    }

    _runObjectActions() {
        const add = o => {    
            const sp = o.boundingSphere.clone();
            this._objectMap.set(o, sp);
        
            this.root._add(o);
        }

        const remove = (o, sp) => {
            sp = sp || this._objectMap.get(object);

            this.root._search(sp, n => n._remove(object));
            this._objectMap.delete(object);            
        }

        this._objectActionMap.forEach((ac, o) => {
            if (ac === 'add') add(o);
            if (ac === 'remove') remove(o);
            if (ac === 'update') {
                const sp = this._objectMap.get(object);
                if (sp.equals(o.boundingSphere)) return;

                remove(o, sp);

                // TODO: We need to see if the bounding sphere is _outside_ the current
                // root and expand if it is. In add, too
                sp.copy(o.boundingSphere);
                this._add(o);
            }
        })
    }

    /* Root Grow and Shrink */
    _tryShrinkRoot() {
        if (this.root._objects.length) return;

        let nodeCount = 0;
        const node = this.root._nodes.reduce((acc, n) => {
            if (n) nodeCount ++;
            return acc || n;
        });
        
        if (nodeCount === 1) {
            n._parent = null;
            this.root = n;
            this._tryGrowShrink();
        }
    }
}