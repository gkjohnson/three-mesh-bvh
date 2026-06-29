/** @import { StructTypeNode } from 'three/webgpu' */
/** @import { BVHComputeData } from '../BVHComputeData.js' */
import { wgslTagCode, wgslTagFn } from '../nodes/WGSLTagFnNode.js';
import { BVH_STACK_DEPTH } from '../tsl/constants.js';

/**
 * Builds a pair of WGSL shapecast functions (BLAS + TLAS traversal) for a custom shape
 * type. The returned TLAS function signature is:
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
 * @param {Function} options.intersectRangeFn - function node testing the shape against a leaf triangle range.
 * @param {Function|null} [options.transformShapeFn] - function node that transforms the shape into object local space.
 * @param {Function|null} [options.transformResultFn] - function node that transforms a hit result back to world space.
 * @param {Function|null} [options.resetShapeFn] - function node called after each BLAS traversal to reset any per-object state set by `transformShapeFn`.
 * @returns {Function} TSL function node for the TLAS traversal.
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

		boundsOrderFn = null,
		intersectsBoundsFn,
		intersectRangeFn,
		transformShapeFn = null,
		transformResultFn = null,
		resetShapeFn = null,
	} = options;

	// these are proxy nodes, so they can be referenced before the storage buffers exist
	const { nodes, transforms } = bvhData.storage;

	// handle optional functions
	let transformResultSnippet = '';
	if ( transformResultFn ) {

		transformResultSnippet = wgslTagCode/* wgsl */`${ transformResultFn }( result, i );`;

	}

	let transformShapeSnippet = '';
	if ( transformShapeFn ) {

		transformShapeSnippet = wgslTagCode/* wgsl */`${ transformShapeFn }( &localShape, i );`;

	}

	let resetShapeSnippet = '';
	if ( resetShapeFn ) {

		resetShapeSnippet = wgslTagCode/* wgsl */`${ resetShapeFn }( i );`;

	}

	let leftToRightSnippet = '';
	if ( boundsOrderFn ) {

		leftToRightSnippet = wgslTagCode/* wgsl */`
			let leftToRight = ${ boundsOrderFn }( shape, splitAxis, node );
			c1 = select( rightIndex, leftIndex, leftToRight );
			c2 = select( leftIndex, rightIndex, leftToRight );
		`;

	}

	const resultPtrSnippet = resultStruct ? wgslTagCode/* wgsl */`result: ptr<function, ${ resultStruct }>` : '';
	const resultArg = resultStruct ? 'result' : '';

	const getFnBody = leafSnippet => {

		// returns a function with a snippet inserted for the leaf intersection test
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

					let count = infoX & 0x0000ffffu;
					let offset = infoY;
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

	const blasFn = wgslTagFn/* wgsl */`
		// fn
		fn ${ name }_blas( shape: ${ shapeStruct }, rootNodeIndex: u32, ${ resultPtrSnippet } ) -> bool {

			var didHit = false;
			${ getFnBody( wgslTagCode/* wgsl */`

				didHit = ${ intersectRangeFn }( shape, offset, count, ${ resultArg } ) || didHit;

			` ) }

			return didHit;

		}
	`;

	const tlasFn = wgslTagFn/* wgsl */`
		// fn
		fn ${ name }( shape: ${ shapeStruct }, ${ resultPtrSnippet } ) -> bool {

			const rootNodeIndex = 0u;
			var didHit = false;
			${ getFnBody( wgslTagCode/* wgsl */`

				for ( var i = offset; i < offset + count; i ++ ) {

					let transform = ${ transforms }[ i ];
					if ( transform.visible == 0u ) {

						continue;

					}

					// Transform shape into object local space
					var localShape = shape;
					${ transformShapeSnippet }

					if ( ${ blasFn }( localShape, transform.nodeOffset, ${ resultArg } ) ) {

						${ transformResultSnippet }
						didHit = true;

					}

					${ resetShapeSnippet }

				}

			` ) }

			return didHit;

		}
	`;

	tlasFn.outputType = resultStruct;
	tlasFn.functionName = name;

	return tlasFn;

}
