import  * as THREE from '../node_modules/three/build/three.module.js'
import { checkIntersection, checkBufferGeometryIntersection } from './IntersectionUtilities.js'

// reusable vectors
const vectemp = new THREE.Vector3();
const centemp = new THREE.Vector3();
const bndtemp = new THREE.Box3();
const abcFields = ['a', 'b', 'c'];
const xyzFields = ['x', 'y', 'z'];

// TODO: This could probably be optimizied to not dig so deeply into an object
// and reust some of the fetch values in some cases
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

    for (let i = 0, l = tris.length; i < l; i ++) {
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

    for (let i = 0, l = tris.length; i < l; i ++) {
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

    for (let i = 0, l = tris.length; i < l; i ++) {
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

// For BVH code specifically. Does not check morph targets
// Copied from mesh raycasting
const intersectionPoint = new THREE.Vector3();
const intersectTri = (mesh, geo, raycaster, ray, tri, intersections) => {
    if (geo.isBufferGeometry) {
        tri = tri * 3;
        const a = geo.index ? geo.index.getX(tri) : tri;
        const b = geo.index ? geo.index.getX(tri + 1) : tri + 1;
        const c = geo.index ? geo.index.getX(tri + 2) : tri + 2;

        const intersection = checkBufferGeometryIntersection(mesh, raycaster, ray, geo.attributes.position, geo.attributes.uv, a, b, c);

        if (intersection) {
            intersection.index = a; // triangle number in positions buffer semantics
            if (intersections) intersections.push(intersection);
            return intersection;
        }

    } else if (geo.isGeometry) {
        const faces = geo.faces;
        const vertices = geo.vertices;
        const uvs = geo.uvs;
        const face = faces[tri];
        const isMultiMaterial = Array.isArray(mesh.material);
        const faceMaterial = isMultiMaterial ? mesh.material[face.materialIndex] : mesh.material;

        if (faceMaterial !== undefined) {

            const fvA = vertices[ face.a ];
            const fvB = vertices[ face.b ];
            const fvC = vertices[ face.c ];

            const intersection = checkIntersection(mesh, faceMaterial, raycaster, ray, fvA, fvB, fvC, intersectionPoint);

            if (intersection) {

                if (uvs && uvs[ f ]) {

                    const uvs_f = uvs[ f ];
                    uvA.copy(uvs_f[ 0 ]);
                    uvB.copy(uvs_f[ 1 ]);
                    uvC.copy(uvs_f[ 2 ]);

                    intersection.uv = uvIntersection(intersectionPoint, fvA, fvB, fvC, uvA, uvB, uvC);
                }

                intersection.face = face;
                intersection.faceIndex = tri;
                if (intersections) intersections.push(intersection);
                return intersection;
            }
        }
    }
    return null;    
}

const intersectTris = (mesh, geo, raycaster, ray, tris, intersections) => {
    for (let i = 0, l = tris.length; i < l; i ++) {
        intersectTri(mesh, geo, raycaster, ray, tris[i], intersections);
    }
}

const intersectClosestTri = (mesh, geo, raycaster, ray, tris) => {
    let dist = Infinity;
    let res = null;
    for (let i = 0, l = tris.length; i < l; i ++) {
        const intersection = intersectTri(mesh, geo, raycaster, ray, tris[i]);
        if (intersection && intersection.distance < dist) {
            res = intersection;
            dist = intersection.distance;
        }
    }

    return res;
}

export {
    getBufferGeometryVertexElem, getGeometryVertexElem, getLongestEdgeIndex, getAverage,
    shrinkBoundsTo, shrinkSphereTo, intersectTri, intersectTris, intersectClosestTri };