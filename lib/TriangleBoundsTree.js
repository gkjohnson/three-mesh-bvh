import  * as THREE from '../node_modules/three/build/three.module.js'

// Settings
const maxLeafNodes = 10;
const maxMatchingTriangles = 0.5;

// Utilities
const getBufferGeometryVertexElem = (geo, tri, vert, elem) => {
    return geo.attributes.position.array[(geo.index ? geo.index.array[3 * tri + vert] : (3 * tri + vert)) * 3  + elem];
}

// TODO: This function seems significantly slower than
// before when we were had custom bounds functions
const getGeometryVertexElem = (geo, tri, vert, elem) => {
    return geo.vertices[geo.faces[tri][abcFields[vert]]][xyzFields[elem]];
}

const abcFields = ['a', 'b', 'c'];
const xyzFields = ['x', 'y', 'z'];
const getLongestEdgeIndex = bb => {
    let splitDimIdx = -1;
    let splitDist = -Infinity;
    xyzFields.forEach((d, i) => {
        const dist = bb.max[d] - bb.min[d];
        if (dist > splitDist) {
            splitDist = dist;
            splitDimIdx = i;
        }
    });
    return splitDimIdx;
}

// reusable vectors
const avgtemp = new THREE.Vector3();
const vectemp = new THREE.Vector3();
const centemp = new THREE.Vector3();
const bndtemp = new THREE.Box3();

const getAverage = (tris, avg, geo, getValFunc) => {
    avg.set(0, 0, 0);

    for (let i = 0; i < tris.length; i ++) {
        const tri = tris[i];

        for (let v = 0; v < 3; v ++) {
            avg.x += getValFunc(geo, tri, v, 0);
            avg.y += getValFunc(geo, tri, v, 1);
            avg.z += getValFunc(geo, tri, v, 2);
        }
    }

    avg.x /= tris.length * 3;
    avg.y /= tris.length * 3;
    avg.z /= tris.length * 3;
}

const shrinkBoundsTo = (tris, bounds, geo, getValFunc) => {
    bndtemp.min.x = Infinity;
    bndtemp.min.y = Infinity;
    bndtemp.min.z = Infinity;

    bndtemp.max.x = -Infinity;
    bndtemp.max.y = -Infinity;
    bndtemp.max.z = -Infinity;

    for (let i = 0; i < tris.length; i ++) {
        const tri = tris[i];

        for (let v = 0; v < 3; v ++) {
            const x = getValFunc(geo, tri, v, 0);
            const y = getValFunc(geo, tri, v, 1);
            const z = getValFunc(geo, tri, v, 2);

            vectemp.x = x;
            vectemp.y = y;
            vectemp.z = z;
            bndtemp.expandByPoint(vectemp);
       }
    }

    bounds.min.x = Math.max(bndtemp.min.x, bounds.min.x);
    bounds.min.y = Math.max(bndtemp.min.y, bounds.min.y);
    bounds.min.z = Math.max(bndtemp.min.z, bounds.min.z);

    bounds.max.x = Math.min(bndtemp.max.x, bounds.max.x);
    bounds.max.y = Math.min(bndtemp.max.y, bounds.max.y);
    bounds.max.z = Math.min(bndtemp.max.z, bounds.max.z);
}

const shrinkSphereTo = (tris, sphere, geo, getValFunc) => {
    const center = sphere.center;
    let maxRadiusSq = 0;

    for (let i = 0; i < tris.length; i ++) {
        const tri = tris[i];

        for (let v = 0; v < 3; v ++) {
            const x = getValFunc(geo, tri, v, 0);
            const y = getValFunc(geo, tri, v, 1);
            const z = getValFunc(geo, tri, v, 2);
        
            vectemp.x = x;
            vectemp.y = y;
            vectemp.z = z;

            maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(vectemp));
        }
    }

    sphere.radius = Math.min(sphere.radius, Math.sqrt(maxRadiusSq));
}

// Classes
class TriangleBoundsNode {
    constructor() {
        this.boundingBox = null;
        this.boundingSphere = new THREE.Sphere();
        this.children = [];
        this.tris = [];
    }
}

class TriangleBoundsTree {
    constructor(geo) {
        if (geo.isBufferGeometry || geo.isGeometry) {
            this._root = this._buildTree(geo);
        } else {
            throw new Error('Object is not Geometry or BufferGeometry');
        }
    }

    /* Public API */
    collectCandidates(origray) {
        const candidates = [];
        const recurse = (node, ray) => {

            if (!ray.intersectsSphere(node.boundingSphere) || !ray.intersectsBox(node.boundingBox)) return;
            
            if (node.children.length) node.children.forEach(c => recurse(c, ray))
            else candidates.push(...node.tris)
        }
        recurse(this._root, origray);


        return candidates;
    }

    /* Private Functions */
    _buildTree(geo) {
        const vertexElem = geo.isBufferGeometry ? getBufferGeometryVertexElem : getGeometryVertexElem;

        // a list of every available triangle index
        const origTris =
            geo.isBufferGeometry ? 
                new Array(geo.index ? (geo.index.count / 3) : (pos.length / 9)) :
                Array(geo.faces.length);

        for (let i = 0; i < origTris.length; i ++) origTris[i] = i;

        // SAH poses
        const sahplanes = [new Array(origTris.length * 2), new Array(origTris.length * 2), new Array(origTris.length * 2)];
        for (let i = 0; i < origTris.length; i ++) {
            const tri = origTris[i];
            const tri2 = tri * 2;

            for (let el = 0; el < 3; el ++) {
                let min = Infinity;
                let max = -Infinity;
                for (let v = 0; v < 3; v ++) {
                    const val = vertexElem(geo, tri, v, el);
                    min = Math.min(val, min);
                    max = Math.max(val, max);
                }

                sahplanes[el][tri2 + 0] = { p: min, minSide: true };
                sahplanes[el][tri2 + 1] = { p: max, minSide: false };
            }
        }

        const splitStrategy = (bounds, sphere, avg, tris, geometry) => {
            let axis = -1;
            let pos = 0;

            // Average
            axis = getLongestEdgeIndex(bounds);
            pos = avg[xyzFields[axis]];


            // Center
            axis = getLongestEdgeIndex(bounds);
            const field = xyzFields[axis];
            pos = sphere.center[field];


            // Surface Area Heuristic
            const TRAVERSAL_COST = 5;
            const INTERSECTION_COST = 1;
            const dim = [
                bounds.max.x - bounds.min.x,
                bounds.max.y - bounds.min.y,
                bounds.max.z - bounds.min.z
            ];
            const sa = 2 * (dim[0] * dim[1] + dim[0] * dim[2] + dim[1] * dim[2]);
            
            // xyz axes
            const filtedLists =[[], [], []];
            tris.forEach(t => {
                const t2 = t * 2;

                for (let i = 0; i < 3; i ++) {
                    filtedLists[i].push(sahplanes[i][t2 + 0]);
                    filtedLists[i].push(sahplanes[i][t2 + 1]);
                }
            });
            filtedLists.forEach(planes => planes.sort((a, b) => a.p - b.p));

            let bestCost = Infinity;
            for (let i = 0; i < 3; i ++) {
                const o1 = (i + 1) % 3;
                const o2 = (i + 2) % 3;
                const bmin = bounds.min[xyzFields[i]];
                const bmax = bounds.max[xyzFields[i]];

                const planes = filtedLists[i];
                let nl = 0, nr = tris.length;
                
                for (let p = 0; p < planes.length; p ++) {
                    const pinfo = planes[p];
                    nl += pinfo.minSide ? 1 : 0;
                    nr -= !pinfo.minSide ? 1 : 0;

                    const templ = pinfo.p - bmin;
                    const tempr = bmax - pinfo.p;

                    // TODO: Use the dimensions of the constrained bounds for cost here
                    const sal = 2 * (dim[o1] * dim[o2] + dim[o1] * templ + dim[o2] * templ);
                    const sar = 2 * (dim[o1] * dim[o2] + dim[o1] * tempr + dim[o2] * tempr);
                    const cost = TRAVERSAL_COST + INTERSECTION_COST * ((sal/sa)*nl + (sar/sa)*nr);

                    if (cost < bestCost) {
                        axis = i;
                        pos = pinfo.p;
                        bestCost = cost;
                    }
                }
            }

            const noSplitCost = INTERSECTION_COST * tris.length;
            if (noSplitCost < bestCost) {
                axis = -1;
                pos = 0;
            }

            return { axis, pos };
        }

        // use a queue to run the node creation functions
        // because otherwise we run the risk of a stackoverflow
        // In the case of buffer geometry it also seems to be
        // faster than recursing
        const queue = [];
        const createNode = (tris, bb) => {
            const node = new TriangleBoundsNode();

            // get the bounds of the triangles
            node.boundingBox = bb;

            // Create the bounding sphere with the minium radius
            // It's possible that the bounds sphere will have a smaller
            // radius because the bounds do not encapsulate full triangles
            // on an edge
            node.boundingSphere = new THREE.Sphere();
            bb.getCenter(node.boundingSphere.center);
            node.boundingSphere.radius = vectemp.subVectors(bb.max, node.boundingSphere.center).length();
            shrinkSphereTo(tris, node.boundingSphere, geo, vertexElem);

            // early out wif we've met our capacity
            if (tris.length <= maxLeafNodes) {
                node.tris = tris;
                return node;
            }

            // Find where to split the volume
            getAverage(tris, avgtemp, geo, vertexElem);
            const split = splitStrategy(node.boundingBox, node.boundingSphere, avgtemp, tris, geo);
            if (split.axis === -1) {
                node.tris = tris;
                return node;
            }

            // Collect the nodes for either side
            const left = [], right = [];
            let sharedCount = 0;
            for (let i = 0; i < tris.length; i ++) {
                const tri = tris[i];

                let inLeft = false;
                let inRight = false;

                for (let v = 0; v < 3; v ++) {
                    const val = vertexElem(geo, tri, v, split.axis);

                    inLeft = inLeft || val <= split.pos;
                    inRight = inRight || val >= split.pos;
                }

                if (inLeft) left.push(tri);
                if (inRight) right.push(tri);
                if (inLeft && inRight) sharedCount ++;
            }

            // create the two new child nodes
            if (!left.length || !right.length || right.length === sharedCount || left.length === sharedCount) {
                node.tris = tris;
            } else {
                // create the bounds for the left child, keeping it within
                // the bounds of the parent and split plane
                const bl = new THREE.Box3().copy(bb);
                bl.max[xyzFields[split.axis]] = split.pos;
                shrinkBoundsTo(left, bl, geo, vertexElem);
                queue.push(() => node.children.push(createNode(left, bl)));

                // repeat for right
                const br = new THREE.Box3().copy(bb);
                br.min[xyzFields[split.axis]] = split.pos;
                shrinkBoundsTo(right, br, geo, vertexElem);
                queue.push(() => node.children.push(createNode(right, br)));
            }

            return node;
        }

        if (!geo.boundingBox) geo.computeBoundingBox();

        const n = createNode(origTris, (new THREE.Box3()).copy(geo.boundingBox));
        while (queue.length) queue.pop()();
        return n;
    }
}

export default TriangleBoundsTree;
