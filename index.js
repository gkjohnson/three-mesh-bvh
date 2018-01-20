import * as THREE from './node_modules/three/build/three.module.js'
import TriangleBoundsTree from './TriangleBoundsTree.js'

const intersectionPoint = new THREE.Vector3();
const intersectionPointWorld = new THREE.Vector3();
const uvA = new THREE.Vector3();
const uvB = new THREE.Vector3();
const uvC = new THREE.Vector3();
const barycoord = new THREE.Vector3();

function uvIntersection(point, p1, p2, p3, uv1, uv2, uv3) {
    THREE.Triangle.barycoordFromPoint(point, p1, p2, p3, barycoord);

    uv1.multiplyScalar(barycoord.x);
    uv2.multiplyScalar(barycoord.y);
    uv3.multiplyScalar(barycoord.z);

    uv1.add(uv2).add(uv3);

    return uv1.clone();
}

function checkIntersection(object, material, raycaster, ray, pA, pB, pC, point) {
    var intersect;
    if (material.side === THREE.BackSide) {
        intersect = ray.intersectTriangle(pC, pB, pA, true, point);
    } else {
        intersect = ray.intersectTriangle(pA, pB, pC, material.side !== THREE.DoubleSide, point);
    }

    if (intersect === null) return null;

    intersectionPointWorld.copy(point);
    intersectionPointWorld.applyMatrix4(object.matrixWorld);

    var distance = raycaster.ray.origin.distanceTo(intersectionPointWorld);
    if (distance < raycaster.near || distance > raycaster.far) return null;

    return {
        distance: distance,
        point: intersectionPointWorld.clone(),
        object: object
    };
}

function checkBufferGeometryIntersection(object, raycaster, ray, position, uv, a, b, c) {
    vA.fromBufferAttribute(position, a);
    vB.fromBufferAttribute(position, b);
    vC.fromBufferAttribute(position, c);

    var intersection = checkIntersection(object, object.material, raycaster, ray, vA, vB, vC, intersectionPoint);
    if (intersection) {
        if (uv) {
            uvA.fromBufferAttribute(uv, a);
            uvB.fromBufferAttribute(uv, b);
            uvC.fromBufferAttribute(uv, c);

            intersection.uv = uvIntersection(intersectionPoint, vA, vB, vC, uvA, uvB, uvC);
        }

        intersection.face = new Face3(a, b, c, Triangle.normal(vA, vB, vC));
        intersection.faceIndex = a;
    }

    return intersection;
}


const origRaycast = THREE.Mesh.prototype.raycast;
const ray = new THREE.Ray();
const inverseMatrix = new THREE.Matrix4();

THREE.Mesh.prototype.raycast = function(raycaster, intersects) {
    
    // check if bounds tree exists and cast against it
    if (!this.geometry.__boundstree || this.geometry.morphTargets.length) {
        return origRaycast.call(this, raycaster, intersects);
    } else {
        inverseMatrix.getInverse(this.matrixWorld);
        ray.copy(raycaster.ray).applyMatrix4(inverseMatrix);

        const candidates = this.geometry.__boundstree.collectCandidates(ray);


        if (this.geometry.isBufferGeometry) {

        } else if(this.geometry.isGeometry) {
            const geometry = this.geometry;
            const vertices = geometry.vertices;
            const faces = geometry.faces;


            let uvs;
            const faceVertexUvs = geometry.faceVertexUvs[ 0 ];
            if (faceVertexUvs.length > 0) uvs = faceVertexUvs;

            const material = this.material;
            const isMultiMaterial = Array.isArray(material);

            for (let i = 0; i < candidates.length; i ++) {
                const f = candidates[i]
                const face = faces[ f ];
                const faceMaterial = isMultiMaterial ? material[ face.materialIndex ] : material;
                if (!faceMaterial) continue;

                const fvA = vertices[ face.a ];
                const fvB = vertices[ face.b ];
                const fvC = vertices[ face.c ];                

                const intersection = checkIntersection(this, faceMaterial, raycaster, ray, fvA, fvB, fvC, intersectionPoint);

                if (intersection) {
                    if (uvs && uvs[ f ]) {
                        const uvs_f = uvs[ f ];
                        uvA.copy(uvs_f[ 0 ]);
                        uvB.copy(uvs_f[ 1 ]);
                        uvC.copy(uvs_f[ 2 ]);

                        intersection.uv = uvIntersection(intersectionPoint, fvA, fvB, fvC, uvA, uvB, uvC);
                    }

                    intersection.face = face;
                    intersection.faceIndex = f;
                    intersects.push(intersection);
                }
            }
        }
    }    
}

THREE.Geometry.prototype.computeBoundsTree = function() {
    this.__boundstree = new TriangleBoundsTree(this);
}

THREE.Geometry.prototype.disponseBoundsTree = function() {
    this.__boundstree = null;
}

THREE.BufferGeometry.prototype.computeBoundsTree = function() {
    this.__boundstree = new TriangleBoundsTree(this);
}

THREE.BufferGeometry.prototype.disponseBoundsTree = function() {
    this.__boundstree = null;
}