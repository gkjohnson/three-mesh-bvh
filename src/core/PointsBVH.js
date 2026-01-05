import { Vector3 } from 'three';
import { BVH } from './BVH.js';
import { getRootIndexRanges, ensureIndex } from './build/geometryUtils.js';
import { iterateOverPoints } from './utils/pointIterationUtils.js';
import { iterateOverPoints_indirect } from './utils/pointIterationUtils.js';
import { FLOAT32_EPSILON } from './Constants.js';

export class PointsBVH extends BVH {

	get primitiveStride() {

		return 3;

	}

	get resolvePointIndex() {

		return this.resolvePrimitiveIndex;

	}

	constructor( geometry, options = {} ) {

		if ( ! geometry.isBufferGeometry ) {

			throw new Error( 'PointsBVH: Only BufferGeometries are supported.' );

		}

		if ( ! geometry.attributes.position ) {

			throw new Error( 'PointsBVH: Geometry must have a position attribute.' );

		}

		// call parent constructor which handles tree building and bounding box
		super( geometry, {
			...options,

			// TODO: remove any "indirect=false" logic from the class once behavior is decided
			indirect: true,
		} );

	}

	// Implement abstract methods from BVH base class
	getPrimitiveCount() {

		return this.geometry.attributes.position.count;

	}

	computePrimitiveBounds( offset, count, target = null ) {

		const indirectBuffer = this._indirectBuffer;
		const { geometry } = this;

		const posAttr = geometry.attributes.position;
		const needsIndirectBuffer = indirectBuffer && indirectBuffer !== posAttr.array;

		let result;
		if ( target ) {

			result = target;

		} else {

			// Use SharedArrayBuffer if the indirect buffer is a SharedArrayBuffer
			const BufferConstructor = needsIndirectBuffer && indirectBuffer.buffer instanceof SharedArrayBuffer
				? SharedArrayBuffer
				: ArrayBuffer;

			const buffer = new BufferConstructor( 6 * count * 4 );
			result = new Float32Array( buffer );

		}

		const boundsOffset = result.offset || 0;
		for ( let i = offset, end = offset + count; i < end; i ++ ) {

			const pointIndex = needsIndirectBuffer ? indirectBuffer[ i ] : i;
			const baseIndex = ( i - boundsOffset ) * 6;

			// Get point position
			const px = posAttr.getX( pointIndex );
			const py = posAttr.getY( pointIndex );
			const pz = posAttr.getZ( pointIndex );

			// For points, center equals position and half extents are zero (with epsilon for stability)
			const eps = FLOAT32_EPSILON * Math.max( Math.abs( px ), Math.abs( py ), Math.abs( pz ) );

			// [centerX, halfExtentX, centerY, halfExtentY, centerZ, halfExtentZ]
			result[ baseIndex + 0 ] = px;
			result[ baseIndex + 1 ] = eps;
			result[ baseIndex + 2 ] = py;
			result[ baseIndex + 3 ] = eps;
			result[ baseIndex + 4 ] = pz;
			result[ baseIndex + 5 ] = eps;

		}

		return result;

	}

	getBuildRanges( options ) {

		if ( options.indirect ) {

			// For indirect mode, return ranges for generating the indirect buffer
			return getRootIndexRanges( this.geometry, options.range, 1 );

		} else {

			// For direct mode, ensure index exists (needed for BVH partitioning) and return ranges
			ensureIndex( this.geometry, options );
			return getRootIndexRanges( this.geometry, options.range, 1 );

		}

	}

	shapecast( callbacks ) {

		// TODO: use pool for primitive
		// TODO: avoid unnecessary "iterate over points" function
		const point = new Vector3();
		return this._shapecast(
			iterateOverPoints,
			iterateOverPoints_indirect,
			{
				...callbacks,
				intersectsPrimitive: callbacks.intersectsPoint,
				scratchPrimitive: point,
			},
		);

	}

}
