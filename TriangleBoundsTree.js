
class TriangleBoundsNode {
    constructor() {
        this.bounds = new THREE.Box3();
        this.children = [];     // 
        this.tris = [];         // triangle indices
    }
}

class TriangleBoundsTree {
    constructor(geo) {
        if (geo.isBufferGeometry) {
            this._root = this.initBufferGeometry(geo);
        } else if(geo.isGeometry) {
            this._root = this.initGeometry(geo);
        } else {
            throw new Error('Object is not Geometry or BufferGeometry');
        }
    }

    initBufferGeometry(geo) {
        // array of position attributes with vector xyz
        // values as separate elements
        const pos = geo.attributes.position;

        // function for retrieving the next vertex index because
        // we may not have array indices
        const getIndex = geo.index ? (i => geo.index[i]) : (i => i);

        // the list of triangle indices (initialized to 1...n)
        const origTris = new Array(geo.index ? (geo.index.length / 3) : (pos.length / 9));
        for (let i = 0; i < origTris.length; i ++) origTris[i] = i;

        // reusable vectors
        const avgtemp = new THREE.Vector3();
        const vectemp = new THREE.Vector3();

        // Sets the bounds object to the aabb that contains the
        // provided triangles and the avg vector to the average
        // of all the vertex points
        const getBounds = (tris, bounds, avg) => {
            avg.set(0, 0, 0);

            for (let i = 0; i < tris.length * 3; i ++) {
                const index = getIndex(i);
                const x = pos[index * 3 + 0];
                const y = pos[index * 3 + 1];
                const z = pos[index * 3 + 2];

                vectemp.x = x;
                vectemp.y = y;
                vectemp.z = z;
                bounds.expandByPoint(vectemp);

                avg.x += x;
                avg.y += y;
                avg.z += z;
            }

            avg.x /= tris.length * 3;
            avg.y /= tris.length * 3;
            avg.z /= tris.length * 3;
        }

        // Create the nodes
        const recurse = tris => {
            const node = new TriangleBoundsNode();

            // get the bounds of the triangles
            getBounds(tris, node.bounds, avgtemp);

            if (tris.length <= 4) {
                node.tris = tris;
                return node;
            }

            // decide which axis to split on (longest edge)
            const dim = ['x', 'y', 'z'];
            let splitDimStr = null;
            let splitDimIdx = -1;
            let splitDist = -Infinity;
            dim.forEach((d, i) => {
                const dist = node.bounds.min[d] - node.bounds.max[d];
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

                for (let t = 0; t < 3; t ++) {
                    // get the vertex index
                    const index = getIndex(tri + t);

                    // get the vertex value along the
                    // given axis
                    const val = pos[index * 3 + splitDimIdx];

                    inLeft = inLeft || val >= avgtemp[splitDimStr];
                    inRight = inRight || val <= avgtemp[splitDimStr];
                }

                if (inLeft) left.push(tri);
                if (inRight) right.push(tri);
                if (inLeft && inRight) sharedCount ++;
            }

            if (sharedCount / tris.length > 0.5) {
                node.tris = tris;
            } else {
                node.children.push(recurse(left));
                node.children.push(recurse(right));
            }
            return node;
        }

        return recurse(origTris);
    }

    initGeometry(geo) {
        const faces = geo.faces;
        const verts = geo.vertices;

        const origTris = new Array(faces.length);
        for (let i = 0; i < origTris.length; i ++) origTris[i] = i;

        const avgtemp = new THREE.Vector3();

        // Sets the bounds object to the aabb that contains the
        // provided triangles and the avg vector to the average
        // of all the vertex points
        const getBounds = (tris, bounds, avg) => {
            avg.set(0, 0, 0);

            for (let i = 0; i < tris.length; i ++) {
                const face = faces[tris[i]];
                (['a', 'b', 'c']).forEach(id => {
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

        const recurse = tris => {
            const node = new TriangleBoundsNode();

            // get the bounds of the triangles
            getBounds(tris, node.bounds, avgtemp);

            if (tris.length <= 4) {
                node.tris = tris;
                return node;
            }

            // decide which axis to split on (longest edge)
            const dim = ['x', 'y', 'z'];
            let splitDimStr = null;
            let splitDimIdx = -1;
            let splitDist = -Infinity;
            dim.forEach((d, i) => {
                const dist = node.bounds.min[d] - node.bounds.max[d];
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

                (['a', 'b', 'c']).forEach((id, i) => {
                    const vert = verts[face[id]];
                    const val = vert[splitDimStr];

                    inLeft = inLeft || val >= avgtemp[splitDimStr];
                    inRight = inRight || val <= avgtemp[splitDimStr];
                });

                if (inLeft) left.push(tri);
                if (inRight) right.push(tri);
                if (inLeft && inRight) sharedCount ++;
            }

            if (sharedCount / tris.length > 0.5) {
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
