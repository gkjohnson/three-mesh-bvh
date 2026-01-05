import { Vector3 } from 'three';
import { BVH } from './BVH.js';
import { computePointBounds } from './build/computePointBounds.js';
import { getRootIndexRanges, ensureIndex } from './build/geometryUtils.js';
import { iterateOverPoints } from './utils/pointIterationUtils.js';
import { iterateOverPoints_indirect } from './utils/pointIterationUtils.js';

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
		super( geometry, options );

	}

	// Implement abstract methods from BVH base class
	getPrimitiveCount() {

		return this.geometry.attributes.position.count;

	}

	computePrimitiveBounds( offset, count ) {

		const indirectBuffer = this._indirectBuffer;
		return computePointBounds( this.geometry, offset, count, indirectBuffer );

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
			point,
			{
				...callbacks,
				intersectsPrimitive: callbacks.intersectsPoint,
			},
		);

	}

}
