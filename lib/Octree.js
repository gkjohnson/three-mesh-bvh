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

const tempvec = new THREE.Vector3();
const temparr = [];
const raycastDedupeMap = new Map();

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

    raycast(raycaster, intersects) {}

    raycastFirst(raycaster) {}
}


const tempintersects = [];
THREE.Object3D.prototype.raycastFirst = function(raycaster) {
    
    // TODO: Use function for this if available
    tempintersects.length = 0;
    this.raycast(raycaster, tempintersects);
    tempintersects.sort((a, b) => a.distance - b.distance);

    return tempintersects.pop();
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

        this._sortArray = new Array(8).fill(null);
        this._sortArray.forEach((o, i) => this._sortArray[i] = {});
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
    intersectsRay(ray) {
        return (ray.intersectsSphere(this._sphere) || this._sphere.containsPoint(ray.origin)) &&
            (ray.intersectsBox(this._bounds) || this._bounds.containsPoint(ray.origin));
    }

    raycast(raycaster, intersects) {
        if (!this.intersectsRay(raycaster.ray)) return;

        const obj = this._objects;
        for (let i = 0, l = obj.length; i < l; i++) {
            const o = obj[i];
            if (!raycastDedupeMap.has(o)) {
                raycastDedupeMap.set(o, o);
                o.raycast(raycaster, intersects);
            }
        }

        if (this._nodes) {
            const nodes = this._nodes;
            for (let i = 0, l = nodes.length; i < l; i ++) {
                const n = nodes[i];
                if (n) {
                    n.raycast(raycaster, intersects);
                }
            }
        }
    }

    raycastFirst(raycaster) {
        // new approach
        // - if we're in here, it should be expected that its a valid traversal
        // - check the objects in this node
        // - find the octant that the ray starts in and check that
        // - find the next plane hits (if they exist)
        // - because we're assumed to already be inside the node, if we collide
        // with any plane outside the bounds of the node, then it's invalid and
        // we can stop traversing

        // TODO: See if you can remove this check by doing plane
        // intersects and just seeing where the octant to intersect is
        // Fail if outside the width, and select the next octant by seeing
        // if > or < center value
        if (!this.intersectsRay(raycaster.ray)) return;

        const obj = this._objects;

        // descending sort, taking the closest hit
        let closest = null;
        for (let i = 0, l = obj.length; i < l; i ++) {
            const o = obj[i];
            const res = o.raycastFirst(raycaster);
            if (res && (!closest || closest.distance > res.distance)) closest = res;
        }

        if (this._nodes) {
            const nodes = this._nodes;
            const sphere = this._sphere;

            const sortArr = this._sortArray;

            for(let i = 0, l = nodes.length; i < l; i ++) {
                const n = nodes[i];
                const inf = sortArr[i];
                inf.node = n;

                if (n) {
                    tempvec.copy(sphere.center).sub(raycaster.ray.origin);

                    const dist = Math.max(sphere.distanceToPoint(raycaster.ray.origin)) * tempvec.dot(raycaster.ray.direction);
                    inf.dist = dist;
                }
            }

            sortArr.sort((a, b) => a.dist === b.dist ? 0 : a.dist - b.dist)

            for (let i = 0, l = sortArr.length; i < l; i ++) {
                const inf = sortArr[i];
                if (!inf.node || inf.dist < 0) break;

                const res = inf.node.raycastFirst(raycaster);
                if (res && (!closest || res.distance < closest.distance)) {
                    closest = res;
                    break;
                }
            }
        }

        return closest;
    }

    /* Private API */
    _updateBounds() {
        const w2 = this._width / 2;
        tempvec.set(w2, w2, w2);

        // Set up box
        this._bounds.min.copy(this._center).sub(tempvec);
        this._bounds.max.copy(this._center).add(tempvec);

        // Set up sphere
        const len = tempvec.length();
        this._sphere.radius = len;
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

            const prevObjects = this._objects;
            this._objects = [];
            prevObjects.forEach(o => this._add(o));
        }
    }
}

export default
class Octree {

    constructor(width = 64, maxDepth = Infinity, maxObjects = 8, overlapPerc = 0.0) {
        this.root = new OctreeNode(this, null, 0);
        this.root._width = width;
        this.root._updateBounds();

        this._maxDepth = maxDepth;
        this._maxObjects = maxObjects;
        this._overlapPerc = overlapPerc;

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
    raycast(raycaster, intersects) {
        raycastDedupeMap.clear();
        this.root.raycast(raycaster, intersects);
        intersects.sort((a, b) => a.distance - b.distance);
    }

    raycastFirst(...args) {
        return this.root.raycastFirst(...args);
    }

    /* Object Updates */
    add(o) {
        // TODO: Check the bounding box as well when adding
        // for tighting bounding boxes
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

    _runAction(o, ac) {
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

        const update = o => {            
            const sp = this._objectMap.get(o);
            if (sp.equals(o.boundingSphere)) return;

            remove(o, sp);

            // TODO: We need to see if the bounding sphere is _outside_ the current
            // root and expand if it is. In add, too
            sp.copy(o.boundingSphere);
            this._add(o);
        }

        if (ac === 'add') add(o);
        if (ac === 'remove') remove(o);
        if (ac === 'update') update(o);
    }

    _runObjectActions() {
        this._objectActionMap.forEach((ac, o) => this._runAction(o, ac))
        this._objectActionMap.clear();
    }

    /* Root Grow and Shrink */
    _tryShrinkRoot() {
        if (!this.root._nodes || this.root._objects.length) return;

        let nodeCount = 0;
        const node = this.root._nodes.reduce((acc, n) => {
            if (n) nodeCount ++;
            return acc || n;
        });
        
        if (nodeCount === 1) {
            n._parent = null;
            this.root = n;
            this._tryShrinkRoot();
        }
    }
}