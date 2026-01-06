import { Matrix4, Line3 } from 'three';
import { BVH } from './BVH.js';
import { PrimitivePool } from '../utils/PrimitivePool.js';

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
