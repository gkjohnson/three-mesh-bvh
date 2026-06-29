/** @import { StructTypeNode } from 'three/webgpu' */
/** @import { BVHComputeData } from '../BVHComputeData.js' */
import { wgslTagCode, wgslTagFn } from '../nodes/WGSLTagFnNode.js';
import { BVH_STACK_DEPTH } from '../tsl/constants.js';

/**
 * Builds a pair of WGSL shapecast functions for the single-level "composite" BVH. The top-level
 * tree holds two kinds of leaves:
 * - triangle leaves: a range of triangles belonging to one object, stored in that object's local
 *   space. The shape is transformed into the object's frame ( via the leaf's `objectIndex` ) and
 *   each triangle in the range is tested.
 * - object leaves: a range of object / instance transforms, each pointing at a nested BLAS subtree
 *   that is traversed in the instance's local space ( the original TLAS -> BLAS behavior ).
 *
 * The generator owns the leaf loop and the per-vertex fetch; the caller only supplies
 * `intersectTriangleFn`, which tests a single ( local-space ) triangle against the shape.
 *
 * The returned function signature is:
 * `fn name( shape: ShapeStruct[, result: ptr<function, ResultStruct>] ) -> bool`
 *
 * @private
 * @param {BVHComputeData} bvhData - The compute data whose storage buffers are referenced.
 * @param {Object} options
 * @param {string} [options.name] - Function name. Defaults to a random identifier.
 * @param {StructTypeNode} options.shapeStruct - TSL struct or definition describing the query shape.
 * @param {StructTypeNode|null} [options.resultStruct] - TSL struct for the accumulated result, or null.
 * @param {Function|null} [options.boundsOrderFn] - function node controlling left/right child traversal order.
 * @param {Function} options.intersectsBoundsFn - function node testing the shape against a BVH node's bounds.
 * @param {Function} options.intersectTriangleFn - function node testing the shape against a single triangle.
 *   Signature: `fn name( shape, a: vec3f, b: vec3f, c: vec3f, indices: vec4u, result: ptr<...> ) -> bool`,
 *   where `a`/`b`/`c` are the triangle's local-space vertices and `indices` is `vec4u( i0, i1, i2, triangleIndex )`.
 * @param {Function|null} [options.transformShapeFn] - function node that transforms the shape into object local space.
 * @param {Function|null} [options.transformResultFn] - function node that transforms a hit result back to world space.
 * @param {Function|null} [options.resetShapeFn] - function node called after each object traversal to reset any per-object state set by `transformShapeFn`.
 * @returns {Function} TSL function node for the top-level traversal.
 */
export function getShapecastFn( bvhData, options ) {

	const {
		name = `bvh_shapecast_fn_${ Math.random().toString( 36 ).substring( 2, 7 ) }`,
		shapeStruct,
		resultStruct = null,

		boundsOrderFn = null,
		intersectsBoundsFn,
		intersectTriangleFn,
		transformShapeFn = null,
		transformResultFn = null,
		resetShapeFn = null,
	} = options;

	// these are proxy nodes, so they can be referenced before the storage buffers exist
	const { nodes, transforms, index, attributes } = bvhData.storage;

	const resultPtrSnippet = resultStruct ? wgslTagCode/* wgsl */`result: ptr<function, ${ resultStruct }>` : '';
	const resultArg = resultStruct ? 'result' : '';

	// per-index-variable snippet builders for the optional transform hooks
	const transformShapeCall = idx => transformShapeFn ? wgslTagCode/* wgsl */`${ transformShapeFn }( &localShape, ${ idx } );` : '';
	const transformResultCall = idx => transformResultFn ? wgslTagCode/* wgsl */`${ transformResultFn }( result, ${ idx } );` : '';
	const resetShapeCall = idx => resetShapeFn ? wgslTagCode/* wgsl */`${ resetShapeFn }( ${ idx } );` : '';

	// loops a leaf's triangle range, fetching the local-space vertices and testing each triangle.
	// "shapeVar" is the ( possibly transformed ) shape to test, "hitVar" accumulates whether any hit.
	const triangleLoop = ( shapeVar, hitVar ) => wgslTagCode/* wgsl */`
		for ( var ti = offset; ti < offset + count; ti = ti + 1u ) {

			let i0 = ${ index }[ ti * 3u + 0u ];
			let i1 = ${ index }[ ti * 3u + 1u ];
			let i2 = ${ index }[ ti * 3u + 2u ];

			let a = ${ attributes }[ i0 ].position.xyz;
			let b = ${ attributes }[ i1 ].position.xyz;
			let c = ${ attributes }[ i2 ].position.xyz;

			${ hitVar } = ${ intersectTriangleFn }( ${ shapeVar }, a, b, c, vec4u( i0, i1, i2, ti ), ${ resultArg } ) || ${ hitVar };

		}
	`;

	let leftToRightSnippet = '';
	if ( boundsOrderFn ) {

		leftToRightSnippet = wgslTagCode/* wgsl */`
			let leftToRight = ${ boundsOrderFn }( shape, splitAxis, node );
			c1 = select( rightIndex, leftIndex, leftToRight );
			c2 = select( leftIndex, rightIndex, leftToRight );
		`;

	}

	// shared stack-based traversal. "infoX"/"infoY"/"nodeIndex" are exposed to the leaf snippet,
	// which is responsible for decoding the leaf payload ( the encoding differs between the top-level
	// tree and the BLAS subtrees ).
	const getFnBody = leafSnippet => {

		return wgslTagCode/* wgsl */`

			var pointer: i32 = 0;
			var stack: array<u32, ${ BVH_STACK_DEPTH }>;
			stack[ 0 ] = rootNodeIndex;

			loop {

				if ( pointer < 0 || pointer >= i32( ${ BVH_STACK_DEPTH } ) ) {

					break;

				}

				let nodeIndex = stack[ pointer ];
				let node = ${ nodes }[ nodeIndex ];
				pointer = pointer - 1;

				if ( ${ intersectsBoundsFn }( shape, node.bounds, ${ resultArg } ) == 0u ) {

					continue;

				}

				let infoX = node.splitAxisOrTriangleCount;
				let infoY = node.rightChildOrTriangleOffset;
				let isLeaf = ( infoX & 0xffff0000u ) != 0u;

				if ( isLeaf ) {

					${ leafSnippet }

				} else {

					let leftIndex = nodeIndex + 1u;
					let splitAxis = infoX & 0x0000ffffu;
					let rightIndex = nodeIndex + infoY;

					var c1 = rightIndex;
					var c2 = leftIndex;
					${ leftToRightSnippet }

					pointer = pointer + 1;
					stack[ pointer ] = c2;

					pointer = pointer + 1;
					stack[ pointer ] = c1;

				}

			}

		`;

	};

	// BLAS subtree traversal - leaves ( tagged 0xFFFF ) hold a triangle range tested in the
	// instance's local space. The shape is already transformed into that space by the caller.
	const blasFn = wgslTagFn/* wgsl */`
		// fn
		fn ${ name }_blas( shape: ${ shapeStruct }, rootNodeIndex: u32, ${ resultPtrSnippet } ) -> bool {

			var didHit = false;
			${ getFnBody( wgslTagCode/* wgsl */`

				let count = infoX & 0x0000ffffu;
				let offset = infoY;
				${ triangleLoop( 'shape', 'didHit' ) }

			` ) }

			return didHit;

		}
	`;

	// top-level traversal - leaves are either triangle leaves ( tag 0xFE ) or object leaves ( tag 0xFF ).
	const tlasFn = wgslTagFn/* wgsl */`
		// fn
		fn ${ name }( shape: ${ shapeStruct }, ${ resultPtrSnippet } ) -> bool {

			const rootNodeIndex = 0u;
			var didHit = false;
			${ getFnBody( wgslTagCode/* wgsl */`

				let tag = infoX >> 24u;
				if ( tag == 0xFEu ) {

					// triangle leaf: [ 0xFE | objectIndex:16 | count:8 ], offset = triangle index
					let objectIndex = ( infoX >> 8u ) & 0x0000ffffu;
					let count = infoX & 0x000000ffu;
					let offset = infoY;

					var localShape = shape;
					${ transformShapeCall( 'objectIndex' ) }

					var leafHit = false;
					${ triangleLoop( 'localShape', 'leafHit' ) }

					if ( leafHit ) {

						${ transformResultCall( 'objectIndex' ) }
						didHit = true;

					}

					${ resetShapeCall( 'objectIndex' ) }

				} else {

					// object leaf: [ 0xFF00 | count:16 ], offset = transform range start
					let count = infoX & 0x0000ffffu;
					let offset = infoY;
					for ( var i = offset; i < offset + count; i ++ ) {

						let transform = ${ transforms }[ i ];
						if ( transform.visible == 0u ) {

							continue;

						}

						var localShape = shape;
						${ transformShapeCall( 'i' ) }

						if ( ${ blasFn }( localShape, transform.nodeOffset, ${ resultArg } ) ) {

							${ transformResultCall( 'i' ) }
							didHit = true;

						}

						${ resetShapeCall( 'i' ) }

					}

				}

			` ) }

			return didHit;

		}
	`;

	tlasFn.outputType = resultStruct;
	tlasFn.functionName = name;

	return tlasFn;

}
