import { Box3 } from 'three';
import { BYTES_PER_NODE, UINT32_PER_NODE, DEFAULT_OPTIONS, FLOAT32_EPSILON } from './Constants.js';
import { arrayToBox } from '../utils/ArrayBoxUtilities.js';
import { IS_LEAF, LEFT_NODE, RIGHT_NODE, SPLIT_AXIS } from './utils/nodeBufferUtils.js';
import { buildPackedTree } from './build/buildTree.js';
import { shapecast as shapecastFunc } from './cast/shapecast.js';

const _tempBox = /* @__PURE__ */ new Box3();
const _tempBuffer = /* @__PURE__ */ new Float32Array( 6 );

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

	writePrimitiveBounds( /* i, buffer, writeOffset */ ) {

		throw new Error( 'BVH: writePrimitiveBounds() not implemented' );

	}

	writePrimitiveRangeBounds( offset, count, targetBuffer, baseIndex ) {

		// Initialize bounds
		let minx = Infinity;
		let miny = Infinity;
		let minz = Infinity;
		let maxx = - Infinity;
		let maxy = - Infinity;
		let maxz = - Infinity;

		// Compute union of all bounds (matching getBounds behavior in tree construction)
		for ( let i = offset, end = offset + count; i < end; i ++ ) {

			// Write primitive bounds to temp buffer (in min/max format)
			this.writePrimitiveBounds( i, _tempBuffer, 0 );

			// Read min/max format [minx, miny, minz, maxx, maxy, maxz] and compute union
			const lx = _tempBuffer[ 0 ];
			const ly = _tempBuffer[ 1 ];
			const lz = _tempBuffer[ 2 ];
			const rx = _tempBuffer[ 3 ];
			const ry = _tempBuffer[ 4 ];
			const rz = _tempBuffer[ 5 ];

			if ( lx < minx ) minx = lx;
			if ( rx > maxx ) maxx = rx;
			if ( ly < miny ) miny = ly;
			if ( ry > maxy ) maxy = ry;
			if ( lz < minz ) minz = lz;
			if ( rz > maxz ) maxz = rz;

		}

		// Write bounds in min/max format (matching tree node format)
		targetBuffer[ baseIndex + 0 ] = minx;
		targetBuffer[ baseIndex + 1 ] = miny;
		targetBuffer[ baseIndex + 2 ] = minz;
		targetBuffer[ baseIndex + 3 ] = maxx;
		targetBuffer[ baseIndex + 4 ] = maxy;
		targetBuffer[ baseIndex + 5 ] = maxz;

		return targetBuffer;

	}

	computePrimitiveBounds( offset, count, targetBuffer ) {

		const boundsOffset = targetBuffer.offset || 0;
		for ( let i = offset, end = offset + count; i < end; i ++ ) {

			const baseIndex = ( i - boundsOffset ) * 6;
			// writePrimitiveBounds outputs min/max format, but we need center/half-extent
			// for the intermediate primitive bounds array used during tree construction
			this.writePrimitiveBounds( i, _tempBuffer, 0 );

			// Convert from min/max [minx, miny, minz, maxx, maxy, maxz] to center/half-extent
			const minx = _tempBuffer[ 0 ];
			const miny = _tempBuffer[ 1 ];
			const minz = _tempBuffer[ 2 ];
			const maxx = _tempBuffer[ 3 ];
			const maxy = _tempBuffer[ 4 ];
			const maxz = _tempBuffer[ 5 ];

			const cx = ( minx + maxx ) / 2;
			const cy = ( miny + maxy ) / 2;
			const cz = ( minz + maxz ) / 2;

			const hx = ( maxx - minx ) / 2;
			const hy = ( maxy - miny ) / 2;
			const hz = ( maxz - minz ) / 2;

			targetBuffer[ baseIndex + 0 ] = cx;
			targetBuffer[ baseIndex + 1 ] = hx + ( Math.abs( cx ) + hx ) * FLOAT32_EPSILON;
			targetBuffer[ baseIndex + 2 ] = cy;
			targetBuffer[ baseIndex + 3 ] = hy + ( Math.abs( cy ) + hy ) * FLOAT32_EPSILON;
			targetBuffer[ baseIndex + 4 ] = cz;
			targetBuffer[ baseIndex + 5 ] = hz + ( Math.abs( cz ) + hz ) * FLOAT32_EPSILON;

		}

		return targetBuffer;

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

	refit( nodeIndices = null ) {

		// TODO: add support for "nodeIndices"
		if ( nodeIndices && Array.isArray( nodeIndices ) ) {

			nodeIndices = new Set( nodeIndices );

		}

		const roots = this._roots;
		for ( let rootIndex = 0, rootCount = roots.length; rootIndex < rootCount; rootIndex ++ ) {

			const buffer = roots[ rootIndex ];
			const uint32Array = new Uint32Array( buffer );
			const uint16Array = new Uint16Array( buffer );
			const float32Array = new Float32Array( buffer );

			const totalNodes = buffer.byteLength / BYTES_PER_NODE;

			// Traverse nodes from right to left (end to beginning) so children are updated before parents
			for ( let nodeIndex = totalNodes - 1; nodeIndex >= 0; nodeIndex -- ) {

				const nodeIndex32 = nodeIndex * UINT32_PER_NODE;
				const nodeIndex16 = nodeIndex32 * 2;

				const isLeaf = IS_LEAF( nodeIndex16, uint16Array );

				if ( isLeaf ) {

					// Leaf node: recompute bounds from primitives
					const offset = uint32Array[ nodeIndex32 + 6 ];
					const count = uint16Array[ nodeIndex16 + 14 ];

					// Use writePrimitiveRangeBounds to compute union of primitive bounds
					// This returns min/max format in _tempBuffer
					this.writePrimitiveRangeBounds( offset, count, _tempBuffer, 0 );

					// Write directly to node bounds (already in min/max format)
					float32Array[ nodeIndex32 + 0 ] = _tempBuffer[ 0 ]; // minx
					float32Array[ nodeIndex32 + 1 ] = _tempBuffer[ 1 ]; // miny
					float32Array[ nodeIndex32 + 2 ] = _tempBuffer[ 2 ]; // minz
					float32Array[ nodeIndex32 + 3 ] = _tempBuffer[ 3 ]; // maxx
					float32Array[ nodeIndex32 + 4 ] = _tempBuffer[ 4 ]; // maxy
					float32Array[ nodeIndex32 + 5 ] = _tempBuffer[ 5 ]; // maxz

				} else {

					// Internal node: union child bounds
					const left = LEFT_NODE( nodeIndex32 );
					const right = RIGHT_NODE( nodeIndex32, uint32Array );

					// Union the bounds of left and right children
					for ( let i = 0; i < 3; i ++ ) {

						const leftMin = float32Array[ left + i ];
						const leftMax = float32Array[ left + i + 3 ];
						const rightMin = float32Array[ right + i ];
						const rightMax = float32Array[ right + i + 3 ];

						float32Array[ nodeIndex32 + i ] = leftMin < rightMin ? leftMin : rightMin;
						float32Array[ nodeIndex32 + i + 3 ] = leftMax > rightMax ? leftMax : rightMax;

					}

				}

			}

		}

	}

	getBoundingBox( target ) {

		target.makeEmpty();

		const roots = this._roots;
		roots.forEach( buffer => {

			arrayToBox( 0, new Float32Array( buffer ), _tempBox );
			target.union( _tempBox );

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
