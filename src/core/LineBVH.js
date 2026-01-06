import { Matrix4, Line3 } from 'three';
import { BVH } from './BVH.js';
import { PrimitivePool } from '../utils/PrimitivePool.js';
import { FLOAT32_EPSILON } from './Constants.js';
import { getRootIndexRanges } from './build/geometryUtils.js';

const _inverseMatrix = /* @__PURE__ */ new Matrix4();
const _linePool = /* @__PURE__ */ new PrimitivePool( () => new Line3() );

export class LineBVH extends BVH {

	get primitiveStride() {

		return 1;

	}

	getPrimitiveCount() {

		const { geometry } = this;
		if ( geometry.index ) {

			return geometry.index.count - 1;

		} else {

			return geometry.position.count - 1;

		}

	}

	computePrimitiveBounds( offset, count, targetBuffer ) {

		const indirectBuffer = this._indirectBuffer;
		const { geometry } = this;

		const posAttr = geometry.attributes.position;
		const boundsOffset = targetBuffer.offset || 0;
		const stride = this.primitiveStride;

		// TODO: this may not be right for a LineLoop with a limited draw range / groups
		const primCount = this.getPrimitiveCount();
		const getters = [ 'getX', 'getY', 'getZ' ];

		for ( let i = offset, end = offset + count; i < end; i ++ ) {

			const prim = indirectBuffer ? indirectBuffer[ i ] : i;
			let i0 = prim * stride;
			let i1 = ( i0 + 1 ) % primCount;
			if ( geometry.index ) {

				i0 = geometry.index.getX( i0 );
				i1 = geometry.index.getX( i1 );

			}

			const baseIndex = ( i - boundsOffset ) * 6;
			for ( let el = 0; el < 3; el ++ ) {

				const v0 = posAttr[ getters[ el ] ]( i0 );
				const v1 = posAttr[ getters[ el ] ]( i1 );
				const min = v0 < v1 ? v0 : v1;
				const max = v0 > v1 ? v0 : v1;

				const halfExtents = ( max - min ) / 2;
				const el2 = el * 2;
				targetBuffer[ baseIndex + el2 + 0 ] = min + halfExtents;
				targetBuffer[ baseIndex + el2 + 1 ] = halfExtents + ( Math.abs( min ) + halfExtents ) * FLOAT32_EPSILON;

			}

		}

	}

	getBuildRanges( options ) {

		if ( options.indirect ) {

			// For indirect mode, return ranges for generating the indirect buffer
			return getRootIndexRanges( this.geometry, options.range, this.primitiveStride );

		} else {

			// For direct mode, ensure index exists (needed for BVH partitioning) and return ranges
			return getRootIndexRanges( this.geometry, options.range, this.primitiveStride );

		}

	}

	shapecast( callbacks ) {

	}

	raycastObject3D( object, raycaster, intersects = [] ) {

	}

}

export class LineLoopBVH extends LineBVH {

	getPrimitiveCount() {

		return super.getPrimitiveCount() + 1;

	}

}

export class LineSegmentsBVH extends LineBVH {

	get primitiveStride() {

		return 2;

	}

	getPrimitiveCount() {

		return ( super.getPrimitiveCount() + 1 ) / 2;

	}

}
