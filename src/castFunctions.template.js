// For speed and readability this script is processed to replace the macro-like calls
// with inline buffer reads. See generate-cast-functions.js.
import { Box3, Vector3, Mesh, Matrix4 } from 'three';
import { intersectTris, intersectClosestTri } from './Utils/RayIntersectTriUtlities.js';
import { arrayToBox } from './Utils/BufferNodeUtils.js';

import { OrientedBox } from './Utils/OrientedBox.js';
import { setTriangle } from './Utils/TriangleUtils.js';
import { SeparatingAxisTriangle } from './Utils/SeparatingAxisTriangle.js';
import { CONTAINED } from './Constants.js';

const boundingBox = new Box3();
const boxIntersection = new Vector3();
const xyzFields = [ 'x', 'y', 'z' ];

function IS_LEAF( n16, uint16Array ) {

	return uint16Array[ n16 + 15 ] === 0xFFFF;

}

function OFFSET( n32, uint32Array ) {

	return uint32Array[ n32 + 6 ];

}

function COUNT( n32, uint16Array ) {

	return uint16Array[ n32 + 14 ];

}

function LEFT_NODE( n32 ) {

	return n32 + 8;

}

function RIGHT_NODE( n32, uint32Array ) {

	return uint32Array[ n32 + 6 ];

}

function SPLIT_AXIS( n32, uint32Array ) {

	return uint32Array[ n32 + 7 ];

}

function BOUNDING_DATA_INDEX( n32 ) {

	return n32;

}

export function raycast( nodeIndex32, mesh, geometry, raycaster, ray, intersects ) {

	let nodeIndex16 = nodeIndex32 * 2, float32Array = _float32Array, uint16Array = _uint16Array, uint32Array = _uint32Array;

	const isLeaf = IS_LEAF( nodeIndex16, uint16Array );
	if ( isLeaf ) {

		const offset = OFFSET( nodeIndex32, uint32Array );
		const count = COUNT( nodeIndex16, uint16Array );

		intersectTris( mesh, geometry, raycaster, ray, offset, count, intersects );

	} else {

		const leftIndex = LEFT_NODE( nodeIndex32 );
		if ( intersectRay( leftIndex, float32Array, ray, boxIntersection ) ) {

			raycast( leftIndex, mesh, geometry, raycaster, ray, intersects );

		}

		const rightIndex = RIGHT_NODE( nodeIndex32, uint32Array );
		if ( intersectRay( rightIndex, float32Array, ray, boxIntersection ) ) {

			raycast( rightIndex, mesh, geometry, raycaster, ray, intersects );

		}

	}

}

export function raycastFirst( nodeIndex32, mesh, geometry, raycaster, ray ) {

	let nodeIndex16 = nodeIndex32 * 2, float32Array = _float32Array, uint16Array = _uint16Array, uint32Array = _uint32Array;

	const isLeaf = IS_LEAF( nodeIndex16, uint16Array );
	if ( isLeaf ) {

		const offset = OFFSET( nodeIndex32, uint32Array );
		const count = COUNT( nodeIndex16, uint16Array );
		return intersectClosestTri( mesh, geometry, raycaster, ray, offset, count );

	} else {

		// consider the position of the split plane with respect to the oncoming ray; whichever direction
		// the ray is coming from, look for an intersection among that side of the tree first
		const splitAxis = SPLIT_AXIS( nodeIndex32, uint32Array );
		const xyzAxis = xyzFields[ splitAxis ];
		const rayDir = ray.direction[ xyzAxis ];
		const leftToRight = rayDir >= 0;

		// c1 is the child to check first
		let c1, c2;
		if ( leftToRight ) {

			c1 = LEFT_NODE( nodeIndex32 );
			c2 = RIGHT_NODE( nodeIndex32, uint32Array );

		} else {

			c1 = RIGHT_NODE( nodeIndex32, uint32Array );
			c2 = LEFT_NODE( nodeIndex32 );

		}

		const c1Intersection = intersectRay( c1, float32Array, ray, boxIntersection );
		const c1Result = c1Intersection ? raycastFirst( c1, mesh, geometry, raycaster, ray ) : null;

		// if we got an intersection in the first node and it's closer than the second node's bounding
		// box, we don't need to consider the second node because it couldn't possibly be a better result
		if ( c1Result ) {

			// check if the point is within the second bounds
			const point = c1Result.point[ xyzAxis ];
			const isOutside = leftToRight ?
				point <= float32Array[ c2 + splitAxis ] : // min bounding data
				point >= float32Array[ c2 + splitAxis + 3 ]; // max bounding data

			if ( isOutside ) {

				return c1Result;

			}

		}

		// either there was no intersection in the first node, or there could still be a closer
		// intersection in the second, so check the second node and then take the better of the two
		const c2Intersection = intersectRay( c2, float32Array, ray, boxIntersection );
		const c2Result = c2Intersection ? raycastFirst( c2, mesh, geometry, raycaster, ray ) : null;

		if ( c1Result && c2Result ) {

			return c1Result.distance <= c2Result.distance ? c1Result : c2Result;

		} else {

			return c1Result || c2Result || null;

		}

	}

}

export const bvhcast = ( function () {

	const _boxl1 = new Box3();
	const _boxr1 = new Box3();
	const _boxl2 = new Box3();
	const _boxr2 = new Box3();
	const _box1 = new Box3();
	const _box2 = new Box3();

	const sortFunc = ( a, b ) => {

		return a.score - b.score;

	};

	return function bvhcast(
		// current parent node status
		g1NodeIndex32,
		g2NodeIndex32,

		// function taking two bounds and otherwise taking the same arguments as the shapecast variant
		// returning what kind of intersection if any the two bounds have.
		intersectsBoundsFunc,

		// function taking the triangle ranges of both intersecting leaf bounds as well as the bounds themselves.
		// returns the same types of values the the shapecast variant can.
		intersectsRangeFunc,

		// function that takes two bounds and return a score indicating the run order (lowest first)
		nodeScoreFunc = null,

		// node index and depth identifiers
		g1NodeIndexByteOffset = 0,
		g1Depth = 0,

		g2NodeIndexByteOffset = 0,
		g2Depth = 0,
	) {

		const float32Array = _float32Array, uint16Array = _uint16Array, uint32Array = _uint32Array;
		const float32Array2 = _float32Array2, uint16Array2 = _uint16Array2, uint32Array2 = _uint32Array2;

		const isLeaf1 = IS_LEAF( g1NodeIndex32 * 2, _uint16Array );
		const isLeaf2 = IS_LEAF( g2NodeIndex32 * 2, _uint16Array2 );

		if ( isLeaf1 && isLeaf2 ) {

			// TODO: we know that children are leaves before calling this function again meaning we
			// could just check triangle range callback in the previous call (below two conditions)
			// and not have to read bounding data again.
			// intersect triangles
			arrayToBox( BOUNDING_DATA_INDEX( g1NodeIndex32 ), float32Array, _box1 );
			arrayToBox( BOUNDING_DATA_INDEX( g2NodeIndex32 ), float32Array2, _box2 );
			return intersectsRangeFunc(
				OFFSET( g1NodeIndex32, uint32Array ), COUNT( g1NodeIndex32, uint16Array ),
				OFFSET( g2NodeIndex32, uint32Array2 ), COUNT( g2NodeIndex32, uint16Array2 ),
				g1Depth, g1NodeIndexByteOffset + g1NodeIndex32,
				g2Depth, g2NodeIndexByteOffset + g2NodeIndex32,
			);

		} else if ( isLeaf1 || isLeaf2 ) {

			let leafNodeIndex32 = g1NodeIndex32;
			let leafUint16Array = uint16Array;
			let leafUint32Array = uint32Array;
			let leafFloat32Array = float32Array;
			let leafByteOffset = g1NodeIndexByteOffset;
			let leafDepth = g1Depth;

			let otherNodeIndex32 = g2NodeIndex32;
			let otherUint16Array = uint16Array2;
			let otherUint32Array = uint32Array2;
			let otherFloat32Array = uint32Array2;
			let otherByteOffset = g2NodeIndexByteOffset;
			let otherDepth = g2Depth;

			let flipped = false;
			if ( isLeaf2 ) {

				[ leafNodeIndex32, otherNodeIndex32 ] = [ otherNodeIndex32, leafNodeIndex32 ];
				[ leafUint16Array, otherUint16Array ] = [ otherUint16Array, leafUint16Array ];
				[ leafUint32Array, otherUint32Array ] = [ otherUint32Array, leafUint32Array ];
				[ leafFloat32Array, otherFloat32Array ] = [ otherFloat32Array, leafFloat32Array ];
				[ leafByteOffset, otherByteOffset ] = [ otherByteOffset, leafByteOffset ];
				[ leafDepth, otherDepth ] = [ otherDepth, leafDepth ];
				flipped = true;

			}

			const left2 = LEFT_NODE( otherNodeIndex32 );
			const right2 = RIGHT_NODE( otherNodeIndex32, otherUint32Array );
			arrayToBox( BOUNDING_DATA_INDEX( g1NodeIndex32 ), leafFloat32Array, _box1 );
			arrayToBox( BOUNDING_DATA_INDEX( left2 ), otherFloat32Array, _boxl2 );
			arrayToBox( BOUNDING_DATA_INDEX( right2 ), otherFloat32Array, _boxr2 );

			let c1 = left2;
			let c2 = right2;
			let s1 = 0;
			let s2 = 0;
			if ( nodeScoreFunc ) {

				let score1, score2;
				if ( flipped ) {

					score1 = nodeScoreFunc( _boxl2, _box1 );
					score2 = nodeScoreFunc( _boxr2, _box1 );

				} else {

					score1 = nodeScoreFunc( _box1, _boxl2 );
					score2 = nodeScoreFunc( _box1, _boxr2 );


				}

				if ( score2 < score1 ) {

					c2 = left2;
					c1 = right2;
					s2 = score1;
					s1 = score2;

				} else {

					s1 = score1;
					s2 = score2;

				}

			}

			// Check the first bounds
			arrayToBox( BOUNDING_DATA_INDEX( leafNodeIndex32 ), float32Array, _box1 );
			arrayToBox( BOUNDING_DATA_INDEX( c1 ), float32Array2, _box2 );
			const c1IsLeaf = IS_LEAF( c1, otherUint16Array );

			let c1Intersection, c1StopTraversal;
			if ( flipped ) {

				c1Intersection = intersectsBoundsFunc(
					_box2, _box1, s1,

					// node 2 info
					c1IsLeaf, otherDepth + 1, otherByteOffset + c1,

					// node 1 info
					true, leafDepth, leafByteOffset + leafNodeIndex32,

				);

			} else {

				c1Intersection = intersectsBoundsFunc(
					_box1, _box2, s1,

					// node 1 info
					true, leafDepth, leafByteOffset + leafNodeIndex32,

					// node 2 info
					c1IsLeaf, otherDepth + 1, otherByteOffset + c1,

				);

			}

			if ( flipped ) {

				c1StopTraversal = c1Intersection && bvhcast(
					c1, leafNodeIndex32,
					intersectsBoundsFunc, intersectsRangeFunc, nodeScoreFunc,
					otherByteOffset, otherDepth + 1,
					leafByteOffset, leafDepth,
				);

			} else {

				c1StopTraversal = c1Intersection && bvhcast(
					leafNodeIndex32, c1,
					intersectsBoundsFunc, intersectsRangeFunc, nodeScoreFunc,
					leafByteOffset, leafDepth,
					otherByteOffset, otherDepth + 1,
				);

			}

			if ( c1StopTraversal ) {

				return true;

			}

			// Check the second bounds
			arrayToBox( BOUNDING_DATA_INDEX( leafNodeIndex32 ), leafFloat32Array, _box1 );
			arrayToBox( BOUNDING_DATA_INDEX( c2 ), otherFloat32Array, _box2 );
			const c2IsLeaf = IS_LEAF( c2, otherUint16Array );
			let c2Intersection, c2StopTraversal;

			if ( flipped ) {

				c2Intersection = intersectsBoundsFunc(
					_box1, _box2, s2,

					// node 1 info
					true, leafDepth, leafByteOffset + leafNodeIndex32,

					// node 2 info
					c2IsLeaf, otherDepth + 1, otherByteOffset + c2,
				);

			} else {

				c2Intersection = intersectsBoundsFunc(
					_box1, _box2, s2,

					// node 2 info
					c2IsLeaf, otherDepth + 1, otherByteOffset + c2,

					// node 1 info
					true, leafDepth, leafByteOffset + leafNodeIndex32,
				);

			}

			if ( flipped ) {

				c2StopTraversal = c2Intersection && bvhcast(
					c2, leafNodeIndex32,
					intersectsBoundsFunc, intersectsRangeFunc, nodeScoreFunc,
					otherByteOffset, otherDepth + 1,
					leafByteOffset, leafDepth,
				);

			} else {

				c2StopTraversal = c2Intersection && bvhcast(
					leafNodeIndex32, c2,
					intersectsBoundsFunc, intersectsRangeFunc, nodeScoreFunc,
					leafByteOffset, leafDepth,
					otherByteOffset, otherDepth + 1,
				);

			}

			if ( c2StopTraversal ) {

				return true;

			}

		} else {

			// TODO: consider a stack of these so we don't create a new one at each traversal
			const sortArr = [ null, null, null, null ].map( () => {

				return {
					score: 0,
					n1: - 1,
					n2: - 1,
					b1: null,
					b2: null,
				};

			} );
			const left1 = LEFT_NODE( g1NodeIndex32 );
			const right1 = RIGHT_NODE( g1NodeIndex32, uint32Array );
			const left2 = LEFT_NODE( g2NodeIndex32 );
			const right2 = RIGHT_NODE( g2NodeIndex32, uint32Array2 );

			if ( nodeScoreFunc ) {

				arrayToBox( BOUNDING_DATA_INDEX( left1 ), float32Array, _boxl1 );
				arrayToBox( BOUNDING_DATA_INDEX( right1 ), float32Array, _boxr1 );
				arrayToBox( BOUNDING_DATA_INDEX( left2 ), float32Array2, _boxl2 );
				arrayToBox( BOUNDING_DATA_INDEX( right2 ), float32Array2, _boxr2 );

				let info;
				info = sortArr[ 0 ];
				info.score = nodeScoreFunc( _boxl1, _boxl2 );
				info.n1 = left1;
				info.n2 = left2;

				info = sortArr[ 1 ];
				info.score = nodeScoreFunc( _boxl1, _boxr2 );
				info.n1 = left1;
				info.n2 = right2;

				info = sortArr[ 2 ];
				info.score = nodeScoreFunc( _boxr1, _boxl2 );
				info.n1 = right1;
				info.n2 = left2;

				info = sortArr[ 2 ];
				info.score = nodeScoreFunc( _boxr1, _boxr2 );
				info.n1 = right1;
				info.n2 = right2;

				sortArr.sort( sortFunc );

			} else {

				let info;
				info = sortArr[ 0 ];
				info.n1 = left1;
				info.n2 = left2;

				info = sortArr[ 1 ];
				info.n1 = left1;
				info.n2 = right2;

				info = sortArr[ 2 ];
				info.n1 = right1;
				info.n2 = left2;

				info = sortArr[ 2 ];
				info.n1 = right1;
				info.n2 = right2;

			}

			for ( let i = 0; i < 4; i ++ ) {

				const info = sortArr[ i ];
				arrayToBox( BOUNDING_DATA_INDEX( info.n1 ), float32Array, _box1 );
				arrayToBox( BOUNDING_DATA_INDEX( info.n2 ), float32Array2, _box2 );

				const leaf1 = IS_LEAF( info.n1 * 2, uint16Array );
				const leaf2 = IS_LEAF( info.n2 * 2, uint16Array2 );
				const intersection = intersectsBoundsFunc(
					_box1, _box2, info.score,

					leaf1, g1Depth + 1, g1NodeIndexByteOffset + info.n1,

					leaf2, g2Depth + 1, g2NodeIndexByteOffset + info.n2,
				);

				let stopTraversal = false;
				if ( intersection ) {

					stopTraversal = bvhcast(
						info.n1, info.n2, intersectsBoundsFunc,
						intersectsRangeFunc, nodeScoreFunc,
						g1NodeIndexByteOffset, g1Depth + 1,
						g2NodeIndexByteOffset, g2Depth + 1,
					);

				}

				if ( stopTraversal ) {

					return true;

				}

			}

		}

		return false;

	};

} );

export const shapecast = ( function () {

	const _box1 = new Box3();
	const _box2 = new Box3();

	return function shapecast(
		nodeIndex32,
		intersectsBoundsFunc,
		intersectsRangeFunc,
		nodeScoreFunc = null,
		nodeIndexByteOffset = 0, // offset for unique node identifier
		depth = 0
	) {

		// Define these inside the function so it has access to the local variables needed
		// when converting to the buffer equivalents
		function getLeftOffset( nodeIndex32 ) {

			let nodeIndex16 = nodeIndex32 * 2, uint16Array = _uint16Array, uint32Array = _uint32Array;

			// traverse until we find a leaf
			while ( ! IS_LEAF( nodeIndex16, uint16Array ) ) {

				nodeIndex32 = LEFT_NODE( nodeIndex32 );
				nodeIndex16 = nodeIndex32 * 2;

			}

			return OFFSET( nodeIndex32, uint32Array );

		}

		function getRightEndOffset( nodeIndex32 ) {

			let nodeIndex16 = nodeIndex32 * 2, uint16Array = _uint16Array, uint32Array = _uint32Array;

			// traverse until we find a leaf
			while ( ! IS_LEAF( nodeIndex16, uint16Array ) ) {

				// adjust offset to point to the right node
				nodeIndex32 = RIGHT_NODE( nodeIndex32, uint32Array );
				nodeIndex16 = nodeIndex32 * 2;

			}

			// return the end offset of the triangle range
			return OFFSET( nodeIndex32, uint32Array ) + COUNT( nodeIndex16, uint16Array );

		}

		let nodeIndex16 = nodeIndex32 * 2, float32Array = _float32Array, uint16Array = _uint16Array, uint32Array = _uint32Array;

		const isLeaf = IS_LEAF( nodeIndex16, uint16Array );
		if ( isLeaf ) {

			const offset = OFFSET( nodeIndex32, uint32Array );
			const count = COUNT( nodeIndex16, uint16Array );

			// TODO: add tests for byte offsets?
			return intersectsRangeFunc( offset, count, false, depth, nodeIndexByteOffset + nodeIndex32 );

		} else {

			const left = LEFT_NODE( nodeIndex32 );
			const right = RIGHT_NODE( nodeIndex32, uint32Array );
			let c1 = left;
			let c2 = right;

			let score1, score2;
			let box1, box2;
			if ( nodeScoreFunc ) {

				box1 = _box1;
				box2 = _box2;

				// bounding data is not offset
				arrayToBox( BOUNDING_DATA_INDEX( c1 ), float32Array, box1 );
				arrayToBox( BOUNDING_DATA_INDEX( c2 ), float32Array, box2 );

				score1 = nodeScoreFunc( box1 );
				score2 = nodeScoreFunc( box2 );

				if ( score2 < score1 ) {

					c1 = right;
					c2 = left;

					const temp = score1;
					score1 = score2;
					score2 = temp;

					box1 = box2;
					// box2 is always set before use below

				}

			}

			// Check box 1 intersection
			if ( ! box1 ) {

				box1 = _box1;
				arrayToBox( BOUNDING_DATA_INDEX( c1 ), float32Array, box1 );

			}

			const isC1Leaf = IS_LEAF( c1 * 2, uint16Array );
			const c1Intersection = intersectsBoundsFunc( box1, isC1Leaf, score1, depth + 1, nodeIndexByteOffset + c1 );

			let c1StopTraversal;
			if ( c1Intersection === CONTAINED ) {

				const offset = getLeftOffset( c1 );
				const end = getRightEndOffset( c1 );
				const count = end - offset;

				c1StopTraversal = intersectsRangeFunc( offset, count, true, depth + 1, nodeIndexByteOffset + c1 );

			} else {

				c1StopTraversal =
					c1Intersection &&
					shapecast(
						c1,
						intersectsBoundsFunc,
						intersectsRangeFunc,
						nodeScoreFunc,
						nodeIndexByteOffset,
						depth + 1
					);

			}

			if ( c1StopTraversal ) return true;

			// Check box 2 intersection
			// cached box2 will have been overwritten by previous traversal
			box2 = _box2;
			arrayToBox( BOUNDING_DATA_INDEX( c2 ), float32Array, box2 );

			const isC2Leaf = IS_LEAF( c2 * 2, uint16Array );
			const c2Intersection = intersectsBoundsFunc( box2, isC2Leaf, score2, depth + 1, nodeIndexByteOffset + c2 );

			let c2StopTraversal;
			if ( c2Intersection === CONTAINED ) {

				const offset = getLeftOffset( c2 );
				const end = getRightEndOffset( c2 );
				const count = end - offset;

				c2StopTraversal = intersectsRangeFunc( offset, count, true, depth + 1, nodeIndexByteOffset + c2 );

			} else {

				c2StopTraversal =
					c2Intersection &&
					shapecast(
						c2,
						intersectsBoundsFunc,
						intersectsRangeFunc,
						nodeScoreFunc,
						nodeIndexByteOffset,
						depth + 1
					);

			}

			if ( c2StopTraversal ) return true;

			return false;

		}

	};

} )();

export const intersectsGeometry = ( function () {

	const triangle = new SeparatingAxisTriangle();
	const triangle2 = new SeparatingAxisTriangle();
	const cachedMesh = new Mesh();
	const invertedMat = new Matrix4();

	const obb = new OrientedBox();
	const obb2 = new OrientedBox();

	return function intersectsGeometry( nodeIndex32, mesh, geometry, otherGeometry, geometryToBvh, cachedObb = null ) {

		let nodeIndex16 = nodeIndex32 * 2, float32Array = _float32Array, uint16Array = _uint16Array, uint32Array = _uint32Array;

		if ( cachedObb === null ) {

			if ( ! otherGeometry.boundingBox ) {

				otherGeometry.computeBoundingBox();

			}

			obb.set( otherGeometry.boundingBox.min, otherGeometry.boundingBox.max, geometryToBvh );
			obb.update();
			cachedObb = obb;

		}

		const isLeaf = IS_LEAF( nodeIndex16, uint16Array );
		if ( isLeaf ) {

			const thisGeometry = geometry;
			const thisIndex = thisGeometry.index;
			const thisPos = thisGeometry.attributes.position;

			const index = otherGeometry.index;
			const pos = otherGeometry.attributes.position;

			const offset = OFFSET( nodeIndex32, uint32Array );
			const count = COUNT( nodeIndex16, uint16Array );

			// get the inverse of the geometry matrix so we can transform our triangles into the
			// geometry space we're trying to test. We assume there are fewer triangles being checked
			// here.
			invertedMat.copy( geometryToBvh ).invert();

			if ( otherGeometry.boundsTree ) {

				arrayToBox( BOUNDING_DATA_INDEX( nodeIndex32 ), float32Array, obb2 );
				obb2.matrix.copy( invertedMat );
				obb2.update();

				cachedMesh.geometry = otherGeometry;
				const res = otherGeometry.boundsTree.shapecast( cachedMesh, {

					intersectsBounds: box => obb2.intersectsBox( box ),

					intersectsTriangle: tri => {

						tri.a.applyMatrix4( geometryToBvh );
						tri.b.applyMatrix4( geometryToBvh );
						tri.c.applyMatrix4( geometryToBvh );
						tri.update();

						for ( let i = offset * 3, l = ( count + offset ) * 3; i < l; i += 3 ) {

							// this triangle needs to be transformed into the current BVH coordinate frame
							setTriangle( triangle2, i, thisIndex, thisPos );
							triangle2.update();
							if ( tri.intersectsTriangle( triangle2 ) ) {

								return true;

							}

						}

						return false;

					}

				} );
				cachedMesh.geometry = null;

				return res;

			} else {

				for ( let i = offset * 3, l = ( count + offset * 3 ); i < l; i += 3 ) {

					// this triangle needs to be transformed into the current BVH coordinate frame
					setTriangle( triangle, i, thisIndex, thisPos );
					triangle.a.applyMatrix4( invertedMat );
					triangle.b.applyMatrix4( invertedMat );
					triangle.c.applyMatrix4( invertedMat );
					triangle.update();

					for ( let i2 = 0, l2 = index.count; i2 < l2; i2 += 3 ) {

						setTriangle( triangle2, i2, index, pos );
						triangle2.update();

						if ( triangle.intersectsTriangle( triangle2 ) ) {

							return true;

						}

					}

				}

			}

		} else {

			const left = nodeIndex32 + 8;
			const right = uint32Array[ nodeIndex32 + 6 ];

			arrayToBox( BOUNDING_DATA_INDEX( left ), float32Array, boundingBox );
			const leftIntersection =
				cachedObb.intersectsBox( boundingBox ) &&
				intersectsGeometry( left, mesh, geometry, otherGeometry, geometryToBvh, cachedObb );

			if ( leftIntersection ) return true;

			arrayToBox( BOUNDING_DATA_INDEX( right ), float32Array, boundingBox );
			const rightIntersection =
				cachedObb.intersectsBox( boundingBox ) &&
				intersectsGeometry( right, mesh, geometry, otherGeometry, geometryToBvh, cachedObb );

			if ( rightIntersection ) return true;

			return false;

		}

	};

} )();

function intersectRay( nodeIndex32, array, ray, target ) {

	arrayToBox( nodeIndex32, array, boundingBox );
	return ray.intersectBox( boundingBox, target );

}

const bufferStack = [];
let _prevBuffer;
let _float32Array;
let _uint16Array;
let _uint32Array;
export function setBuffer( buffer ) {

	if ( _prevBuffer ) {

		bufferStack.push( _prevBuffer );

	}

	_prevBuffer = buffer;
	_float32Array = new Float32Array( buffer );
	_uint16Array = new Uint16Array( buffer );
	_uint32Array = new Uint32Array( buffer );

}

export function clearBuffer() {

	_prevBuffer = null;
	_float32Array = null;
	_uint16Array = null;
	_uint32Array = null;

	if ( bufferStack.length ) {

		setBuffer( bufferStack.pop() );

	}

}

const bufferStack2 = [];
let _prevBuffer2;
let _float32Array2;
let _uint16Array2;
let _uint32Array2;

export function setBuffer2( buffer ) {

	if ( _prevBuffer2 ) {

		bufferStack2.push( _prevBuffer2 );

	}

	_prevBuffer2 = buffer;
	_float32Array2 = new Float32Array( buffer );
	_uint16Array2 = new Uint16Array( buffer );
	_uint32Array2 = new Uint32Array( buffer );

}

export function clearBuffer2() {

	_prevBuffer2 = null;
	_float32Array2 = null;
	_uint16Array2 = null;
	_uint32Array2 = null;

	if ( bufferStack2.length ) {

		setBuffer( bufferStack2.pop() );

	}

}
