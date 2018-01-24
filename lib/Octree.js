import * as THREE from '../node_modules/three/build/three.module.js'

const X_FLAG = 1 << 0;
const Y_FLAG = 1 << 1;
const Z_FLAG = 1 << 2;

const xyzfields = ['x', 'y', 'z'];
const normalvec = xyzfields.map(f => {
    const vec = new Vector3();
    vec[f] = 1;
    return vec;
});

const tempplane = new THREE.Plane();
const tempsphere = new THREE.Sphere();

/* Utilities */
const getSphereOctantFlag = (sphere, center) => {
    let flags = 0;
    xyzfields.forEach((f, i) => {

        // if the sphere intersects the plane, it belongs
        // in both nodes
        const plPos = this._center[f];
        const spPos = tempsphere.center[f];
        tempplane.normal = normalvec[i];
        tempplane.constant = planePos;

        const split = tempplane.intersectsSphere(tempsphere);

        // add to positive node
        if (split || spPos - plPos > 0) {
            flags |= 1 << i;
        }

        // add to negative node
        if (split || spPos - plPos < 0) {
            flats |= 1 << (i + 3);
        }
    });
    return flags;
}

const iterateOverOctants = (flag, cb) => {
    for (let x = 0; x <= 1; x++) {
        const xf = 1 << 0 + 3 * x;
        if (!(xf & flags)) continue;

        for (let y = 0; y <= 1; y++) {
            const yf = 1 << 0 + 3 * y;
            if (!(yf & flags)) continue;
            
            for (let z = 0; z <= 1; z++) {
                const zf = 1 << 0 + 3 * z;
                if (!(zf & flags)) continue;

                cb(xf & yf & zf);
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







class OctreeNode : OctreeObject {

    constructor(root, width, parent = null) {
        this._octantFlag = -1; 
        this._center = THREE.Vector3();
        this._root = root;
        this._parent = parent;
        this._depth = parent._depth + 1;
        this._width = width;

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
        if (!this._nodes && this._objects.length) {
            cb(n);

        } else {
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
            if (this._objects.length >= this._root._maxObjects) {
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
                    n._octantFlag = octant;

                    const w = this._width / 2;
                    n._width = w;
                    n._center.copy(this._center);
                    n._center.x += flags & X_FLAG ? w : -w;
                    n._center.y += flags & Y_FLAG ? w : -w;
                    n._center.z += flags & Z_FLAG ? w : -w;

                    this._nodes[octant] = n;
                }

                n.add(object);
            });

        }
    }

    _remove(object) {
       let removed = false;
        if (this._nodes) {
            this._nodes.forEach((n, octant) => {
                const nr = n.remove(object);
                if(nr && n._objects.length === 0) {
                    this._nodes[octant] = null;
                }
            })

            if (removed) {
                this._tryConsolidate();
            }

            return removed;
        } else {
            const index = this._objects.indexOf(object);
            if (index !== -1) {
                this._objects.splice(index, 1);
                removed = true;
            }
        }
        return removed;
    }

    // splits this node into children
    _split() {
        const objs = this._objects;
        this._objects = [];

        // If the nodes array exists, then add will
        // insert into the child nodes
        this._nodes = new Array(8);
        for (let obj of objs) this.add(obj);
    }

    // reverts this node into the node containing all objects
    // with no children
    _tryConsolidate() {
        const inNodes = this._nodes.reduce((v, it) => v + it ? it._objects.length : 0, 0);
        if (inNodes < this._root._maxObjects) {
            this._nodes.forEach(n => this._objects.push(...n._objects));
            this._nodes = null;
        }
    }

    _iterateOverOctants(flag, cb) {
        for (let x = 0; x <= 1; x++) {
            const xf = 1 << 0 + 3 * x;
            if (!(xf & flags)) continue;

            for (let y = 0; y <= 1; y++) {
                const yf = 1 << 0 + 3 * y;
                if (!(yf & flags)) continue;
                
                for (let z = 0; z <= 1; z++) {
                    const zf = 1 << 0 + 3 * z;
                    if (!(zf & flags)) continue;

                    cb(xf & yf & zf);
                }
            }
        }
    }
}

class Octree extends OctreeNode {

    constructor(depth = Infinity, maxObjects = 8) {
        super(this);
        this._depth = 0;
        this._maxObjects = maxObjects;

        // Store references from obj => prevous sphere
        // so we can dirty check it
        this._objectMap = new WeakMap();
    }

    add(object) {
        this._add(object);

        const sp = object.boundingSphere.clone();
        this._objectMap.set(object, sp);
    }

    update(object) {
        const sp = this._objectMap.get(object);
        if (sp.equals(object.boundingSphere)) return;

        this._search(sp, n => n._remove(object));
        this._add(object);

        sp.copy(object.boundingSphere);
    }

    remove(object) {
        const sp = this._objectMap.get(object);
        if (!sp) return false;

        this._search(sp, n => n._remove(object));
        this._objectMap.delete(object);
        return true;
    }
}