import { Matrix4, Line3, Vector3, Ray } from 'three';
import { BVH } from './BVH.js';
import { PrimitivePool } from '../utils/PrimitivePool.js';
import { FLOAT32_EPSILON, INTERSECTED, NOT_INTERSECTED } from './Constants.js';

const _inverseMatrix = /* @__PURE__ */ new Matrix4();
const _ray = /* @__PURE__ */ new Ray();
const _linePool = /* @__PURE__ */ new PrimitivePool( () => new Line3() );
const _intersectPointOnRay = /*@__PURE__*/ new Vector3();
const _intersectPointOnSegment = /*@__PURE__*/ new Vector3();

export class LineSegmentsBVH extends BVH {

	get primitiveStride() {

		return 2;

	}

	get resolveLineIndex() {

		return this.resolvePrimitiveIndex;

	}

	getPrimitiveCount() {

		const { geometry } = this;
		if ( geometry.index ) {

			return geometry.index.count / 2;

		} else {

			return geometry.position.count / 2;

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

	shapecast( callbacks ) {

		const line = _linePool.getPrimitive();
		super.shapecast( {
			...callbacks,
			intersectsPrimitive: callbacks.intersectsLine,
			scratchPrimitive: line,
			iterateDirect: iterateOverLines,
			iterateIndirect: iterateOverLines,
		} );
		_linePool.releasePrimitive( line );

	}

	raycastObject3D( object, raycaster, intersects = [] ) {

		_inverseMatrix.copy( object.matrixWorld ).invert();
		_ray.copy( raycaster.ray ).applyMatrix4( _inverseMatrix );

		const threshold = raycaster.params.Line.threshold;
		const localThreshold = threshold / ( ( object.scale.x + object.scale.y + object.scale.z ) / 3 );
		const localThresholdSq = localThreshold * localThreshold;

		const { firstHitOnly } = raycaster;
		let closestHit = null;
		let localClosestDistance = Infinity;
		this.shapecast( {
			boundsTraverseOrder: box => {

				// traverse the closer bounds first.
				return box.distanceToPoint( _ray.origin );

			},
			intersectsBounds: ( box, isLeaf, score ) => {

				// if we've already found a point that's closer then the full bounds then
				// don't traverse further.
				if ( score > localClosestDistance && firstHitOnly ) {

					return NOT_INTERSECTED;

				}

				box.expandByScalar( localThreshold );
				return _ray.intersectsBox( box ) ? INTERSECTED : NOT_INTERSECTED;

			},
			intersectsLine: ( line, index ) => {

				const distSq = _ray.distanceSqToSegment( line.start, line.end, _intersectPointOnRay, _intersectPointOnSegment );
				if ( distSq > localThresholdSq ) {

					return;

				}

				const localDistanceToPoint = Math.sqrt( distSq );
				if ( firstHitOnly && localDistanceToPoint > localClosestDistance ) {

					return;

				}

				_intersectPointOnRay.applyMatrix4( object.matrixWorld );

				const distance = raycaster.ray.origin.distanceTo( _intersectPointOnRay );
				if ( distance < raycaster.near || distance > raycaster.far ) {

					return;

				}


				localClosestDistance = localDistanceToPoint;

				index = this.resolveLineIndex( index );

				closestHit = {
					distance,
					point: _intersectPointOnSegment.clone().applyMatrix4( object.matrixWorld ),
					index,
					face: null,
					faceIndex: null,
					barycoord: null,
					object,
				};

				if ( ! raycaster.firstHitOnly ) {

					intersects.push( closestHit );

				}

			},
		} );

		if ( raycaster.firstHitOnly ) {

			intersects.push( closestHit );

		}

		return intersects;

	}

}

export class LineBVH extends LineSegmentsBVH {

	get primitiveStride() {

		return 2;

	}

	constructor( geometry, options = {} ) {

		// "Line" and "LineLoop" BVH must be indirect since we cannot rearrange the index
		// buffer without breaking the lines
		options = {
			...options,
			indirect: true,
		};

		super( geometry, options );

	}

	getPrimitiveCount() {

		const { geometry } = this;
		if ( geometry.index ) {

			return geometry.index.count - 1;

		} else {

			return geometry.position.count - 1;

		}

	}

}

export class LineLoopBVH extends LineBVH {

	getPrimitiveCount() {

		return super.getPrimitiveCount() + 1;

	}

}

function iterateOverLines(
	offset,
	count,
	bvh,
	intersectsPointFunc,
	contained,
	depth,
	line
) {

	const { geometry, primitiveStride } = bvh;
	const { index } = geometry;
	const pos = geometry.attributes.position;
	const primCount = bvh.getPrimitiveCount();

	for ( let i = offset, l = count + offset; i < l; i ++ ) {

		const prim = bvh.resolveLineIndex( i );
		let i0 = prim * primitiveStride;
		let i1 = ( i0 + 1 ) % primCount;
		if ( index ) {

			i0 = index.getX( i0 );
			i1 = index.getX( i1 );

		}

		line.start.fromBufferAttribute( pos, i0 );
		line.end.fromBufferAttribute( pos, i1 );

		if ( intersectsPointFunc( line, i, contained, depth ) ) {

			return true;

		}

	}

	return false;

}
