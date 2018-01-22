import  * as THREE from '../node_modules/three/build/three.module.js'


// reusable vectors
const vectemp = new THREE.Vector3();
const centemp = new THREE.Vector3();
const bndtemp = new THREE.Box3();
const abcFields = ['a', 'b', 'c'];
const xyzFields = ['x', 'y', 'z'];

const getBufferGeometryVertexElem = (geo, tri, vert, elem) => {
    return geo.attributes.position.array[(geo.index ? geo.index.array[3 * tri + vert] : (3 * tri + vert)) * 3  + elem];
}

// TODO: This function seems significantly slower than
// before when we were had custom bounds functions
const getGeometryVertexElem = (geo, tri, vert, elem) => {
    return geo.vertices[geo.faces[tri][abcFields[vert]]][xyzFields[elem]];
}

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

// returns the average point of the all the provided
// triangles in the geometry
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

// shrinks the provided bounds on any dimensions to fit
// the provided triangles
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

// shrinks the provided sphere to fit the provided triangles
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

export default { getBufferGeometryVertexElem, getGeometryVertexElem, getLongestEdgeIndex, getAverage, shrinkBoundsTo, shrinkSphereTo }