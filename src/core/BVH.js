import { Box3 } from 'three';
import { BYTES_PER_NODE, UINT32_PER_NODE, DEFAULT_OPTIONS } from './Constants.js';
import { arrayToBox } from '../utils/ArrayBoxUtilities.js';
import { IS_LEAF, LEFT_NODE, RIGHT_NODE, SPLIT_AXIS } from './utils/nodeBufferUtils.js';
import { buildPackedTree } from './build/buildTree.js';
import { shapecast as shapecastFunc } from './cast/shapecast.js';

const tempBox = /* @__PURE__ */ new Box3();

export class BVH {

	constructor() {

		this._roots = null;
		this.primitiveBuffer = null;
		this.primitiveBufferStride = null;

	}

	init( options ) {

		options = {
			...DEFAULT_OPTIONS,
			...options,
		};

		buildPackedTree( this, options );

	}

	getRootRanges( /* range */ ) {

		// TODO: can we avoid passing options in here
		throw new Error( 'BVH: getRootRanges() not implemented' );

	}

	computePrimitiveBounds( /* offset, count, targetBuffer */ ) {

		throw new Error( 'BVH: computePrimitiveBounds() not implemented' );

	}

	shiftPrimitiveOffsets( offset ) {

		const indirectBuffer = this._indirectBuffer;
		if ( indirectBuffer ) {

			// the offsets are embedded in the indirect buffer
			for ( let i = 0, l = indirectBuffer.length; i < l; i ++ ) {

				indirectBuffer[ i ] += offset;

			}

		} else {

			// offsets are embedded in the leaf nodes
			const roots = this._roots;
			for ( let rootIndex = 0; rootIndex < roots.length; rootIndex ++ ) {

				const root = roots[ rootIndex ];
				const uint32Array = new Uint32Array( root );
				const uint16Array = new Uint16Array( root );
				const totalNodes = root.byteLength / BYTES_PER_NODE;
				for ( let node = 0; node < totalNodes; node ++ ) {

					const node32Index = UINT32_PER_NODE * node;
					const node16Index = 2 * node32Index;
					if ( IS_LEAF( node16Index, uint16Array ) ) {

						// offset value
						uint32Array[ node32Index + 6 ] += offset;

					}

				}

			}

		}

	}

	traverse( callback, rootIndex = 0 ) {

		const buffer = this._roots[ rootIndex ];
		const uint32Array = new Uint32Array( buffer );
		const uint16Array = new Uint16Array( buffer );
		_traverse( 0 );

		function _traverse( node32Index, depth = 0 ) {

			const node16Index = node32Index * 2;
			const isLeaf = IS_LEAF( node16Index, uint16Array );
			if ( isLeaf ) {

				const offset = uint32Array[ node32Index + 6 ];
				const count = uint16Array[ node16Index + 14 ];
				callback( depth, isLeaf, new Float32Array( buffer, node32Index * 4, 6 ), offset, count );

			} else {

				const left = LEFT_NODE( node32Index );
				const right = RIGHT_NODE( node32Index, uint32Array );
				const splitAxis = SPLIT_AXIS( node32Index, uint32Array );
				const stopTraversal = callback( depth, isLeaf, new Float32Array( buffer, node32Index * 4, 6 ), splitAxis );

				if ( ! stopTraversal ) {

					_traverse( left, depth + 1 );
					_traverse( right, depth + 1 );

				}

			}

		}

	}

	getBoundingBox( target ) {

		target.makeEmpty();

		const roots = this._roots;
		roots.forEach( buffer => {

			arrayToBox( 0, new Float32Array( buffer ), tempBox );
			target.union( tempBox );

		} );

		return target;

	}

	// Base shapecast implementation that can be used by subclasses
	// TODO: see if we can get rid of "iterateFunc" here as well as the primitive so the function
	// API aligns with the "shapecast" implementation
	shapecast( callbacks ) {

		let {
			boundsTraverseOrder,
			intersectsBounds,
			intersectsRange,
			intersectsPrimitive,
			scratchPrimitive,
			iterate,
		} = callbacks;

		// wrap the intersectsRange function
		if ( intersectsRange && intersectsPrimitive ) {

			const originalIntersectsRange = intersectsRange;
			intersectsRange = ( offset, count, contained, depth, nodeIndex ) => {

				if ( ! originalIntersectsRange( offset, count, contained, depth, nodeIndex ) ) {

					return iterate( offset, count, this, intersectsPrimitive, contained, depth, scratchPrimitive );

				}

				return true;

			};

		} else if ( ! intersectsRange ) {

			if ( intersectsPrimitive ) {

				intersectsRange = ( offset, count, contained, depth ) => {

					return iterate( offset, count, this, intersectsPrimitive, contained, depth, scratchPrimitive );

				};

			} else {

				intersectsRange = ( offset, count, contained ) => {

					return contained;

				};

			}

		}

		// run shapecast
		let result = false;
		let nodeOffset = 0;
		const roots = this._roots;
		for ( let i = 0, l = roots.length; i < l; i ++ ) {

			const root = roots[ i ];
			result = shapecastFunc( this, i, intersectsBounds, intersectsRange, boundsTraverseOrder, nodeOffset );

			if ( result ) {

				break;

			}

			nodeOffset += root.byteLength / BYTES_PER_NODE;

		}

		return result;

	}

}
