import { Vector3, Vector2, Ray, Matrix4, FrontSide, BackSide, Triangle } from 'three';
import { GeometryBVH, ExtendedTriangle, INTERSECTED, NOT_INTERSECTED } from 'three-mesh-bvh';
import { SKIP_GENERATION } from '../../src/core/Constants.js';

const _v0 = /* @__PURE__ */ new Vector3();
const _v1 = /* @__PURE__ */ new Vector3();
const _v2 = /* @__PURE__ */ new Vector3();
const _ray = /* @__PURE__ */ new Ray();
const _inverseMatrix = /* @__PURE__ */ new Matrix4();
const _localPoint = /* @__PURE__ */ new Vector3();
const _axes = [ 'x', 'y', 'z' ];

export class SkinnedMeshBVH extends GeometryBVH {

	get primitiveStride() {

		return 3;

	}

	constructor( mesh, options = {} ) {

		if ( ! mesh.isMesh ) {

			throw new Error( 'SkinnedMeshBVH: First argument must be a Mesh.' );

		}

		super( mesh.geometry, { [ SKIP_GENERATION ]: true, ...options } );
		this.mesh = mesh;

		this.init( options );

	}

	writePrimitiveBounds( i, targetBuffer, baseIndex ) {

		const { mesh, geometry } = this;
		const indirectBuffer = this._indirectBuffer;
		const index = geometry.index ? geometry.index.array : null;

		const tri = indirectBuffer ? indirectBuffer[ i ] : i;
		const tri3 = tri * 3;

		let ai = tri3 + 0;
		let bi = tri3 + 1;
		let ci = tri3 + 2;

		if ( index ) {

			ai = index[ ai ];
			bi = index[ bi ];
			ci = index[ ci ];

		}

		// Get skinned vertex positions
		mesh.getVertexPosition( ai, _v0 );
		mesh.getVertexPosition( bi, _v1 );
		mesh.getVertexPosition( ci, _v2 );

		// Compute bounds for each axis
		for ( let el = 0; el < 3; el ++ ) {

			const axis = _axes[ el ];
			const a = _v0[ axis ];
			const b = _v1[ axis ];
			const c = _v2[ axis ];

			let min = a;
			if ( b < min ) min = b;
			if ( c < min ) min = c;

			let max = a;
			if ( b > max ) max = b;
			if ( c > max ) max = c;

			// Write in min/max format [minx, miny, minz, maxx, maxy, maxz]
			targetBuffer[ baseIndex + el ] = min;
			targetBuffer[ baseIndex + el + 3 ] = max;

		}

		return targetBuffer;

	}

	shapecast( callbacks ) {

		const triangle = new ExtendedTriangle();
		return super.shapecast(
			{
				...callbacks,
				intersectsPrimitive: callbacks.intersectsTriangle,
				scratchPrimitive: triangle,
				iterateDirect: iterateOverTriangles,
				iterateIndirect: iterateOverTriangles,
			},
		);

	}

	raycastObject3D( object, raycaster, intersects = [] ) {

		const { material } = object;
		if ( material === undefined ) {

			return;

		}

		const { matrixWorld } = object;
		const { firstHitOnly } = raycaster;

		_inverseMatrix.copy( matrixWorld ).invert();
		_ray.copy( raycaster.ray ).applyMatrix4( _inverseMatrix );

		let closestHit = null;
		let closestDistance = Infinity;

		this.shapecast( {
			boundsTraverseOrder: box => {

				return box.distanceToPoint( _ray.origin );

			},
			intersectsBounds: box => {

				return _ray.intersectsBox( box ) ? INTERSECTED : NOT_INTERSECTED;

			},
			intersectsTriangle: ( tri, triIndex ) => {

				let point = null;
				if ( material.side === FrontSide ) {

					point = _ray.intersectTriangle( tri.a, tri.b, tri.c, true, _localPoint );

				} else if ( material.side === BackSide ) {

					point = _ray.intersectTriangle( tri.c, tri.b, tri.a, true, _localPoint );

				} else {

					point = _ray.intersectTriangle( tri.a, tri.b, tri.c, false, _localPoint );

				}

				if ( ! point ) {

					return;

				}

				point = point.clone().applyMatrix4( matrixWorld );

				const dist = raycaster.ray.origin.distanceTo( point );
				if ( dist >= raycaster.near && dist <= raycaster.far ) {

					// Get the actual vertex indices for this triangle
					const { geometry } = this;
					const { index } = geometry;
					const actualTri = this.resolvePrimitiveIndex( triIndex );
					const triOffset = actualTri * 3;

					let ai = triOffset + 0;
					let bi = triOffset + 1;
					let ci = triOffset + 2;

					if ( index ) {

						ai = index.array[ ai ];
						bi = index.array[ bi ];
						ci = index.array[ ci ];

					}

					// Calculate barycentric coordinates
					const barycoord = new Vector3();
					Triangle.getBarycoord( _localPoint, tri.a, tri.b, tri.c, barycoord );

					// Build intersection result (point is in local space)
					const hit = {
						distance: dist,
						point: point.clone(),
						object,
						barycoord,
						uv: null,
						uv1: null,
						normal: null,
						face: {
							a: ai,
							b: bi,
							c: ci,
							normal: new Vector3(),
							materialIndex: 0
						},
						faceIndex: ai,
					};

					Triangle.getNormal( tri.a, tri.b, tri.c, hit.face.normal );

					// Add UV coordinates if available
					const uv = geometry.attributes.uv;
					const uv1 = geometry.attributes.uv1;

					if ( uv ) {

						hit.uv = Triangle.getInterpolatedAttribute( uv, ai, bi, ci, barycoord, new Vector2() );

					}

					if ( uv1 ) {

						hit.uv1 = Triangle.getInterpolatedAttribute( uv1, ai, bi, ci, barycoord, new Vector2() );

					}

					// Add interpolated normal if available
					const normal = geometry.attributes.normal;
					if ( normal ) {

						hit.normal = Triangle.getInterpolatedAttribute( normal, ai, bi, ci, barycoord, new Vector3() );

						if ( hit.normal.dot( _ray.direction ) > 0 ) {

							hit.normal.multiplyScalar( - 1 );

						}

					}

					// Filter by near/far in world space
					if ( hit.distance < raycaster.near || hit.distance > raycaster.far ) return;

					if ( firstHitOnly && hit.distance >= closestDistance ) return;
					closestDistance = hit.distance;
					closestHit = hit;

					if ( ! firstHitOnly ) {

						intersects.push( hit );

					}

				}

			}
		} );

		if ( firstHitOnly && closestHit ) {

			intersects.push( closestHit );

		}

		return intersects;

	}

}

function iterateOverTriangles(
	offset,
	count,
	bvh,
	intersectsTriangleFunc,
	contained,
	depth,
	triangle
) {

	const { mesh, geometry } = bvh;
	const { index } = geometry;

	for ( let i = offset, l = count + offset; i < l; i ++ ) {

		const tri = bvh.resolvePrimitiveIndex( i );

		let i0 = 3 * tri + 0;
		let i1 = 3 * tri + 1;
		let i2 = 3 * tri + 2;

		if ( index ) {

			i0 = index.array[ i0 ];
			i1 = index.array[ i1 ];
			i2 = index.array[ i2 ];

		}

		mesh.getVertexPosition( i0, triangle.a );
		mesh.getVertexPosition( i1, triangle.b );
		mesh.getVertexPosition( i2, triangle.c );
		triangle.needsUpdate = true;

		if ( intersectsTriangleFunc( triangle, i, contained, depth ) ) {

			return true;

		}

	}

	return false;

}
