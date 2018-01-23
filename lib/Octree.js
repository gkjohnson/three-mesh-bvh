import * as THREE from '../node_modules/three/build/three.module.js'

const xyzfields = ['x', 'y', 'z'];
const normalvec = xyzfields.map(f => {
    const vec = new Vector3();
    vec[f] = 1;
    return vec;
});

const tempplane = new THREE.Plane();
const tempsphere = new THREE.Sphere();

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

    constructor(root, parent = null) {
        this._octantFlag = -1; 
        this._center = THREE.Vector3();
        this._root = root;
        this._parent = parent;
        this._depth = parent._depth + 1;

        this._objects = [];
        this._nodes = null;
    }

    /* Public API */

    // TODO: we should store the previous sphere so we can
    // easily know when an object has updated and know how to
    // find it again if it's changed
    add(object) {
        if (Array.isArray(object)) {
            object.forEach(o => this.add(o));
            return;
        }

        // TODO: Will we recursively look at children until we find something
        // with a bounding box? Maybe just skip this part?
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

            // Nodes should be inserted into children min / max
            // values of bounds should be used to insert. The object
            // should only be inserted into the intersection of
            // the nodes intersected by the bounds and sphere of
            // the object.


            // update sphere

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

            // find the node it belongs in.
            for (let x = 0; x <= 1; x++) {
                const xf = 1 << 0 + 3 * x;
                if (!(xf & flags)) continue;

                for (let y = 0; y <= 1; y++) {
                    const yf = 1 << 0 + 3 * y;
                    if (!(yf & flags)) continue;
                    
                    for (let z = 0; z <= 1; z++) {
                        const zf = 1 << 0 + 3 * z;
                        if (!(zf & flags)) continue;

                        const octant = xf & yf & zf;
                        let n = this._nodes[octant];
                        if (!n) {
                            n = new OctreeNode(this._root, this);
                            n._octantFlag = octant;
                            this._nodes[octant] = n;
                        }

                        n.add(object);
                    }
                }
            }
        }
    }

    updateAll() {
        this.update(this._objects);
    }

    update(object) {
        if (Array.isArray(object)) {
            object.forEach(o => this.update(o));
            return;
        }

        // TODO: we should check if the position has changed
        // at all before updating the object
        this.remove(object);
        this._root.add(object);
    }

    // TODO: If we knew the previous positon, it would be easier to 
    // find and remove
    // This information could be stored in a wrapper or in map data at
    // the root of the tree
    remove(object) {
        if (Array.isArray(object)) {
            object.forEach(o => this.remove(o));
            return;
        }

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
    // splits this node into children
    _split() {
        const objs = this._objects;
        this._objects = [];

        // If the nodes array exists, then add will
        // insert into the child nodes
        this._nodes = new Array(8);
        this.add(objs);
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
}