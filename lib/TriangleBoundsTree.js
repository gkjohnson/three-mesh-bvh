import  * as THREE from '../node_modules/three/build/three.module.js'

// Settings
const maxLeafNodes = 10;
const maxMatchingTriangles = 0.5;

// Utilities
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

// for BufferGeometry
const getBoundsBufferGeometry = (tris, bounds, avg, geo) => {
    const pos = geo.attributes.position.array;
    const getVertIndex = geo.index ? (i => geo.index.array[i]) : (i => i);
    avg.set(0, 0, 0);

    for (let i = 0; i < tris.length; i ++) {
        const tri = tris[i];

        for (let v = 0; v < 3; v ++) {
            const vindex = getVertIndex(tri * 3 + v);

            const x = pos[vindex * 3 + 0];
            const y = pos[vindex * 3 + 1];
            const z = pos[vindex * 3 + 2];

            vectemp.x = x;
            vectemp.y = y;
            vectemp.z = z;
            bounds.expandByPoint(vectemp);

            avg.x += x;
            avg.y += y;
            avg.z += z;
        }
    }

    avg.x /= tris.length * 3;
    avg.y /= tris.length * 3;
    avg.z /= tris.length * 3;
}

const getSphereBufferGeometry = (tris, sphere, geo) => {
    const pos = geo.attributes.position.array;
    const getVertIndex = geo.index ? (i => geo.index.array[i]) : (i => i);
    const center = sphere.center;
    let maxRadiusSq = 0;

    for (let i = 0; i < tris.length; i ++) {
        const tri = tris[i];

        for (let v = 0; v < 3; v ++) {
            const vindex = getVertIndex(tri * 3 + v);

            const x = pos[vindex + 0];
            const y = pos[vindex + 1];
            const z = pos[vindex + 2];
        
            vectemp.x = x;
            vectemp.y = y;
            vectemp.z = z;

            maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(vectemp));
        }
    }

    sphere.radius = Math.sqrt(maxRadiusSq);
}

// for Geometry
const getBoundsGeometry = (tris, bounds, avg, geo) => {
    const faces = geo.faces;
    const verts = geo.vertices;

    avg.set(0, 0, 0);

    for (let i = 0; i < tris.length; i ++) {
        const face = faces[tris[i]];
        abcFields.forEach(id => {
            const vert = verts[face[id]];
            bounds.expandByPoint(vert);

            avg.x += vert.x;
            avg.y += vert.y;
            avg.z += vert.z;
        });
    }

    avg.x /= tris.length * 3;
    avg.y /= tris.length * 3;
    avg.z /= tris.length * 3;
}

const getSphereGeometry = (tris, sphere, geo) => {
    const faces = geo.faces;
    const verts = geo.vertices;

    const center = sphere.center;
    let maxRadiusSq = 0;

    for (let i = 0; i < tris.length; i ++) {

        const face = faces[tris[i]];
        abcFields.forEach(id => {
            const vert = verts[face[id]];
            maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(vert));
        });
    }

    sphere.radius = Math.sqrt(maxRadiusSq);
}



// Classes
class TriangleBoundsNode {
    constructor() {
        this.boundingBox = new THREE.Box3();
        this.boundingSphere = new THREE.Sphere();
        this.children = [];
        this.tris = [];
    }
}

class TriangleBoundsTree {
    constructor(geo) {
        if (geo.isBufferGeometry) {
            this._root = this._initBufferGeometry(geo);
        } else if(geo.isGeometry) {
            this._root = this._initGeometry(geo);
        } else {
            throw new Error('Object is not Geometry or BufferGeometry');
        }
    }

    /* Public API */
    collectCandidates(origray) {
        let candidates = [];
        const recurse = (node, ray) => {
            if (!ray.intersectsSphere(node.boundingSphere) || !ray.intersectsBox(node.boundingBox)) return;
            
            if (node.children.length) node.children.forEach(c => recurse(c, ray))
            else candidates.push(...node.tris)
        }
        recurse(this._root, origray);
        return candidates;
    }

    /* Private Functions */
    _initBufferGeometry(geo) {
        // function for retrieving the next vertex index because
        // we may not have array indices
        const getVertIndex = geo.index ? (i => geo.index.array[i]) : (i => i);
        const pos = geo.attributes.position.array;

        // a list of every available triangle index
        const origTris = new Array(geo.index ? (geo.index.count / 3) : (pos.length / 9));
        for (let i = 0; i < origTris.length; i ++) origTris[i] = i;

        // use a queue to run the node creation functions
        // because otherwise we run the risk of a stackoverflow
        // In the case of buffer geometry it also seems to be
        // faster than recursing
        const queue = [];
        const createNode = tris => {
            const node = new TriangleBoundsNode();

            // get the bounds of the triangles
            getBoundsBufferGeometry(tris, node.boundingBox, avgtemp, geo);
            node.boundingBox.getCenter(node.boundingSphere.center);
            getSphereBufferGeometry(tris, node.boundingSphere, geo);

            if (tris.length <= maxLeafNodes) {
                node.tris = tris;
                return node;
            }

            // decide which axis to split on (longest edge)
            const splitDimIdx = getLongestEdgeIndex(node.boundingBox);
            const splitDimStr = xyzFields[splitDimIdx];

            const left = [], right = [], shared = [];
            for (let i = 0; i < tris.length; i ++) {
                const tri = tris[i];

                let inLeft = false;
                let inRight = false;

                for (let v = 0; v < 3; v ++) {
                    const vindex = getVertIndex(tri * 3 + v);

                    // get the vertex value along the
                    // given axis
                    const val = pos[vindex * 3 + splitDimIdx];

                    inLeft = inLeft || val >= avgtemp[splitDimStr];
                    inRight = inRight || val <= avgtemp[splitDimStr];
                }

                if (inLeft && inRight) shared.push(tri);
                if (inLeft) left.push(tri);
                if (inRight && !inLeft) right.push(tri);
            }

            if (shared.length / tris.length >= maxMatchingTriangles) {
                node.tris = tris;
            } else {
                if (left.length)    queue.push(() => node.children.push(createNode(left)));
                if (right.length)   queue.push(() => node.children.push(createNode(right)));
            }

            return node;
        }

        const n = createNode(origTris);
        while (queue.length) queue.pop()();
        return n;
    }

    _initGeometry(geo) {
        const faces = geo.faces;
        const verts = geo.vertices;

        // a list of every available triangle index
        const origTris = new Array(faces.length);
        for (let i = 0; i < origTris.length; i ++) origTris[i] = i;

        // use a queue to run the node creation functions
        // because otherwise we run the risk of a stackoverflow
        const queue = [];
        const createNode = tris => {
            const node = new TriangleBoundsNode();

            // Calculate the bounds
            getBoundsGeometry(tris, node.boundingBox, avgtemp, geo);
            node.boundingBox.getCenter(node.boundingSphere.center);
            getSphereGeometry(tris, node.boundingSphere, geo);

            if (tris.length <= maxLeafNodes) {
                node.tris = tris;
                return node;
            }

            // decide which axis to split on (longest edge)
            const splitDimIdx = getLongestEdgeIndex(node.boundingBox);
            const splitDimStr = xyzFields[splitDimIdx];

            const left = [], right = [], shared = [];
            for (let i = 0; i < tris.length; i ++) {
                const tri = tris[i];
                const face = faces[tri];
                let inLeft = false;
                let inRight = false;

                abcFields.forEach(id => {
                    const vert = verts[face[id]];
                    const val = vert[splitDimStr];

                    inLeft = inLeft || val >= avgtemp[splitDimStr];
                    inRight = inRight || val <= avgtemp[splitDimStr];
                });

                if (inLeft && inRight) shared.push(tri);
                if (inLeft) left.push(tri);
                if (inRight && !inLeft) right.push(tri);
            }

            if (shared.length / tris.length >= maxMatchingTriangles) {
                node.tris = tris;
            } else {
                if (left.length)    queue.push(() => node.children.push(createNode(left)));
                if (right.length)   queue.push(() => node.children.push(createNode(right)));
            }
            return node;
        }

        const n = createNode(origTris);
        while (queue.length) queue.pop()();
        return n;
    }
}

export default TriangleBoundsTree;
