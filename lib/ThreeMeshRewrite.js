import  { Mesh, Matrix4, Ray, Sphere, Vector3, Vector2, Triangle, DoubleSide, BackSide, Face3 } from '../node_modules/three/build/three.module.js'

var inverseMatrix = new Matrix4();
var ray = new Ray();
var sphere = new Sphere();

var vA = new Vector3();
var vB = new Vector3();
var vC = new Vector3();

var tempA = new Vector3();
var tempB = new Vector3();
var tempC = new Vector3();

var uvA = new Vector2();
var uvB = new Vector2();
var uvC = new Vector2();

var barycoord = new Vector3();

var intersectionPoint = new Vector3();
var intersectionPointWorld = new Vector3();

function uvIntersection( point, p1, p2, p3, uv1, uv2, uv3 ) {

    Triangle.barycoordFromPoint( point, p1, p2, p3, barycoord );

    uv1.multiplyScalar( barycoord.x );
    uv2.multiplyScalar( barycoord.y );
    uv3.multiplyScalar( barycoord.z );

    uv1.add( uv2 ).add( uv3 );

    return uv1.clone();

}

function checkIntersection( object, material, raycaster, ray, pA, pB, pC, point ) {

    var intersect;

    if ( material.side === BackSide ) {

        intersect = ray.intersectTriangle( pC, pB, pA, true, point );

    } else {

        intersect = ray.intersectTriangle( pA, pB, pC, material.side !== DoubleSide, point );

    }

    if ( intersect === null ) return null;

    intersectionPointWorld.copy( point );
    intersectionPointWorld.applyMatrix4( object.matrixWorld );

    var distance = raycaster.ray.origin.distanceTo( intersectionPointWorld );

    if ( distance < raycaster.near || distance > raycaster.far ) return null;

    return {
        distance: distance,
        point: intersectionPointWorld.clone(),
        object: object
    };

}

function checkBufferGeometryIntersection( object, raycaster, ray, position, uv, a, b, c ) {

    vA.fromBufferAttribute( position, a );
    vB.fromBufferAttribute( position, b );
    vC.fromBufferAttribute( position, c );

    var intersection = checkIntersection( object, object.material, raycaster, ray, vA, vB, vC, intersectionPoint );

    if ( intersection ) {

        if ( uv ) {

            uvA.fromBufferAttribute( uv, a );
            uvB.fromBufferAttribute( uv, b );
            uvC.fromBufferAttribute( uv, c );

            intersection.uv = uvIntersection( intersectionPoint, vA, vB, vC, uvA, uvB, uvC );

        }

        intersection.face = new Face3( a, b, c, Triangle.normal( vA, vB, vC ) );
        intersection.faceIndex = a;

    }

    return intersection;

}

function raycast( raycaster, intersects ) {

    var geometry = this.geometry;
    var material = this.material;
    var matrixWorld = this.matrixWorld;

    if ( material === undefined ) return;

    // Checking boundingSphere distance to ray

    if ( geometry.boundingSphere === null ) geometry.computeBoundingSphere();

    sphere.copy( geometry.boundingSphere );
    sphere.applyMatrix4( matrixWorld );

    if ( raycaster.ray.intersectsSphere( sphere ) === false ) return;

    //

    inverseMatrix.getInverse( matrixWorld );
    ray.copy( raycaster.ray ).applyMatrix4( inverseMatrix );

    // Check boundingBox before continuing

    if ( geometry.boundingBox !== null ) {

        if ( ray.intersectsBox( geometry.boundingBox ) === false ) return;

    }

    var intersection;

    var btIndices = geometry.boundsTree ? geometry.boundsTree.collectCandidates( ray ) : null;

    if ( geometry.isBufferGeometry ) {

        var a, b, c;
        var index = geometry.index;
        var position = geometry.attributes.position;
        var uv = geometry.attributes.uv;
        var i, l;

        if ( index !== null ) {

            // indexed buffer geometry

            for ( i = 0, l = btIndices ? btIndices.length : index.count / 3; i < l; i ++ ) {
                var i2 = (btIndices ? btIndices[i] : i) * 3;

                a = index.getX( i2 );
                b = index.getX( i2 + 1 );
                c = index.getX( i2 + 2 );

                intersection = checkBufferGeometryIntersection( this, raycaster, ray, position, uv, a, b, c );

                if ( intersection ) {

                    intersection.faceIndex = Math.floor( i2 / 3 ); // triangle number in indices buffer semantics
                    intersects.push( intersection );

                }

            }

        } else if ( position !== undefined ) {

            // non-indexed buffer geometry

            for ( i = 0, l = btIndicies ? btIndicies.length : position.count / 3; i < l; i ++ ) {
                var i2 = (btIndices ? btIndices[i] : i) * 3;

                a = i2;
                b = i2 + 1;
                c = i2 + 2;

                intersection = checkBufferGeometryIntersection( this, raycaster, ray, position, uv, a, b, c );

                if ( intersection ) {

                    intersection.index = a; // triangle number in positions buffer semantics
                    intersects.push( intersection );

                }

            }

        }

    } else if ( geometry.isGeometry ) {

        var fvA, fvB, fvC;
        var isMultiMaterial = Array.isArray( material );

        var vertices = geometry.vertices;
        var faces = geometry.faces;
        var uvs;

        var btIndices = geometry.boundsTree && !geometry.morphTargets.length ? geometry.boundsTree.collectCandidates( ray ) : null;

        var faceVertexUvs = geometry.faceVertexUvs[ 0 ];
        if ( faceVertexUvs.length > 0 ) uvs = faceVertexUvs;

        for ( var f = 0, fl = btIndices ? btIndices.length : faces.length; f < fl; f ++ ) {

            var face = faces[ btIndices ? btIndices[f] : f ];
            var faceMaterial = isMultiMaterial ? material[ face.materialIndex ] : material;

            if ( faceMaterial === undefined ) continue;

            fvA = vertices[ face.a ];
            fvB = vertices[ face.b ];
            fvC = vertices[ face.c ];

            if ( faceMaterial.morphTargets === true ) {

                var morphTargets = geometry.morphTargets;
                var morphInfluences = this.morphTargetInfluences;

                vA.set( 0, 0, 0 );
                vB.set( 0, 0, 0 );
                vC.set( 0, 0, 0 );

                for ( var t = 0, tl = morphTargets.length; t < tl; t ++ ) {

                    var influence = morphInfluences[ t ];

                    if ( influence === 0 ) continue;

                    var targets = morphTargets[ t ].vertices;

                    vA.addScaledVector( tempA.subVectors( targets[ face.a ], fvA ), influence );
                    vB.addScaledVector( tempB.subVectors( targets[ face.b ], fvB ), influence );
                    vC.addScaledVector( tempC.subVectors( targets[ face.c ], fvC ), influence );

                }

                vA.add( fvA );
                vB.add( fvB );
                vC.add( fvC );

                fvA = vA;
                fvB = vB;
                fvC = vC;

            }

            intersection = checkIntersection( this, faceMaterial, raycaster, ray, fvA, fvB, fvC, intersectionPoint );

            if ( intersection ) {

                if ( uvs && uvs[ f ] ) {

                    var uvs_f = uvs[ f ];
                    uvA.copy( uvs_f[ 0 ] );
                    uvB.copy( uvs_f[ 1 ] );
                    uvC.copy( uvs_f[ 2 ] );

                    intersection.uv = uvIntersection( intersectionPoint, fvA, fvB, fvC, uvA, uvB, uvC );

                }

                intersection.face = face;
                intersection.faceIndex = f;
                intersects.push( intersection );

            }

        }

    }

};

Mesh.prototype.raycast = raycast;
