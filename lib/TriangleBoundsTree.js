import  * as THREE from '../node_modules/three/build/three.module.js'

// Settings
const maxLeafNodes = 10;
const maxMatchingTriangles = 0.5;

// Utilities
const getBufferGeometryVertexElem = (geo, tri, vert, elem) => {
    return geo.attributes.position.array[(geo.index ? geo.index.array[3 * tri + vert] : (3 * tri + vert)) * 3  + elem];
}

const getGeometryVertexElem = (geo, tri, vert, elem) => {
    return geo.faces[tri][abcFields[vert]][xyzFields[elem]];
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

const getBounds = (tris, bounds, avg, geo, getValFunc) => {
    avg.set(0, 0, 0);

    for (let i = 0; i < tris.length; i ++) {
        const tri = tris[i];

        for (let v = 0; v < 3; v ++) {
            const x = getValFunc(geo, tri, v, 0);
            const y = getValFunc(geo, tri, v, 1);
            const z = getValFunc(geo, tri, v, 2);

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

const getSphere = (tris, sphere, geo, getValFunc) => {
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

        let splitAxis = -1;
        let splitPos = -1;
        const splitStrategy = (bounds, sphere, avg, tris, geometry) => {
            splitAxis = getLongestEdgeIndex(bounds);
            splitPos = avg[xyzFields[splitAxis]];
        }

        // use a queue to run the node creation functions
        // because otherwise we run the risk of a stackoverflow
        // In the case of buffer geometry it also seems to be
        // faster than recursing
        const queue = [];
        const createNode = tris => {
            const node = new TriangleBoundsNode();

            // get the bounds of the triangles
            getBounds(tris, node.boundingBox, avgtemp, geo, vertexElem);
            node.boundingBox.getCenter(node.boundingSphere.center);
            getSphere(tris, node.boundingSphere, geo, vertexElem);

            if (tris.length <= maxLeafNodes) {
                node.tris = tris;
                return node;
            }

            splitStrategy(node.boundingBox, node.boundingSphere, avgtemp, tris, geo);

            const left = [], right = [];
            let sharedCount = 0;
            for (let i = 0; i < tris.length; i ++) {
                const tri = tris[i];

                let inLeft = false;
                let inRight = false;

                for (let v = 0; v < 3; v ++) {
                    const val = vertexElem(geo, tri, v, splitAxis);

                    inLeft = inLeft || val >= splitPos;
                    inRight = inRight || val <= splitPos;
                }

                if (inLeft) left.push(tri);
                if (inRight) right.push(tri);
                if (inLeft && inRight) sharedCount ++;
            }

            if (sharedCount / tris.length >= maxMatchingTriangles) {
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
