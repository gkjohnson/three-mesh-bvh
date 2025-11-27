/* eslint-disable indent */
import { Box3, Matrix4 } from 'three';
import { OrientedBox } from '../../math/OrientedBox.js';
import { ExtendedTriangle } from '../../math/ExtendedTriangle.js';
import { setTriangle } from '../../utils/TriangleUtilities.js';
import { setOBBFromArray } from '../../utils/ArrayBoxUtilities.js';
import { COUNT, OFFSET, IS_LEAF, BOUNDING_DATA_INDEX } from '../utils/nodeBufferUtils.js';
import { BufferStack } from '../utils/BufferStack.js';
import { getTriCount } from '../build/geometryUtils.js';

const boundingBox = /* @__PURE__ */ new Box3();
const triangle = /* @__PURE__ */ new ExtendedTriangle();
const triangle2 = /* @__PURE__ */ new ExtendedTriangle();
const invertedMat = /* @__PURE__ */ new Matrix4();

const obb = /* @__PURE__ */ new OrientedBox();
const obb2 = /* @__PURE__ */ new OrientedBox();

export function intersectsGeometry/* @echo INDIRECT_STRING */( bvh, root, otherGeometry, geometryToBvh ) {

	BufferStack.setBuffer( bvh._roots[ root ] );
	const result = _intersectsGeometry( 0, bvh, otherGeometry, geometryToBvh );
	BufferStack.clearBuffer();

	return result;

}

function _intersectsGeometry( nodeIndex32, bvh, otherGeometry, geometryToBvh, cachedObb = null ) {

	const { float32Array, uint16Array, uint32Array } = BufferStack;
	let nodeIndex16 = nodeIndex32 * 2;

	if ( cachedObb === null ) {

		if ( ! otherGeometry.boundingBox ) {

			otherGeometry.computeBoundingBox();

		}

		obb.set( otherGeometry.boundingBox.min, otherGeometry.boundingBox.max, geometryToBvh );
		cachedObb = obb;

	}

	const isLeaf = IS_LEAF( nodeIndex16, uint16Array );
	if ( isLeaf ) {

		const thisGeometry = bvh.geometry;
		const thisIndex = thisGeometry.index;
		const thisPos = thisGeometry.attributes.position;

		const otherIndex = otherGeometry.index;
		const otherPos = otherGeometry.attributes.position;

		const offset = OFFSET( nodeIndex32, uint32Array );
		const count = COUNT( nodeIndex16, uint16Array );

		// get the inverse of the geometry matrix so we can transform our triangles into the
		// geometry space we're trying to test. We assume there are fewer triangles being checked
		// here.
		invertedMat.copy( geometryToBvh ).invert();

		if ( otherGeometry.boundsTree ) {

			// if there's a bounds tree
			setOBBFromArray( obb2, BOUNDING_DATA_INDEX( nodeIndex32 ), float32Array );
			obb2.matrix.copy( invertedMat );

			// TODO: use a triangle iteration function here
			const res = otherGeometry.boundsTree.shapecast( {

				intersectsBounds: box => obb2.intersectsBox( box ),

				intersectsTriangle: tri => {

					tri.a.applyMatrix4( geometryToBvh );
					tri.b.applyMatrix4( geometryToBvh );
					tri.c.applyMatrix4( geometryToBvh );
					tri.needsUpdate = true;

					/* @if INDIRECT */

					for ( let i = offset, l = count + offset; i < l; i ++ ) {

						// this triangle needs to be transformed into the current BVH coordinate frame
						setTriangle( triangle2, 3 * bvh.resolveTriangleIndex( i ), thisIndex, thisPos );
						triangle2.needsUpdate = true;
						if ( tri.intersectsTriangle( triangle2 ) ) {

							return true;

						}

					}

					/* @else */

					for ( let i = offset * 3, l = ( count + offset ) * 3; i < l; i += 3 ) {

						// this triangle needs to be transformed into the current BVH coordinate frame
						setTriangle( triangle2, i, thisIndex, thisPos );
						triangle2.needsUpdate = true;
						if ( tri.intersectsTriangle( triangle2 ) ) {

							return true;

						}

					}

					/* @endif */

					return false;

				}

			} );

			return res;

		} else {

			// if we're just dealing with raw geometry
			const otherTriangleCount = getTriCount( otherGeometry );

			/* @if INDIRECT */

			for ( let i = offset, l = count + offset; i < l; i ++ ) {

				// this triangle needs to be transformed into the current BVH coordinate frame
				const ti = bvh.resolveTriangleIndex( i );
				setTriangle( triangle, 3 * ti, thisIndex, thisPos );

			/* @else */

			for ( let i = offset * 3, l = ( count + offset ) * 3; i < l; i += 3 ) {

				// this triangle needs to be transformed into the current BVH coordinate frame
				setTriangle( triangle, i, thisIndex, thisPos );

			/* @endif */

				triangle.a.applyMatrix4( invertedMat );
				triangle.b.applyMatrix4( invertedMat );
				triangle.c.applyMatrix4( invertedMat );
				triangle.needsUpdate = true;

				for ( let i2 = 0, l2 = otherTriangleCount * 3; i2 < l2; i2 += 3 ) {

					setTriangle( triangle2, i2, otherIndex, otherPos );
					triangle2.needsUpdate = true;

					if ( triangle.intersectsTriangle( triangle2 ) ) {

						return true;

					}

				}

			/* @if INDIRECT */

			}

			/* @else */

			}

			/* @endif */

		}

	} else {

		const left = nodeIndex32 + 8;
		const right = uint32Array[ nodeIndex32 + 6 ];

		// Check left child - inline bounds setting to avoid function call
		const leftBoundsIndex = BOUNDING_DATA_INDEX( left );
		boundingBox.min.x = float32Array[ leftBoundsIndex ];
		boundingBox.min.y = float32Array[ leftBoundsIndex + 1 ];
		boundingBox.min.z = float32Array[ leftBoundsIndex + 2 ];
		boundingBox.max.x = float32Array[ leftBoundsIndex + 3 ];
		boundingBox.max.y = float32Array[ leftBoundsIndex + 4 ];
		boundingBox.max.z = float32Array[ leftBoundsIndex + 5 ];

		const leftIntersection =
			cachedObb.intersectsBox( boundingBox ) &&
			_intersectsGeometry( left, bvh, otherGeometry, geometryToBvh, cachedObb );

		if ( leftIntersection ) return true;

		// Check right child - inline bounds setting to avoid function call
		const rightBoundsIndex = BOUNDING_DATA_INDEX( right );
		boundingBox.min.x = float32Array[ rightBoundsIndex ];
		boundingBox.min.y = float32Array[ rightBoundsIndex + 1 ];
		boundingBox.min.z = float32Array[ rightBoundsIndex + 2 ];
		boundingBox.max.x = float32Array[ rightBoundsIndex + 3 ];
		boundingBox.max.y = float32Array[ rightBoundsIndex + 4 ];
		boundingBox.max.z = float32Array[ rightBoundsIndex + 5 ];

		const rightIntersection =
			cachedObb.intersectsBox( boundingBox ) &&
			_intersectsGeometry( right, bvh, otherGeometry, geometryToBvh, cachedObb );

		if ( rightIntersection ) return true;

		return false;

	}

}
