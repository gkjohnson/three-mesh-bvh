import { Mesh, Matrix4, Ray, Sphere, Vector3, Vector2, Triangle, DoubleSide, BackSide, Face3 } from '../node_modules/three/build/three.module.js'

// From THREE.js Mesh raycast
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

export { uvIntersection, checkIntersection, checkBufferGeometryIntersection };