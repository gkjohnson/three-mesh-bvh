import { Vector3, Vector2, Triangle, DoubleSide, BackSide, REVISION } from 'three';

const IS_GT_REVISION_169 = parseInt( REVISION ) >= 169;
const IS_LT_REVISION_161 = parseInt( REVISION ) <= 161;

// Ripped and modified From THREE.js Mesh raycast
// https://github.com/mrdoob/three.js/blob/0aa87c999fe61e216c1133fba7a95772b503eddf/src/objects/Mesh.js#L115
const _vA = /* @__PURE__ */ new Vector3();
const _vB = /* @__PURE__ */ new Vector3();
const _vC = /* @__PURE__ */ new Vector3();

const _uvA = /* @__PURE__ */ new Vector2();
const _uvB = /* @__PURE__ */ new Vector2();
const _uvC = /* @__PURE__ */ new Vector2();

const _normalA = /* @__PURE__ */ new Vector3();
const _normalB = /* @__PURE__ */ new Vector3();
const _normalC = /* @__PURE__ */ new Vector3();

const _intersectionPoint = /* @__PURE__ */ new Vector3();
function checkIntersection( ray, pA, pB, pC, point, side, near, far ) {

	let intersect;
	if ( side === BackSide ) {

		intersect = ray.intersectTriangle( pC, pB, pA, true, point );

	} else {

		intersect = ray.intersectTriangle( pA, pB, pC, side !== DoubleSide, point );

	}

	if ( intersect === null ) return null;

	const distance = ray.origin.distanceTo( point );

	if ( distance < near || distance > far ) return null;

	return {

		distance: distance,
		point: point.clone(),

	};

}

function checkBufferGeometryIntersection( ray, position, normal, uv, uv1, a, b, c, side, near, far ) {

	_vA.fromBufferAttribute( position, a );
	_vB.fromBufferAttribute( position, b );
	_vC.fromBufferAttribute( position, c );

	const intersection = checkIntersection( ray, _vA, _vB, _vC, _intersectionPoint, side, near, far );

	if ( intersection ) {

		if ( uv ) {

			_uvA.fromBufferAttribute( uv, a );
			_uvB.fromBufferAttribute( uv, b );
			_uvC.fromBufferAttribute( uv, c );

			intersection.uv = new Vector2();
			const res = Triangle.getInterpolation( _intersectionPoint, _vA, _vB, _vC, _uvA, _uvB, _uvC, intersection.uv );
			if ( ! IS_GT_REVISION_169 ) {

				intersection.uv = res;

			}

		}

		if ( uv1 ) {

			_uvA.fromBufferAttribute( uv1, a );
			_uvB.fromBufferAttribute( uv1, b );
			_uvC.fromBufferAttribute( uv1, c );

			intersection.uv1 = new Vector2();
			const res = Triangle.getInterpolation( _intersectionPoint, _vA, _vB, _vC, _uvA, _uvB, _uvC, intersection.uv1 );
			if ( ! IS_GT_REVISION_169 ) {

				intersection.uv1 = res;

			}

			if ( IS_LT_REVISION_161 ) {

				intersection.uv2 = intersection.uv1;

			}

		}

		if ( normal ) {

			_normalA.fromBufferAttribute( normal, a );
			_normalB.fromBufferAttribute( normal, b );
			_normalC.fromBufferAttribute( normal, c );

			intersection.normal = new Vector3();
			const res = Triangle.getInterpolation( _intersectionPoint, _vA, _vB, _vC, _normalA, _normalB, _normalC, intersection.normal );
			if ( intersection.normal.dot( ray.direction ) > 0 ) {

				intersection.normal.multiplyScalar( - 1 );

			}

			if ( ! IS_GT_REVISION_169 ) {

				intersection.normal = res;

			}

		}

		const face = {
			a: a,
			b: b,
			c: c,
			normal: new Vector3(),
			materialIndex: 0
		};

		Triangle.getNormal( _vA, _vB, _vC, face.normal );

		intersection.face = face;
		intersection.faceIndex = a;

		if ( IS_GT_REVISION_169 ) {

			const barycoord = new Vector3();
			Triangle.getBarycoord( _intersectionPoint, _vA, _vB, _vC, barycoord );

			intersection.barycoord = barycoord;

		}

	}

	return intersection;

}

function getSide( materialOrSide ) {

	return materialOrSide && materialOrSide.isMaterial ? materialOrSide.side : materialOrSide;

}

// https://github.com/mrdoob/three.js/blob/0aa87c999fe61e216c1133fba7a95772b503eddf/src/objects/Mesh.js#L258
export function intersectTri( geometry, materialOrSide, ray, tri, intersections, near, far ) {

	const triOffset = tri * 3;
	let a = triOffset + 0;
	let b = triOffset + 1;
	let c = triOffset + 2;

	const { index, groups } = geometry;
	if ( geometry.index ) {

		a = index.getX( a );
		b = index.getX( b );
		c = index.getX( c );

	}

	const { position, normal, uv, uv1 } = geometry.attributes;
	if ( Array.isArray( materialOrSide ) ) {

		// check which groups a triangle is present in and run the intersections
		// TODO: we shouldn't need to run and intersection test multiple times
		const firstIndex = tri * 3;
		for ( let i = 0, l = groups.length; i < l; i ++ ) {

			const { start, count, materialIndex } = groups[ i ];
			if ( firstIndex >= start && firstIndex < start + count ) {

				const side = getSide( materialOrSide[ materialIndex ] );
				const intersection = checkBufferGeometryIntersection( ray, position, normal, uv, uv1, a, b, c, side, near, far );
				if ( intersection ) {

					intersection.faceIndex = tri;
					intersection.face.materialIndex = materialIndex;

					if ( intersections ) {

						intersections.push( intersection );

					} else {

						return intersection;

					}

				}

			}

		}

	} else {

		// run the intersection for the single material
		const side = getSide( materialOrSide );
		const intersection = checkBufferGeometryIntersection( ray, position, normal, uv, uv1, a, b, c, side, near, far );
		if ( intersection ) {

			intersection.faceIndex = tri;
			intersection.face.materialIndex = 0;

			if ( intersections ) {

				intersections.push( intersection );

			} else {

				return intersection;

			}

		}

	}

	return null;

}
