
/**************************************************************************************************
 *
 * This file is generated from castFunctions.js and scripts/generate-cast-function.mjs. Do not edit.
 *
 *************************************************************************************************/

import { Box3, Vector3, Mesh, Matrix4 } from 'three';
import { intersectTris, intersectClosestTri } from './Utils/RayIntersectTriUtlities.js';
import { OrientedBox } from './Utils/OrientedBox.js';
import { setTriangle } from './Utils/TriangleUtils.js';
import { SeparatingAxisTriangle } from './Utils/SeparatingAxisTriangle.js';
import { CONTAINED } from './Constants.js';

const boundingBox = new Box3();
const boxIntersection = new Vector3();
const xyzFields = [ 'x', 'y', 'z' ];

export function raycastBuffer( stride4Offset, mesh, raycaster, ray, intersects ) {

	let stride2Offset = stride4Offset * 2, float32Array = _float32Array, uint16Array = _uint16Array, uint32Array = _uint32Array;

	const isLeaf = ! /* node count */ ( uint16Array[ stride2Offset + 15 ] !== 0xffff );
	if ( isLeaf ) {

		intersectTris( mesh, mesh.geometry, raycaster, ray, /* node offset */ uint32Array[ stride4Offset + 6 ], /* node count */ uint16Array[ stride2Offset + 14 ], intersects );

	} else {

		if ( intersectRayBuffer( /* node left */ stride4Offset + 8, float32Array, ray, boxIntersection ) ) {

			raycastBuffer( /* node left */ stride4Offset + 8, mesh, raycaster, ray, intersects );

		}

		if ( intersectRayBuffer( /* node right */ uint32Array[ stride4Offset + 6 ], float32Array, ray, boxIntersection ) ) {

			raycastBuffer( /* node right */ uint32Array[ stride4Offset + 6 ], mesh, raycaster, ray, intersects );

		}

	}

}

export function raycastFirstBuffer( stride4Offset, mesh, raycaster, ray ) {

	let stride2Offset = stride4Offset * 2, float32Array = _float32Array, uint16Array = _uint16Array, uint32Array = _uint32Array;

	const isLeaf = ! /* node count */ ( uint16Array[ stride2Offset + 15 ] !== 0xffff );
	if ( isLeaf ) {

		return intersectClosestTri( mesh, mesh.geometry, raycaster, ray, /* node offset */ uint32Array[ stride4Offset + 6 ], /* node count */ uint16Array[ stride2Offset + 14 ] );

	} else {

		// consider the position of the split plane with respect to the oncoming ray; whichever direction
		// the ray is coming from, look for an intersection among that side of the tree first
		const splitAxis = /* node splitAxis */ uint32Array[ stride4Offset + 7 ];
		const xyzAxis = xyzFields[ splitAxis ];
		const rayDir = ray.direction[ xyzAxis ];
		const leftToRight = rayDir >= 0;

		// c1 is the child to check first
		let c1, c2;
		if ( leftToRight ) {

			c1 = /* node left */ stride4Offset + 8;
			c2 = /* node right */ uint32Array[ stride4Offset + 6 ];

		} else {

			c1 = /* node right */ uint32Array[ stride4Offset + 6 ];
			c2 = /* node left */ stride4Offset + 8;

		}

		const c1Intersection = intersectRayBuffer( c1, float32Array, ray, boxIntersection );
		const c1Result = c1Intersection ? raycastFirstBuffer( c1, mesh, raycaster, ray ) : null;

		// if we got an intersection in the first node and it's closer than the second node's bounding
		// box, we don't need to consider the second node because it couldn't possibly be a better result
		if ( c1Result ) {

			// check only along the split axis
			const rayOrig = ray.origin[ xyzAxis ];
			const toPoint = rayOrig - c1Result.point[ xyzAxis ];
			const toChild1 = rayOrig - /* c2 boundingData */ float32Array[ c2 + splitAxis ];
			const toChild2 = rayOrig - /* c2 boundingData */ float32Array[ c2 + splitAxis + 3 ];

			const toPointSq = toPoint * toPoint;
			if ( toPointSq <= toChild1 * toChild1 && toPointSq <= toChild2 * toChild2 ) {

				return c1Result;

			}

		}

		// either there was no intersection in the first node, or there could still be a closer
		// intersection in the second, so check the second node and then take the better of the two
		const c2Intersection = intersectRayBuffer( c2, float32Array, ray, boxIntersection );
		const c2Result = c2Intersection ? raycastFirstBuffer( c2, mesh, raycaster, ray ) : null;

		if ( c1Result && c2Result ) {

			return c1Result.distance <= c2Result.distance ? c1Result : c2Result;

		} else {

			return c1Result || c2Result || null;

		}

	}

}

export const shapecastBuffer = ( function () {

	const _triangle = new SeparatingAxisTriangle();
	const _cachedBox1 = new Box3();
	const _cachedBox2 = new Box3();

	function iterateOverTriangles(
		offset,
		count,
		geometry,
		intersectsTriangleFunc,
		contained,
		depth,
		triangle
	) {

		const index = geometry.index;
		const pos = geometry.attributes.position;
		for ( let i = offset * 3, l = ( count + offset ) * 3; i < l; i += 3 ) {

			setTriangle( triangle, i, index, pos );
			triangle.needsUpdate = true;

			if ( intersectsTriangleFunc( triangle, i, i + 1, i + 2, contained, depth ) ) {

				return true;

			}

		}

		return false;

	}

	return function shapecastBuffer( stride4Offset,
		mesh,
		intersectsBoundsFunc,
		intersectsTriangleFunc = null,
		nodeScoreFunc = null,
		depth = 0,
		triangle = _triangle,
		cachedBox1 = _cachedBox1,
		cachedBox2 = _cachedBox2
	) {

		// Define these inside the function so it has access to the local variables needed
		// when converting to the buffer equivalents
		function getLeftOffsetBuffer( stride4Offset ) {

			let stride2Offset = stride4Offset * 2, float32Array = _float32Array, uint16Array = _uint16Array, uint32Array = _uint32Array;

			while ( /* node count */ ( uint16Array[ stride2Offset + 15 ] !== 0xffff ) ) {

				/* node */ stride4Offset = /* node left */ stride4Offset + 8, stride2Offset = stride4Offset * 2;

			}

			return /* node offset */ uint32Array[ stride4Offset + 6 ];

		}

		function getRightEndOffsetBuffer( stride4Offset ) {

			let stride2Offset = stride4Offset * 2, float32Array = _float32Array, uint16Array = _uint16Array, uint32Array = _uint32Array;

			while ( /* node count */ ( uint16Array[ stride2Offset + 15 ] !== 0xffff ) ) {

				/* node */ stride4Offset = /* node right */ uint32Array[ stride4Offset + 6 ], stride2Offset = stride4Offset * 2;

			}

			return /* node offset */ uint32Array[ stride4Offset + 6 ] + /* node count */ uint16Array[ stride2Offset + 14 ];

		}

		let stride2Offset = stride4Offset * 2, float32Array = _float32Array, uint16Array = _uint16Array, uint32Array = _uint32Array;

		const isLeaf = ! /* node count */ ( uint16Array[ stride2Offset + 15 ] !== 0xffff );
		if ( isLeaf && intersectsTriangleFunc ) {

			const geometry = mesh.geometry;
			const offset = /* node offset */ uint32Array[ stride4Offset + 6 ];
			const count = /* node count */ uint16Array[ stride2Offset + 14 ];
			return iterateOverTriangles( offset, count, geometry, intersectsTriangleFunc, false, depth, triangle );

		} else {

			const left = /* node left */ stride4Offset + 8;
			const right = /* node right */ uint32Array[ stride4Offset + 6 ];
			let c1 = left;
			let c2 = right;

			let score1, score2;
			let box1, box2;
			if ( nodeScoreFunc ) {

				box1 = cachedBox1;
				box2 = cachedBox2;

				arrayToBoxBuffer( /* c1 boundingData */ c1, float32Array, box1 );
				arrayToBoxBuffer( /* c2 boundingData */ c2, float32Array, box2 );

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

				box1 = cachedBox1;
				arrayToBoxBuffer( /* c1 boundingData */ c1, float32Array, box1 );

			}

			const isC1Leaf = ! /* c1 count */ ( uint16Array[ c1 + 15 ] !== 0xffff );
			const c1Intersection = intersectsBoundsFunc( box1, isC1Leaf, score1, depth + 1 );

			let c1StopTraversal;
			if ( c1Intersection === CONTAINED ) {

				const geometry = mesh.geometry;
				const offset = getLeftOffsetBuffer( c1 );
				const end = getRightEndOffsetBuffer( c1 );
				const count = end - offset;

				c1StopTraversal = iterateOverTriangles( offset, count, geometry, intersectsTriangleFunc, true, depth + 1, triangle );

			} else {

				c1StopTraversal =
					c1Intersection &&
					shapecastBuffer(
						c1,
						mesh,
						intersectsBoundsFunc,
						intersectsTriangleFunc,
						nodeScoreFunc,
						depth + 1,
						triangle,
						cachedBox1,
						cachedBox2
					);

			}

			if ( c1StopTraversal ) return true;

			// Check box 2 intersection
			// cached box2 will have been overwritten by previous traversal
			box2 = cachedBox2;
			arrayToBoxBuffer( /* c2 boundingData */ c2, float32Array, box2 );

			const isC2Leaf = ! /* c2 count */ ( uint16Array[ c2 + 15 ] !== 0xffff );
			const c2Intersection = intersectsBoundsFunc( box2, isC2Leaf, score2, depth + 1 );

			let c2StopTraversal;
			if ( c2Intersection === CONTAINED ) {

				const geometry = mesh.geometry;
				const offset = getLeftOffsetBuffer( c2 );
				const end = getRightEndOffsetBuffer( c2 );
				const count = end - offset;

				c2StopTraversal = iterateOverTriangles( offset, count, geometry, intersectsTriangleFunc, true, depth + 1, triangle );

			} else {

				c2StopTraversal =
					c2Intersection &&
					shapecastBuffer(
						c2,
						mesh,
						intersectsBoundsFunc,
						intersectsTriangleFunc,
						nodeScoreFunc,
						depth + 1,
						triangle,
						cachedBox1,
						cachedBox2
					);

			}

			if ( c2StopTraversal ) return true;

			return false;

		}

	};

} )();

export const intersectsGeometryBuffer = ( function () {

	const cachedMesh = new Mesh();
	const bvhToGeometry = new Matrix4();
	const geometryObb = new OrientedBox();

	const _triangle = new SeparatingAxisTriangle();
	const _triangle2 = new SeparatingAxisTriangle();
	const _cachedBox1 = new OrientedBox();
	const _cachedBox2 = new OrientedBox();

	const _box1 = new Box3();
	const _box2 = new Box3();

	const _perBoundsInfo = [];

	return function intersectsGeometryBuffer( stride4Offset, mesh, geometry, geometryToBvh ) {

		// Takes the other geometrys node and an obb from this bvh in the geometry frame
		function findLowestIntersectingBox( node, obb, info, indexAttr, posAttr ) {

			const isLeaf = ! /* node count */ ( uint16Array[ stride2Offset + 15 ] !== 0xffff );
			if ( isLeaf ) {

				const count = /* node count */ uint16Array[ stride2Offset + 14 ];
				const offset = /* node offset */ uint32Array[ stride4Offset + 6 ];
				const tris = info.triangles;
				tris.length = 0;
				info./* node */ stride4Offset = node, stride2Offset = stride4Offset * 2;

				for ( let i = offset, l = offset + count; i < l; i ++ ) {

					setTriangle( _triangle, i, indexAttr, posAttr );
					if ( obb.intersectsTriangle( _triangle ) ) {

						tris.push( i );

					}

				}

			} else {

				const c1 = /* node left */ stride4Offset + 8;
				const c2 = /* node right */ uint32Array[ stride4Offset + 6 ];

				arrayToBoxBuffer( /* c1 boundingData */ c1, float32Array, _box1 );
				arrayToBoxBuffer( /* c2 boundingData */ c2, float32Array, _box2 );

				const intersectsC1 = obb.intersectsBox( _box1 );
				const intersectsC2 = obb.intersectsBox( _box2 );

				info.triangles.length = 0;

				if ( intersectsC1 && ! intersectsC2 ) {

					findLowestIntersectingBox( c1, obb, info, indexAttr, posAttr );

				} else if ( ! intersectsC1 && intersectsC2 ) {

					findLowestIntersectingBox( c2, obb, info, indexAttr, posAttr );

				} else if ( intersectsC1 && intersectsC2 ) {

					info./* node */ stride4Offset = node, stride2Offset = stride4Offset * 2;

				}

			}

		}

		let stride2Offset = stride4Offset * 2, float32Array = _float32Array, uint16Array = _uint16Array, uint32Array = _uint32Array;

		if ( ! geometry.boundingBox ) {

			geometry.computeBoundingBox();

		}

		const index = geometry.index;
		const pos = geometry.attributes.position;

		cachedMesh.geometry = geometry;
		bvhToGeometry.copy( geometryToBvh ).invert();
		geometryObb.set( geometry.boundingBox.min, geometry.boundingBox.max, geometryToBvh );
		geometryObb.update();

		// TODO
		// - shapecast this bvh
		// - on checking box
		//    - convert box to obb in geometry frame
		//    - traverse geometry bounds until both children are interesected
		//    - if a leaf is found check all the triangles against the bounds and keep them
		//    - start at the parents bounds if it's available. Propagate triangles forward if
		//      they've already been iterated over
		//    - just filter the existing set of triangles
		//    - TODO: setting a triangle may be a bit slow

		const result =
			shapecastBuffer( stride4Offset,
				mesh,
				box => geometryObb.intersectsBox( box ),
				tri => {

					tri.a.applyMatrix4( bvhToGeometry );
					tri.b.applyMatrix4( bvhToGeometry );
					tri.c.applyMatrix4( bvhToGeometry );
					tri.update();

					if ( geometry.boundsTree ) {

						return geometry
							.boundsTree
							.shapecast(
								cachedMesh,
								box => box.intersectsTriangle( tri ),
								tri2 => tri2.intersectsTriangle( tri ),
								box => Math.min(
									box.distanceToPoint( tri.a ),
									box.distanceToPoint( tri.b ),
									box.distanceToPoint( tri.c )
								)
							);

					} else {

						for ( let i = 0, l = index.count; i < l; i += 3 ) {

							setTriangle( _triangle2, i, index, pos );
							_triangle2.update();

							if ( tri.intersectsTriangle( _triangle2 ) ) {

								return true;

							}

						}

					}

				},
				box => geometryObb.distanceToBox( box ),
				0,
				_triangle,
				_cachedBox1,
				_cachedBox2
			);

		cachedMesh.geometry = null;
		return result;

	};

} )();

function intersectRayBuffer( stride4Offset, array, ray, target ) {

	arrayToBoxBuffer( stride4Offset, array, boundingBox );
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

function arrayToBoxBuffer( stride4Offset, array, target ) {

	target.min.x = array[ stride4Offset ];
	target.min.y = array[ stride4Offset + 1 ];
	target.min.z = array[ stride4Offset + 2 ];

	target.max.x = array[ stride4Offset + 3 ];
	target.max.y = array[ stride4Offset + 4 ];
	target.max.z = array[ stride4Offset + 5 ];

}
