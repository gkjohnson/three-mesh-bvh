import { Vector3 } from 'three';
import { GeometryBVH, ExtendedTriangle } from 'three-mesh-bvh';
import { SKIP_GENERATION } from '../../src/core/Constants';

const _v0 = /* @__PURE__ */ new Vector3();
const _v1 = /* @__PURE__ */ new Vector3();
const _v2 = /* @__PURE__ */ new Vector3();

export class SkinnedMeshBVH extends GeometryBVH {

	get primitiveStride() {

		return 3;

	}

	constructor( mesh, options = {} ) {

		if ( ! mesh.isMesh ) {

			throw new Error( 'SkinnedMeshBVH: First argument must be a Mesh.' );

		}

		// TODO: clean up
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

		const mins = new Array( 3 );
		const maxs = new Array( 3 );

		// Compute bounds for each axis
		for ( let el = 0; el < 3; el ++ ) {

			const axis = el === 0 ? 'x' : ( el === 1 ? 'y' : 'z' );
			const a = _v0[ axis ];
			const b = _v1[ axis ];
			const c = _v2[ axis ];

			let min = a;
			if ( b < min ) min = b;
			if ( c < min ) min = c;

			let max = a;
			if ( b > max ) max = b;
			if ( c > max ) max = c;

			mins[ el ] = min;
			maxs[ el ] = max;

		}

		// Write in min/max format [minx, miny, minz, maxx, maxy, maxz]
		targetBuffer[ baseIndex + 0 ] = mins[ 0 ];
		targetBuffer[ baseIndex + 1 ] = mins[ 1 ];
		targetBuffer[ baseIndex + 2 ] = mins[ 2 ];
		targetBuffer[ baseIndex + 3 ] = maxs[ 0 ];
		targetBuffer[ baseIndex + 4 ] = maxs[ 1 ];
		targetBuffer[ baseIndex + 5 ] = maxs[ 2 ];

		return targetBuffer;

	}

	shapecast( callbacks ) {

		// TODO: avoid unnecessary "iterate over points" function
		const triangle = new ExtendedTriangle();
		return super.shapecast(
			{
				...callbacks,
				intersectsPrimitive: callbacks.intersectsPoint,
				scratchPrimitive: triangle,
				iterateDirect: iterateOverTriangles,
				iterateIndirect: iterateOverTriangles,
			},
		);

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
