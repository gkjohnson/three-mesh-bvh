import { BVH } from './BVH.js';

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

	}

	getBuildRanges( options ) {

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
