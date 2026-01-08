import { Matrix4, Line3, Vector3, Ray, Box3 } from 'three';
import { PrimitivePool } from '../utils/PrimitivePool.js';
import { FLOAT32_EPSILON, INTERSECTED, NOT_INTERSECTED } from './Constants.js';
import { GeometryBVH } from './GeometryBVH.js';

const _inverseMatrix = /* @__PURE__ */ new Matrix4();
const _ray = /* @__PURE__ */ new Ray();
const _linePool = /* @__PURE__ */ new PrimitivePool( () => new Line3() );
const _intersectPointOnRay = /*@__PURE__*/ new Vector3();
const _intersectPointOnSegment = /*@__PURE__*/ new Vector3();
const _box = /* @__PURE__ */ new Box3();

export class LineSegmentsBVH extends GeometryBVH {

	get primitiveStride() {

		return 2;

	}

	computePrimitiveBounds( offset, count, targetBuffer ) {

		const indirectBuffer = this._indirectBuffer;
		const { geometry, primitiveStride } = this;

		const posAttr = geometry.attributes.position;
		const boundsOffset = targetBuffer.offset || 0;

		// TODO: this may not be right for a LineLoop with a limited draw range / groups
		const vertCount = geometry.index ? geometry.index.count : geometry.attributes.position.count;
		const getters = [ 'getX', 'getY', 'getZ' ];

		for ( let i = offset, end = offset + count; i < end; i ++ ) {

			const prim = indirectBuffer ? indirectBuffer[ i ] : i;
			let i0 = prim * primitiveStride;
			let i1 = ( i0 + 1 ) % vertCount;
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

		return targetBuffer;

	}

	shapecast( callbacks ) {

		const line = _linePool.getPrimitive();
		const result = super.shapecast( {
			...callbacks,
			intersectsPrimitive: callbacks.intersectsLine,
			scratchPrimitive: line,
			iterateDirect: iterateOverLines,
			iterateIndirect: iterateOverLines,
		} );
		_linePool.releasePrimitive( line );

		return result;

	}

	raycastObject3D( object, raycaster, intersects = [] ) {

		const { matrixWorld } = object;
		const { firstHitOnly } = raycaster;

		_inverseMatrix.copy( matrixWorld ).invert();
		_ray.copy( raycaster.ray ).applyMatrix4( _inverseMatrix );

		const threshold = raycaster.params.Line.threshold;
		const localThreshold = threshold / ( ( object.scale.x + object.scale.y + object.scale.z ) / 3 );
		const localThresholdSq = localThreshold * localThreshold;

		let closestHit = null;
		let closestDistance = Infinity;
		this.shapecast( {
			boundsTraverseOrder: box => {

				return box.distanceToPoint( _ray.origin );

			},
			intersectsBounds: box => {

				// TODO: for some reason trying to early-out here is causing firstHitOnly tests to fail
				_box.copy( box ).expandByScalar( Math.abs( localThreshold ) );
				return _ray.intersectsBox( _box ) ? INTERSECTED : NOT_INTERSECTED;

			},
			intersectsLine: ( line, index ) => {

				const distSq = _ray.distanceSqToSegment( line.start, line.end, _intersectPointOnRay, _intersectPointOnSegment );

				if ( distSq > localThresholdSq ) return;

				_intersectPointOnRay.applyMatrix4( object.matrixWorld );

				const distance = raycaster.ray.origin.distanceTo( _intersectPointOnRay );

				if ( distance < raycaster.near || distance > raycaster.far ) return;

				if ( firstHitOnly && distance >= closestDistance ) return;
				closestDistance = distance;

				index = this.resolvePrimitiveIndex( index );

				closestHit = {
					distance,
					point: _intersectPointOnSegment.clone().applyMatrix4( matrixWorld ),
					index: index * this.primitiveStride,
					face: null,
					faceIndex: null,
					barycoord: null,
					object,
				};

				if ( ! firstHitOnly ) {

					intersects.push( closestHit );

				}

			},
		} );

		if ( firstHitOnly && closestHit ) {

			intersects.push( closestHit );

		}

		return intersects;

	}

}

export class LineLoopBVH extends LineSegmentsBVH {

	get primitiveStride() {

		return 1;

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

}

export class LineBVH extends LineLoopBVH {

	getRootRanges( ...args ) {

		const res = super.getRootRanges( ...args );
		res.forEach( group => group.count -- );
		return res;

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
	const posAttr = geometry.attributes.position;
	const vertCount = index ? index.count : posAttr.count;

	for ( let i = offset, l = count + offset; i < l; i ++ ) {

		const prim = bvh.resolvePrimitiveIndex( i );
		let i0 = prim * primitiveStride;
		let i1 = ( i0 + 1 ) % vertCount;
		if ( index ) {

			i0 = index.getX( i0 );
			i1 = index.getX( i1 );

		}

		line.start.fromBufferAttribute( posAttr, i0 );
		line.end.fromBufferAttribute( posAttr, i1 );

		if ( intersectsPointFunc( line, i, contained, depth ) ) {

			return true;

		}

	}

	return false;

}
