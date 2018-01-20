import  * as THREE from '../node_modules/three/build/three.module.js'

const maxLeafNodes = 50;
const maxMatchingTriangles = 0.5;

const abcFields = ['a', 'b', 'c'];
const xyzFields = ['x', 'y', 'z'];

// reusable vectors
const avgtemp = new THREE.Vector3();
const vectemp = new THREE.Vector3();
const centemp = new THREE.Vector3();

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
            else candidates = [...candidates, ...node.tris];
        }
        recurse(this._root, origray);
        return candidates;
    }

    /* Private Functions */
    _initBufferGeometry(geo) {
        // array of position attributes with vector xyz
        // values as separate elements
        const pos = geo.attributes.position.array;

        // function for retrieving the next vertex index because
        // we may not have array indices
        const getVertIndex = geo.index ? (i => geo.index.array[i]) : (i => i);

        // the list of triangle indices (initialized to 1...n)
        const origTris = new Array(geo.index ? (geo.index.length / 3) : (pos.length / 9));
        for (let i = 0; i < origTris.length; i ++) origTris[i] = i;

        // Sets the bounds object to the aabb that contains the
        // provided triangles and the avg vector to the average
        // of all the vertex points
        const getBounds = (tris, bounds, avg) => {
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

        const getSphere = (tris, sphere) => {
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

        // Create the nodes
        const recurse = tris => {
            const node = new TriangleBoundsNode();

            // get the bounds of the triangles
            getBounds(tris, node.boundingBox, avgtemp);
            node.boundingBox.getCenter(node.boundingSphere.center);
            getSphere(tris, node.boundingSphere);

            if (tris.length <= maxLeafNodes) {
                node.tris = tris;
                return node;
            }

            // decide which axis to split on (longest edge)
            let splitDimStr = null;
            let splitDimIdx = -1;
            let splitDist = -Infinity;
            xyzFields.forEach((d, i) => {
                const dist = node.boundingBox.max[d] - node.boundingBox.min[d];
                if (dist > splitDist) {
                    splitDist = dist;
                    splitDimStr = d;
                    splitDimIdx = i;
                }
            })

            const left = [];
            const right = [];

            let sharedCount = 0;
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

                if (inLeft) left.push(tri);
                if (inRight) right.push(tri);
                if (inLeft && inRight) sharedCount ++;
            }

            if (sharedCount / tris.length > maxMatchingTriangles) {
                node.tris = tris;
            } else {
                node.children.push(recurse(left));
                node.children.push(recurse(right));
            }

            return node;
        }

        return recurse(origTris);
    }

    _initGeometry(geo) {
        const faces = geo.faces;
        const verts = geo.vertices;

        const origTris = new Array(faces.length);
        for (let i = 0; i < origTris.length; i ++) origTris[i] = i;

        // Sets the bounds object to the aabb that contains the
        // provided triangles and the avg vector to the average
        // of all the vertex points
        const getBounds = (tris, bounds, avg) => {
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

        const getSphere = (tris, sphere) => {
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

        const recurse = tris => {
            const node = new TriangleBoundsNode();

            // get the bounds of the triangles
            getBounds(tris, node.boundingBox, avgtemp);
            node.boundingBox.getCenter(node.boundingSphere.center);
            getSphere(tris, node.boundingSphere);

            if (tris.length <= maxLeafNodes) {
                node.tris = tris;
                return node;
            }

            // decide which axis to split on (longest edge)
            let splitDimStr = null;
            let splitDimIdx = -1;
            let splitDist = -Infinity;
            xyzFields.forEach((d, i) => {
                const dist = node.boundingBox.max[d] - node.boundingBox.min[d];
                if (dist > splitDist) {
                    splitDist = dist;
                    splitDimStr = d;
                    splitDimIdx = i;
                }
            })

            const left = [];
            const right = [];

            let sharedCount = 0;
            for (let i = 0; i < tris.length; i ++) {
                const tri = tris[i];
                const face = faces[tri];
                let inLeft = false;
                let inRight = false;

                abcFields.forEach((id, i) => {
                    const vert = verts[face[id]];
                    const val = vert[splitDimStr];

                    inLeft = inLeft || val >= avgtemp[splitDimStr];
                    inRight = inRight || val <= avgtemp[splitDimStr];
                });

                if (inLeft) left.push(tri);
                if (inRight) right.push(tri);
                if (inLeft && inRight) sharedCount ++;
            }

            if (sharedCount / tris.length > maxMatchingTriangles) {
                node.tris = tris;
            } else {
                node.children.push(recurse(left));
                node.children.push(recurse(right));
            }
            return node;
        }

        return recurse(origTris);
    }
}

export default TriangleBoundsTree;
