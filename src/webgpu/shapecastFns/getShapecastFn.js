/** @import { StructTypeNode } from 'three/webgpu' */
/** @import { BVHComputeData } from '../BVHComputeData.js' */
import { wgslTagCode, wgslTagFn } from '../nodes/WGSLTagFnNode.js';
import { BVH_STACK_DEPTH } from '../tsl/constants.js';

/**
 * Builds a WGSL shapecast function that traverses the TLAS and per-cluster BLAS in a single
 * merged stack/loop for a custom shape type. The returned function signature is:
 * `fn name( shape: ShapeStruct[, result: ptr<function, ResultStruct>] ) -> bool`
 *
 * @private
 * @param {BVHComputeData} bvhData - The compute data whose storage buffers are referenced.
 * @param {Object} options
 * @param {string} [options.name] - Function name. Defaults to a random identifier.
 * @param {StructTypeNode} options.shapeStruct - TSL struct or definition describing the query shape.
 * @param {StructTypeNode|null} [options.resultStruct] - TSL struct for the accumulated result, or null.
 * @param {Function|null} [options.prefixFn] - function node that runs before the bvh traversal - useful for resetting or initializing necessary module variables.
 * @param {Function|null} [options.boundsOrderFn] - function node controlling left/right child traversal order.
 * @param {Function} options.intersectsBoundsFn - function node testing the shape against a BVH node's bounds.
 * @param {Function} options.intersectRangeFn - function node testing the shape against a leaf triangle range.
 * @param {Function|null} [options.transformShapeFn] - function node that transforms the shape into object local space.
 * @param {Function|null} [options.transformResultFn] - function node that transforms a hit result back to world space.
 * @param {Function|null} [options.resetShapeFn] - function node called after each BLAS traversal to reset any per-object state set by `transformShapeFn`.
 * @returns {Function} TSL function node for the traversal.
 */
export function getShapecastFn( bvhData, options ) {

	// TODO: test with and verify use with TSL Fn - both passing them as arguments,
	// calling the function from a TSL Fn.
	// TODO: revisit the semantics and mental model of "transformShapeFn" and "transformResultFn".
	// Are they "before" and "after" hooks? Should they include words implying a direction of transform?
	// eg "toLocal" / "toWorld"?
	const {
		name = `bvh_shapecast_fn_${ Math.random().toString( 36 ).substring( 2, 7 ) }`,
		shapeStruct,
		resultStruct = null,

		prefixFn = null,
		boundsOrderFn = null,
		intersectsBoundsFn,
		intersectRangeFn,
		transformShapeFn = null,
		transformResultFn = null,
		resetShapeFn = null,
	} = options;

	// these are proxy nodes, so they can be referenced before the storage buffers exist
	const { nodes, transforms } = bvhData.storage;

	let prefixSnippet = '';
	if ( prefixFn ) {

		prefixSnippet = wgslTagCode/* wgsl */`${ prefixFn }();`;

	}

	// handle optional functions
	let transformResultSnippet = '';
	if ( transformResultFn ) {

		transformResultSnippet = wgslTagCode/* wgsl */`${ transformResultFn }( result, objectIndex );`;

	}

	let transformShapeSnippet = '';
	if ( transformShapeFn ) {

		transformShapeSnippet = wgslTagCode/* wgsl */`${ transformShapeFn }( &localShape, objectIndex );`;

	}

	let resetShapeSnippet = '';
	if ( resetShapeFn ) {

		resetShapeSnippet = wgslTagCode/* wgsl */`${ resetShapeFn }( objectIndex );`;

	}

	let leftToRightSnippet = '';
	if ( boundsOrderFn ) {

		leftToRightSnippet = wgslTagCode/* wgsl */`
			let leftToRight = ${ boundsOrderFn }( localShape, splitAxis, node );
			c1 = select( rightIndex, leftIndex, leftToRight );
			c2 = select( leftIndex, rightIndex, leftToRight );
		`;

	}

	const resultPtrSnippet = resultStruct ? wgslTagCode/* wgsl */`result: ptr<function, ${ resultStruct }>` : '';
	const resultArg = resultStruct ? 'result' : '';

	// The TLAS and per-cluster BLAS are traversed with a single shared stack and loop. A thread
	// inside a cluster's BLAS ( using its transformed localShape ) and a thread still in the TLAS
	// run the same loop body, keeping SIMD lanes converged instead of recursing into a separate
	// BLAS fn.
	const tlasFn = wgslTagFn/* wgsl */`
		// fn
		fn ${ name }( shape: ${ shapeStruct }, ${ resultPtrSnippet } ) -> bool {

			${ prefixSnippet }

			var didHit = false;

			var isTLAS = true;
			var pointer: i32 = 0;
			var stack: array<u32, ${ BVH_STACK_DEPTH }>;
			stack[ 0 ] = 0u;

			var blasDidHit: bool = false;
			var objectIndex: u32 = 0;
			var localShape: ${ shapeStruct } = shape;

			// the stack depth the current cluster's BLAS drains back down to once it is complete
			var tlasReset: i32 = 0;

			loop {

				// The cluster's BLAS has drained back to its TLAS leaf. Finalize the cluster that
				// was just traversed and resume the TLAS.
				if ( ! isTLAS && tlasReset == pointer ) {

					if ( blasDidHit ) {

						blasDidHit = false;
						didHit = true;
						${ transformResultSnippet }

					}

					${ resetShapeSnippet }

					objectIndex = 0;
					isTLAS = true;
					localShape = shape;

				}

				// check if we've finished all nodes on the stack (or overrun the stack)
				if ( pointer < 0 || pointer >= i32( ${ BVH_STACK_DEPTH } ) ) {

					break;

				}

				let nodeIndex = stack[ pointer ];
				let node = ${ nodes }[ nodeIndex ];
				pointer = pointer - 1;

				// skip the node if we don't intersect the bounds
				if ( ${ intersectsBoundsFn }( localShape, node.bounds, ${ resultArg } ) == 0u ) {

					continue;

				}

				let infoX = node.splitAxisOrTriangleCount;
				let infoY = node.rightChildOrTriangleOffset;
				let isLeaf = ( infoX & 0xffff0000u ) != 0u;

				if ( isLeaf ) {

					if ( isTLAS ) {

						// the leaf encodes the placement / transform slot in the low 24 bits of infoX
						// and the cluster subtree's absolute node offset in infoY, which is pushed
						// directly as the BLAS entry node. Each TLAS leaf references one cluster.
						objectIndex = infoX & 0x00ffffffu;

						let transform = ${ transforms }[ objectIndex ];
						if ( transform.visible != 0u ) {

							tlasReset = pointer;
							isTLAS = false;
							blasDidHit = false;

							// Transform shape into object local space
							localShape = shape;
							${ transformShapeSnippet }

							pointer = pointer + 1;
							stack[ pointer ] = infoY;

						}

					} else {

						let count = infoX & 0x0000ffffu;
						let offset = infoY;
						blasDidHit = ${ intersectRangeFn }( localShape, offset, count, ${ resultArg } ) || blasDidHit;

					}

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

			return didHit;

		}
	`;

	tlasFn.outputType = resultStruct;
	tlasFn.functionName = name;

	return tlasFn;

}
