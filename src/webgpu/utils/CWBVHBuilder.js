import { BYTES_PER_NODE, UINT32_PER_NODE } from '../../core/Constants.js';
import { COUNT, IS_LEAF, OFFSET, RIGHT_NODE } from '../../core/utils/nodeBufferUtils.js';

const CWBVH_NODE_BYTES = 80;
const CWBVH_NODE_U32 = CWBVH_NODE_BYTES / 4;

const MAX_CHILDREN = 8;
const MAX_LEAF_INDEX = 0x7fffffff;

// SAH cost constants and default leaf size cap from the paper's default configuration (Section 5.1)
const CWBVH_SAH_NODE_COST = 1.0;
const CWBVH_SAH_TRIANGLE_COST = 0.3;
const CWBVH_MAX_LEAF_SIZE = 3;

const _float32 = new Float32Array( 1 );
const _uint32 = new Uint32Array( _float32.buffer );

function nextFloatDown( value ) {

	_float32[ 0 ] = value;
	if ( ! Number.isFinite( value ) ) return value;

	if ( value === 0 ) {

		_uint32[ 0 ] = 0x80000001;

	} else if ( value > 0 ) {

		_uint32[ 0 ] --;

	} else {

		_uint32[ 0 ] ++;

	}

	return _float32[ 0 ];

}

function getBoundsCenter( bounds, axis ) {

	return ( bounds[ axis ] + bounds[ axis + 3 ] ) * 0.5;

}

function getOctant( bounds, parentBounds ) {

	let result = 0;
	for ( let axis = 0; axis < 3; axis ++ ) {

		if ( getBoundsCenter( bounds, axis ) > getBoundsCenter( parentBounds, axis ) ) {

			result |= 1 << ( 2 - axis );

		}

	}

	return result;

}

function bitCount( value ) {

	value = value - ( ( value >> 1 ) & 0x55 );
	value = ( value & 0x33 ) + ( ( value >> 2 ) & 0x33 );
	return ( value + ( value >> 4 ) ) & 0x0f;

}

function assignSlots( children, parentBounds ) {

	const slots = new Array( MAX_CHILDREN ).fill( null );
	for ( let i = 0, l = children.length; i < l; i ++ ) {

		const child = children[ i ];
		const preferred = getOctant( child.bounds, parentBounds );
		let slot = preferred;

		if ( slots[ slot ] !== null ) {

			let bestDistance = Infinity;
			for ( let candidate = 0; candidate < MAX_CHILDREN; candidate ++ ) {

				if ( slots[ candidate ] === null ) {

					const distance = bitCount( candidate ^ preferred );
					if ( distance < bestDistance ) {

						bestDistance = distance;
						slot = candidate;

					}

				}

			}

		}

		slots[ slot ] = child;

	}

	return slots;

}

function getSurfaceArea( bounds ) {

	const x = Math.max( bounds[ 3 ] - bounds[ 0 ], 0 );
	const y = Math.max( bounds[ 4 ] - bounds[ 1 ], 0 );
	const z = Math.max( bounds[ 5 ] - bounds[ 2 ], 0 );
	return 2 * ( x * y + y * z + z * x );

}

// Bottom-up computation of the optimal SAH cost C(n, i) for representing the subtree of n as
// a forest of at most i wide BVHs, i in [1, 7] (Section 3.4, Eq. 5-8). Records per node:
// - sahCost[ i ]: optimal cost for up to i roots
// - sahLeaf: whether C(n, 1) is achieved by a leaf (always true for binary leaves)
// - sahDecision[ i ]: for i > 1, the winning root split k, or 0 for "use fewer than i roots"
// - sahDistK: the winning split k of Cdistribute(n, 8), used when creating an internal node
function computeSahCosts( node, maxLeafSize ) {

	if ( node.isLeaf || node.count === 0 ) {

		const cost = getSurfaceArea( node.bounds ) * node.primitiveCount * CWBVH_SAH_TRIANGLE_COST;
		node.sahCost = [ 0, cost, cost, cost, cost, cost, cost, cost ];
		node.sahLeaf = true;
		return;

	}

	computeSahCosts( node.left, maxLeafSize );
	computeSahCosts( node.right, maxLeafSize );

	const area = getSurfaceArea( node.bounds );
	const cost = new Array( 8 );
	const decision = new Array( 8 ).fill( 0 );
	const distK = new Array( 9 );

	function distribute( j ) {

		let best = Infinity;
		let bestK = 1;
		for ( let k = 1; k < j; k ++ ) {

			const value = node.left.sahCost[ k ] + node.right.sahCost[ j - k ];
			if ( value < best ) {

				best = value;
				bestK = k;

			}

		}

		distK[ j ] = bestK;
		return best;

	}

	// binary leaves larger than maxLeafSize cannot be subdivided further, so the leaf cap only
	// applies when merging an internal subtree into a new leaf (Eq. 6)
	const leafCost = node.primitiveCount <= maxLeafSize
		? area * node.primitiveCount * CWBVH_SAH_TRIANGLE_COST
		: Infinity;
	const internalCost = distribute( 8 ) + area * CWBVH_SAH_NODE_COST;

	if ( leafCost <= internalCost ) {

		cost[ 1 ] = leafCost;
		node.sahLeaf = true;

	} else {

		cost[ 1 ] = internalCost;
		node.sahLeaf = false;

	}

	for ( let i = 2; i <= 7; i ++ ) {

		const distributed = distribute( i );
		if ( distributed < cost[ i - 1 ] ) {

			cost[ i ] = distributed;
			decision[ i ] = distK[ i ];

		} else {

			cost[ i ] = cost[ i - 1 ];

		}

	}

	node.sahCost = cost;
	node.sahDecision = decision;
	node.sahDistK = distK[ 8 ];

}

// Backtracks the stored decisions to collect the optimal forest of at most "roots" wide nodes
// for the subtree of "node", as { bounds, isLeaf, node } child entries. A leaf-optimal subtree
// ( sahLeaf ) only collapses into a single leaf at one root - when granted more roots it still
// follows the stored split decisions, which may be strictly cheaper. Binary leaves carry no
// decision table and contribute themselves regardless of the quota they are granted.
function collectWideChildren( node, roots, out ) {

	if ( roots === 1 || node.isLeaf || node.count === 0 ) {

		out.push( { bounds: node.bounds, isLeaf: node.sahLeaf, node } );
		return;

	}

	const k = node.sahDecision[ roots ];
	if ( k === 0 ) {

		collectWideChildren( node, roots - 1, out );
		return;

	}

	collectWideChildren( node.left, k, out );
	collectWideChildren( node.right, roots - k, out );

}

function readTree( root, nodeIndex ) {

	const float32 = new Float32Array( root );
	const uint32 = new Uint32Array( root );
	const uint16 = new Uint16Array( root );

	return readNode( nodeIndex );

	function readNode( index ) {

		const index32 = index * UINT32_PER_NODE;
		const index16 = index32 * 2;
		const bounds = Array.from( float32.subarray( index32, index32 + 6 ) );

		if ( IS_LEAF( index16, uint16 ) ) {

			const count = COUNT( index16, uint16 );
			return {
				bounds,
				offset: OFFSET( index32, uint32 ),
				count,
				primitiveCount: count,
				isLeaf: true,
			};

		}

		const left = readNode( index + 1 );
		const right = readNode( RIGHT_NODE( index32, uint32 ) / UINT32_PER_NODE );
		return {
			bounds,
			left,
			right,

			// a subtree's primitives are contiguous in the index buffer, so internal nodes
			// can be collapsed into leaves referencing the merged range
			offset: left.offset,
			count: left.count + right.count,
			primitiveCount: left.primitiveCount + right.primitiveCount,
			isLeaf: false,
		};

	}

}

function getQuantization( bounds ) {

	const origin = new Array( 3 );
	const exponent = new Array( 3 );
	const scale = new Array( 3 );

	for ( let axis = 0; axis < 3; axis ++ ) {

		const min = bounds[ axis ];
		const max = bounds[ axis + 3 ];
		origin[ axis ] = nextFloatDown( min );

		let axisExponent = - 126;
		if ( max > origin[ axis ] ) {

			axisExponent = Math.ceil( Math.log2( ( max - origin[ axis ] ) / 255 ) );

		}

		axisExponent = Math.max( - 126, Math.min( 127, axisExponent ) );
		let axisScale = Math.pow( 2, axisExponent );
		while ( Math.fround( origin[ axis ] + 255 * axisScale ) < max && axisExponent < 127 ) {

			axisExponent ++;
			axisScale *= 2;

		}

		if ( Math.fround( origin[ axis ] + 255 * axisScale ) < max ) {

			throw new Error( 'CWBVHBuilder: Bounds cannot be represented with 8-bit quantization.' );

		}

		exponent[ axis ] = axisExponent;
		scale[ axis ] = axisScale;

	}

	return { origin, exponent, scale };

}

function quantizeMin( value, origin, scale ) {

	let result = Math.max( 0, Math.min( 255, Math.floor( ( value - origin ) / scale ) ) );
	while ( result > 0 && Math.fround( origin + result * scale ) > value ) result --;
	return result;

}

function quantizeMax( value, origin, scale ) {

	let result = Math.max( 0, Math.min( 255, Math.ceil( ( value - origin ) / scale ) ) );
	while ( result < 255 && Math.fround( origin + result * scale ) < value ) result ++;
	return result;

}

function packBytes( target, offset, values ) {

	for ( let word = 0; word < 2; word ++ ) {

		let value = 0;
		for ( let byte = 0; byte < 4; byte ++ ) {

			value |= values[ word * 4 + byte ] << ( byte * 8 );

		}

		target[ offset + word ] = value >>> 0;

	}

}

// Worst-case number of traversal stack entries, where each entry is a 64-bit group referencing
// up to 8 children of one parent. Each wide-tree level pushes at most two groups ( a node-group
// remainder plus a node or leaf group deferred while leaves are processed ), and the tree root
// adds one pseudo group.
function getMaxStackSize( nodes, nodeIndex ) {

	let depth = 0;
	walk( nodeIndex, 0 );
	return 1 + 2 * depth;

	function walk( index, level ) {

		const node = nodes[ index ];
		for ( let i = 0; i < MAX_CHILDREN; i ++ ) {

			const slot = node.slots[ i ];
			if ( slot !== null && slot.nodeIndex !== undefined ) {

				walk( slot.nodeIndex, level + 1 );

			}

		}

		depth = Math.max( depth, level );

	}

}

/**
 * Converts packed binary BVH roots into 8-way, quantized CWBVH nodes. Multiple trees can be
 * appended so TLAS leaves can reference BLAS root indices in the same node array.
 *
 * The 80-byte layout follows the compressed-wide design described by Ylitie et al. while keeping
 * leaf ranges in a compact side buffer so existing MeshBVH leaf sizes remain supported. Binary
 * nodes are collapsed into wide nodes with the paper's SAH-optimal dynamic program (Section 3.4),
 * which jointly optimizes internal and leaf nodes under the input tree's topology constraint.
 * @see https://research.nvidia.com/publication/2017-07_efficient-incoherent-ray-traversal-gpus-through-compressed-wide-bvhs
 */
export class CWBVHBuilder {

	constructor() {

		this.nodes = [];
		this.leaves = [];

	}

	/**
	 * @param {ArrayBuffer|SharedArrayBuffer} root
	 * @param {number} nodeIndex
	 * @param {(offset:number,count:number) => {value:number|(() => number), meta:number}} getLeaf
	 * @param {number} [maxLeafSize=CWBVH_MAX_LEAF_SIZE] - cap on primitives per wide leaf when the
	 * SAH-optimal collapse merges an internal subtree into a leaf. Use 1 for trees whose leaves
	 * must keep referencing a single primitive (e.g. TLAS leaves referencing one BLAS each).
	 * @returns {{root:number,nodeCount:number,maxStackSize:number}}
	 */
	add( root, nodeIndex, getLeaf, maxLeafSize = CWBVH_MAX_LEAF_SIZE ) {

		if ( root.byteLength % BYTES_PER_NODE !== 0 ) {

			throw new Error( 'CWBVHBuilder: Invalid packed BVH buffer.' );

		}

		const tree = readTree( root, nodeIndex );
		computeSahCosts( tree, maxLeafSize );
		const start = this.nodes.length;
		this.nodes.push( null );
		this._writeNode( tree, start, getLeaf );

		return {
			root: start,
			nodeCount: this.nodes.length - start,
			maxStackSize: getMaxStackSize( this.nodes, start ),
		};

	}

	build() {

		// 3 float origins, 3 signed byte exponents, child / leaf bases, 6 x 8 byte
		// quantized bounds arrays, and 8 metadata bytes.
		const nodeBuffer = new ArrayBuffer( this.nodes.length * CWBVH_NODE_BYTES );
		const nodeF32 = new Float32Array( nodeBuffer );
		const nodeU32 = new Uint32Array( nodeBuffer );

		for ( let i = 0, l = this.nodes.length; i < l; i ++ ) {

			const node = this.nodes[ i ];
			const index = i * CWBVH_NODE_U32;
			for ( let axis = 0; axis < 3; axis ++ ) nodeF32[ index + axis ] = node.origin[ axis ];

			nodeU32[ index + 3 ] =
				( node.exponent[ 0 ] & 0xff ) |
				( ( node.exponent[ 1 ] & 0xff ) << 8 ) |
				( ( node.exponent[ 2 ] & 0xff ) << 16 );
			nodeU32[ index + 4 ] = node.childBase;
			nodeU32[ index + 5 ] = node.leafBase;

			for ( let bound = 0; bound < 6; bound ++ ) {

				packBytes( nodeU32, index + 6 + bound * 2, node.quantizedBounds[ bound ] );

			}

			packBytes( nodeU32, index + 18, node.metadata );

		}

		const leafBuffer = new Uint32Array( this.leaves.length * 2 );
		for ( let i = 0, l = this.leaves.length; i < l; i ++ ) {

			const leaf = this.leaves[ i ];
			const value = typeof leaf.value === 'function' ? leaf.value() : leaf.value;
			if ( ! Number.isInteger( value ) || value < 0 || value > 0xffffffff ) {

				throw new Error( `CWBVHBuilder: Leaf value ${ value } cannot be represented as uint32.` );

			}

			leafBuffer[ i * 2 ] = value;
			leafBuffer[ i * 2 + 1 ] = leaf.meta;

		}

		return { nodes: new Uint32Array( nodeBuffer ), leaves: leafBuffer };

	}

	_writeNode( tree, nodeIndex, getLeaf ) {

		// expand the root of this wide node into the SAH-optimal forest of up to 8 children.
		// A "leaf" decision ( or a binary leaf root ) collapses the whole subtree into one leaf.
		const children = [];
		if ( ! tree.isLeaf && ! tree.sahLeaf && tree.count > 0 ) {

			collectWideChildren( tree.left, tree.sahDistK, children );
			collectWideChildren( tree.right, MAX_CHILDREN - tree.sahDistK, children );

		} else if ( tree.count > 0 ) {

			children.push( { bounds: tree.bounds, isLeaf: true, node: tree } );

		}

		const slots = assignSlots( children, tree.bounds );
		const internalSlots = slots.filter( child => child !== null && ! child.isLeaf );
		const childBase = internalSlots.length === 0 ? 0 : this.nodes.length;
		for ( let i = 0, l = internalSlots.length; i < l; i ++ ) this.nodes.push( null );

		const leafBase = this.leaves.length;
		const metadata = new Array( MAX_CHILDREN ).fill( 0 );
		let leafOffset = 0;
		let internalOffset = 0;

		for ( let slot = 0; slot < MAX_CHILDREN; slot ++ ) {

			const child = slots[ slot ];
			if ( child === null ) continue;

			if ( child.isLeaf ) {

				metadata[ slot ] = 0x40 | leafOffset;
				this.leaves.push( getLeaf( child.node.offset, child.node.count ) );
				leafOffset ++;

			} else {

				child.nodeIndex = childBase + internalOffset;
				metadata[ slot ] = 0x80 | internalOffset;
				internalOffset ++;

			}

		}

		if ( leafOffset > MAX_CHILDREN || this.leaves.length > MAX_LEAF_INDEX ) {

			throw new Error( 'CWBVHBuilder: Leaf index exceeds the compressed node encoding.' );

		}

		const { origin, exponent, scale } = getQuantization( tree.bounds );
		const quantizedBounds = Array.from( { length: 6 }, () => new Array( MAX_CHILDREN ).fill( 0 ) );
		for ( let slot = 0; slot < MAX_CHILDREN; slot ++ ) {

			const child = slots[ slot ];
			if ( child === null ) continue;

			for ( let axis = 0; axis < 3; axis ++ ) {

				quantizedBounds[ axis * 2 ][ slot ] = quantizeMin( child.bounds[ axis ], origin[ axis ], scale[ axis ] );
				quantizedBounds[ axis * 2 + 1 ][ slot ] = quantizeMax( child.bounds[ axis + 3 ], origin[ axis ], scale[ axis ] );

			}

		}

		this.nodes[ nodeIndex ] = {
			origin,
			exponent,
			childBase,
			leafBase,
			quantizedBounds,
			metadata,
			slots,
		};

		for ( let slot = 0; slot < MAX_CHILDREN; slot ++ ) {

			const child = slots[ slot ];
			if ( child !== null && ! child.isLeaf ) {

				this._writeNode( child.node, child.nodeIndex, getLeaf );

			}

		}

	}

}
