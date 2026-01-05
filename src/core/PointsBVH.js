import { Vector3 } from 'three';
import { BVH } from './BVH.js';
import { computePointBounds } from './build/computePointBounds.js';
import { shapecast } from './cast/shapecast.js';
import { BYTES_PER_NODE } from './Constants.js';
import { getRootIndexRanges, ensureIndex } from './build/geometryUtils.js';
import { iterateOverPoints } from './utils/pointIterationUtils.js';
import { iterateOverPoints_indirect } from './utils/pointIterationUtils.js';

export class PointsBVH extends BVH {

	constructor( geometry, options = {} ) {

		if ( ! geometry.isBufferGeometry ) {

			throw new Error( 'PointsBVH: Only BufferGeometries are supported.' );

		}

		if ( ! geometry.attributes.position ) {

			throw new Error( 'PointsBVH: Geometry must have a position attribute.' );

		}

		// call parent constructor which handles tree building and bounding box
		super( geometry, options );

		this.resolvePointIndex = options.indirect ? i => this._indirectBuffer[ i ] : i => i;

	}

	// Implement abstract methods from BVH base class
	getPrimitiveCount() {

		return this.geometry.attributes.position.count;

	}

	getPrimitiveStride() {

		return 1;

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

		const point = new Vector3();
		const iterateFunc = this.indirect ? iterateOverPoints_indirect : iterateOverPoints;
		let {
			boundsTraverseOrder,
			intersectsBounds,
			intersectsRange,
			intersectsPoint,
		} = callbacks;

		// wrap the intersectsRange function
		if ( intersectsRange && intersectsPoint ) {

			const originalIntersectsRange = intersectsRange;
			intersectsRange = ( offset, count, contained, depth, nodeIndex ) => {

				if ( ! originalIntersectsRange( offset, count, contained, depth, nodeIndex ) ) {

					return iterateFunc( offset, count, this, intersectsPoint, contained, depth, point );

				}

				return true;

			};

		} else if ( ! intersectsRange ) {

			if ( intersectsPoint ) {

				intersectsRange = ( offset, count, contained, depth ) => {

					return iterateFunc( offset, count, this, intersectsPoint, contained, depth, point );

				};

			} else {

				intersectsRange = ( offset, count, contained ) => {

					return contained;

				};

			}

		}

		// run shapecast
		let result = false;
		let nodeOffset = 0;
		const roots = this._roots;
		for ( let i = 0, l = roots.length; i < l; i ++ ) {

			const root = roots[ i ];
			result = shapecast( this, i, intersectsBounds, intersectsRange, boundsTraverseOrder, nodeOffset );

			if ( result ) {

				break;

			}

			nodeOffset += root.byteLength / BYTES_PER_NODE;

		}

		return result;

	}

}
