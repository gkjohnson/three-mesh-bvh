/** @import { StructTypeNode } from 'three/webgpu' */
/** @import { BVHComputeData } from '../BVHComputeData.js' */
import { wgslTagCode, wgslTagFn } from '../nodes/WGSLTagFnNode.js';
import { bvhNodeBoundsStruct, cwbvhNodeStruct } from '../tsl/structs.js';
import { CWBVH_STACK_DEPTH } from '../tsl/constants.js';

const getCWBVHChildBounds = wgslTagFn/* wgsl */`
	fn bvh_GetCWBVHChildBounds( node: ${ cwbvhNodeStruct }, slot: u32 ) -> ${ bvhNodeBoundsStruct } {

		let exponentData = node.data[ 3 ];

		// the quantization grid scale is 2^e, formed by shifting the stored exponent into the
		// float exponent bits so it exactly matches the builder's Math.pow( 2, e )
		let scale = vec3f(
			bitcast<f32>( u32( ( i32( exponentData << 24u ) >> 24u ) + 127 ) << 23u ),
			bitcast<f32>( u32( ( i32( exponentData << 16u ) >> 24u ) + 127 ) << 23u ),
			bitcast<f32>( u32( ( i32( exponentData << 8u ) >> 24u ) + 127 ) << 23u )
		);
		let origin = vec3f(
			bitcast<f32>( node.data[ 0 ] ),
			bitcast<f32>( node.data[ 1 ] ),
			bitcast<f32>( node.data[ 2 ] )
		);
		let wordOffset = slot >> 2u;
		let shift = ( slot & 3u ) * 8u;

		let minX = ( node.data[ 6u + wordOffset ] >> shift ) & 0xffu;
		let maxX = ( node.data[ 8u + wordOffset ] >> shift ) & 0xffu;
		let minY = ( node.data[ 10u + wordOffset ] >> shift ) & 0xffu;
		let maxY = ( node.data[ 12u + wordOffset ] >> shift ) & 0xffu;
		let minZ = ( node.data[ 14u + wordOffset ] >> shift ) & 0xffu;
		let maxZ = ( node.data[ 16u + wordOffset ] >> shift ) & 0xffu;

		var result: ${ bvhNodeBoundsStruct };
		result.min[ 0 ] = origin.x + f32( minX ) * scale.x;
		result.min[ 1 ] = origin.y + f32( minY ) * scale.y;
		result.min[ 2 ] = origin.z + f32( minZ ) * scale.z;
		result.max[ 0 ] = origin.x + f32( maxX ) * scale.x;
		result.max[ 1 ] = origin.y + f32( maxY ) * scale.y;
		result.max[ 2 ] = origin.z + f32( maxZ ) * scale.z;
		return result;

	}
`;

/**
 * CWBVH traversal variant used by {@link BVHComputeData#getShapecastFn}.
 *
 * Follows the group-entry traversal of Ylitie et al. (Section 4): each 64-bit stack entry
 * references up to 8 hit children of a single parent node as a base index plus a hit mask,
 * and the current group is held in registers. Entries are vec2u where x is the child node
 * or leaf base index ( bit 31 set for leaf groups ) and y packs an 8-bit hit mask in
 * traversal-priority order ( bits 24-31 ) with the per-slot 3-bit relative child indices
 * ( bits 0-23 ). The highest set mask bit always yields the next child to traverse.
 *
 * @private
 * @param {BVHComputeData} bvhData
 * @param {Object} options
 * @param {string} [options.name]
 * @param {StructTypeNode} options.shapeStruct
 * @param {StructTypeNode|null} [options.resultStruct]
 * @param {Function|null} [options.prefixFn]
 * @param {Function|null} [options.childOrderFn]
 * @param {Function} options.intersectsBoundsFn
 * @param {Function} options.intersectRangeFn
 * @param {Function|null} [options.transformShapeFn]
 * @param {Function|null} [options.transformResultFn]
 * @param {Function|null} [options.resetShapeFn]
 * @returns {Function}
 */
export function getCWBVHShapecastFn( bvhData, options ) {

	const {
		name = `bvh_cwbvh_shapecast_fn_${ Math.random().toString( 36 ).substring( 2, 7 ) }`,
		shapeStruct,
		resultStruct = null,

		prefixFn = null,
		childOrderFn = null,
		intersectsBoundsFn,
		intersectRangeFn,
		transformShapeFn = null,
		transformResultFn = null,
		resetShapeFn = null,
	} = options;

	const { nodes, leaves, transforms } = bvhData.storage;

	let prefixSnippet = '';
	if ( prefixFn ) prefixSnippet = wgslTagCode/* wgsl */`${ prefixFn }();`;

	let transformResultSnippet = '';
	if ( transformResultFn ) transformResultSnippet = wgslTagCode/* wgsl */`${ transformResultFn }( result, objectIndex );`;

	let transformShapeSnippet = '';
	if ( transformShapeFn ) transformShapeSnippet = wgslTagCode/* wgsl */`${ transformShapeFn }( &localShape, objectIndex );`;

	let resetShapeSnippet = '';
	if ( resetShapeFn ) resetShapeSnippet = wgslTagCode/* wgsl */`${ resetShapeFn }( objectIndex );`;

	let childOrderSnippet = wgslTagCode/* wgsl */`let childOrder = 0u;`;
	if ( childOrderFn ) childOrderSnippet = wgslTagCode/* wgsl */`let childOrder = ${ childOrderFn }( localShape ) & 7u;`;

	const resultPtrSnippet = resultStruct ? wgslTagCode/* wgsl */`, result: ptr<function, ${ resultStruct }>` : '';
	const resultArgSnippet = resultStruct ? ', result' : '';

	const fn = wgslTagFn/* wgsl */`
		fn ${ name }( shape: ${ shapeStruct }${ resultPtrSnippet } ) -> bool {

			${ prefixSnippet }

			var didHit = false;
			var isTLAS = true;
			var pointer: i32 = 0;
			var stack: array<vec2u, ${ CWBVH_STACK_DEPTH }>;

			// pseudo group referencing the root node: base 0 with a single hit at priority 0
			stack[ 0 ] = vec2u( 0u, 1u << 24u );

			var blasDidHit = false;
			var objectIndex = 0u;
			var localShape: ${ shapeStruct } = shape;
			var tlasReset: i32 = 0;

			// the current group in registers - group.y == 0 marks it empty
			var group = vec2u( 0u, 0u );

			loop {

				if ( ! isTLAS && tlasReset == pointer && group.y == 0u ) {

					if ( blasDidHit ) {

						blasDidHit = false;
						didHit = true;
						${ transformResultSnippet }

					}

					${ resetShapeSnippet }
					objectIndex = 0u;
					isTLAS = true;
					localShape = shape;

				}

				if ( group.y == 0u ) {

					if ( pointer < 0 || pointer >= i32( ${ CWBVH_STACK_DEPTH } ) ) {

						break;

					}

					group = stack[ pointer ];
					pointer = pointer - 1;

				}

				${ childOrderSnippet }
				let priorityMask = 7u - childOrder;

				if ( ( group.x & 0x80000000u ) != 0u ) {

					// leaf group - process every referenced leaf in traversal order
					let leafBase = group.x & 0x7fffffffu;
					let packedIndices = group.y & 0x00ffffffu;
					var hits = group.y >> 24u;
					group = vec2u( 0u, 0u );

					loop {

						if ( hits == 0u ) {

							break;

						}

						let priority = 31u - countLeadingZeros( hits );
						hits = hits & ~( 1u << priority );

						let slot = priority ^ priorityMask;
						let leafIndex = leafBase + ( ( packedIndices >> ( slot * 3u ) ) & 7u );
						let leaf = ${ leaves }[ leafIndex ];

						if ( ( leaf.info & 0x80000000u ) != 0u ) {

							objectIndex = leaf.info & 0x7fffffffu;
							let transform = ${ transforms }[ objectIndex ];
							if ( transform.visible != 0u ) {

								// defer the remaining leaves of this group and enter the BLAS
								if ( hits != 0u ) {

									pointer = pointer + 1;
									stack[ pointer ] = vec2u( leafBase | 0x80000000u, ( hits << 24u ) | packedIndices );

								}

								tlasReset = pointer;
								isTLAS = false;
								blasDidHit = false;
								localShape = shape;
								${ transformShapeSnippet }

								pointer = pointer + 1;
								stack[ pointer ] = vec2u( leaf.value, 1u << 24u );
								break;

							}

						} else {

							blasDidHit = ${ intersectRangeFn }( localShape, leaf.value, leaf.info${ resultArgSnippet } ) || blasDidHit;

						}

					}

					continue;

				}

				// node group - extract the highest-priority referenced node
				let childBase = group.x;
				let packedNodeIndices = group.y & 0x00ffffffu;
				var nodeGroupHits = group.y >> 24u;

				let nodePriority = 31u - countLeadingZeros( nodeGroupHits );
				nodeGroupHits = nodeGroupHits & ~( 1u << nodePriority );

				let nodeSlot = nodePriority ^ priorityMask;
				let nodeIndex = childBase + ( ( packedNodeIndices >> ( nodeSlot * 3u ) ) & 7u );

				// defer the remaining referenced nodes of this group
				if ( nodeGroupHits != 0u ) {

					pointer = pointer + 1;
					stack[ pointer ] = vec2u( childBase, ( nodeGroupHits << 24u ) | packedNodeIndices );

				}

				group = vec2u( 0u, 0u );

				// intersect all children of the node, forming a node-hit and a leaf-hit group
				let node = ${ nodes }[ nodeIndex ];
				var nodeHits = 0u;
				var nodePacked = 0u;
				var leafHits = 0u;
				var leafPacked = 0u;

				for ( var childSlot = 0u; childSlot < 8u; childSlot = childSlot + 1u ) {

					let shift = ( childSlot & 3u ) * 8u;
					let metadata = ( node.data[ 18u + ( childSlot >> 2u ) ] >> shift ) & 0xffu;
					if ( metadata == 0u ) {

						continue;

					}

					let bounds = ${ getCWBVHChildBounds }( node, childSlot );
					if ( ${ intersectsBoundsFn }( localShape, bounds${ resultArgSnippet } ) == 0u ) {

						continue;

					}

					let priorityBit = 1u << ( childSlot ^ priorityMask );
					let packedIndex = ( metadata & 7u ) << ( childSlot * 3u );
					if ( ( metadata & 0x80u ) != 0u ) {

						nodeHits = nodeHits | priorityBit;
						nodePacked = nodePacked | packedIndex;

					} else {

						leafHits = leafHits | priorityBit;
						leafPacked = leafPacked | packedIndex;

					}

				}

				// leaves are processed before the closest child subtree, matching the paper's
				// traversal loop: the node group waits on the stack while the leaf group is
				// handled from registers on the next iteration
				if ( nodeHits != 0u && leafHits != 0u ) {

					pointer = pointer + 1;
					stack[ pointer ] = vec2u( node.data[ 4 ], ( nodeHits << 24u ) | nodePacked );
					group = vec2u( 0x80000000u | node.data[ 5 ], ( leafHits << 24u ) | leafPacked );

				} else if ( nodeHits != 0u ) {

					group = vec2u( node.data[ 4 ], ( nodeHits << 24u ) | nodePacked );

				} else if ( leafHits != 0u ) {

					group = vec2u( 0x80000000u | node.data[ 5 ], ( leafHits << 24u ) | leafPacked );

				}

			}

			return didHit;

		}
	`;

	fn.outputType = resultStruct;
	fn.functionName = name;
	return fn;

}
