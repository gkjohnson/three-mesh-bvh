import {
	writeQuantizationFrame,
	writeQuantizedBounds,
	readQuantizedBounds,
	appendBVHSubtree,
	getSubtreeNodeCount,
	QUANTIZED_BOUNDS_MAX,
	GPU_BYTES_PER_NODE,
	GPU_UINT32_PER_NODE,
} from '../src/webgpu/utils/packBVHBufferUtils.js';
import { BYTES_PER_NODE, UINT32_PER_NODE, IS_LEAFNODE_FLAG } from '../src/core/Constants.js';
import { IS_LEAF } from '../src/core/utils/nodeBufferUtils.js';
import { TorusKnotGeometry } from 'three';
import { MeshBVH } from '../src/index.js';

// two source nodes: the frame bounds at node 0 and the child bounds at node 1
function createNodes( frameMin, frameMax, childMin, childMax ) {

	const nodes = new Float32Array( 2 * BYTES_PER_NODE / 4 );
	nodes.set( [ ...frameMin, ...frameMax ], 0 );
	nodes.set( [ ...childMin, ...childMax ], UINT32_PER_NODE );
	return nodes;

}

function roundTrip( nodes ) {

	const frame = new Float32Array( 6 );
	const quantized = new Uint16Array( 6 );
	const decoded = new Float32Array( 6 );
	writeQuantizationFrame( nodes, 0, frame, 0 );
	writeQuantizedBounds( nodes, 1, frame, 0, quantized, 0 );
	readQuantizedBounds( quantized, 0, frame, 0, decoded, 0 );
	return { frame, quantized, decoded };

}

describe( 'Quantized Bounds', () => {

	// the decode as a GPU that fuses the multiply-add does it: the product is exact in 64 bit floats
	const fusedDecode = ( frame, quantized, c, q ) => Math.fround( frame[ c ] + quantized[ q ] * frame[ c + 3 ] );

	it( 'should decode to a box that contains the source box within one step.', () => {

		let seed = 1;
		const random = () => {

			seed = ( seed * 16807 ) % 2147483647;
			return seed / 2147483647;

		};

		// collected in plain JS and asserted once, since an expect call per check makes this loop take seconds
		const failures = [];
		for ( let i = 0; i < 20000; i ++ ) {

			// frames of varied scale, some far from the origin
			const scale = 10 ** ( random() * 8 - 4 );
			const offset = i % 3 === 0 ? 0 : ( random() - 0.5 ) * scale * 100;
			const frameMin = [];
			const frameMax = [];
			const childMin = [];
			const childMax = [];
			for ( let c = 0; c < 3; c ++ ) {

				const fMin = Math.fround( offset + random() * scale );
				const fMax = Math.fround( fMin + random() * scale );
				const a = Math.fround( fMin + random() * ( fMax - fMin ) );
				const b = Math.fround( fMin + random() * ( fMax - fMin ) );
				frameMin.push( fMin );
				frameMax.push( fMax );

				// every so often the child touches the frame
				childMin.push( i % 5 === 0 ? fMin : Math.min( a, b ) );
				childMax.push( i % 7 === 0 ? fMax : Math.max( a, b ) );

			}

			const nodes = createNodes( frameMin, frameMax, childMin, childMax );
			const { frame, quantized, decoded } = roundTrip( nodes );
			for ( let c = 0; c < 3; c ++ ) {

				const vMin = nodes[ UINT32_PER_NODE + c ];
				const vMax = nodes[ UINT32_PER_NODE + c + 3 ];

				// one step plus the float rounding of the decode
				const step = frame[ c + 3 ];
				const tolerance = step + 4 * Math.max( Math.abs( frameMin[ c ] ), Math.abs( frameMax[ c ] ) ) * 2 ** - 23;
				if (
					! ( decoded[ c ] <= vMin ) ||
					! ( decoded[ c + 3 ] >= vMax ) ||
					! ( fusedDecode( frame, quantized, c, c ) <= vMin ) ||
					! ( fusedDecode( frame, quantized, c, c + 3 ) >= vMax ) ||
					! ( vMin - decoded[ c ] <= tolerance ) ||
					! ( decoded[ c + 3 ] - vMax <= tolerance )
				) {

					failures.push( { i, c, vMin, vMax, decoded: [ decoded[ c ], decoded[ c + 3 ] ] } );

				}

			}

		}

		expect( failures.slice( 0, 5 ) ).toEqual( [] );

	} );

	it( 'should reproduce the frame bounds when the child fills the frame.', () => {

		const nodes = createNodes( [ - 1, 2, 100 ], [ 3, 2, 100.5 ], [ - 1, 2, 100 ], [ 3, 2, 100.5 ] );
		const { quantized, decoded } = roundTrip( nodes );
		expect( Array.from( quantized.subarray( 0, 3 ) ) ).toEqual( [ 0, 0, 0 ] );
		for ( let c = 0; c < 3; c ++ ) {

			expect( decoded[ c ] ).toBe( nodes[ c ] );
			expect( decoded[ c + 3 ] ).toBeGreaterThanOrEqual( nodes[ c + 3 ] );

		}

	} );

	it( 'should keep an empty box empty.', () => {

		const nodes = createNodes( [ - 1, - 1, - 1 ], [ 1, 1, 1 ], [ Infinity, Infinity, Infinity ], [ - Infinity, - Infinity, - Infinity ] );
		const { quantized, decoded } = roundTrip( nodes );
		for ( let c = 0; c < 3; c ++ ) {

			expect( quantized[ c ] ).toBe( QUANTIZED_BOUNDS_MAX );
			expect( quantized[ c + 3 ] ).toBe( 0 );
			expect( decoded[ c ] ).toBeGreaterThan( decoded[ c + 3 ] );

		}

	} );

	it( 'should write a usable frame for empty bounds.', () => {

		const nodes = createNodes( [ Infinity, Infinity, Infinity ], [ - Infinity, - Infinity, - Infinity ], [ Infinity, Infinity, Infinity ], [ - Infinity, - Infinity, - Infinity ] );
		const { frame, decoded } = roundTrip( nodes );
		for ( let c = 0; c < 6; c ++ ) {

			expect( Number.isFinite( frame[ c ] ) ).toBe( true );

		}

		for ( let c = 0; c < 3; c ++ ) {

			expect( decoded[ c ] ).toBeGreaterThan( decoded[ c + 3 ] );

		}

	} );

	it( 'should throw for infinite bounds.', () => {

		const frame = new Float32Array( 6 );
		const nodes = createNodes( [ 0, 0, 0 ], [ Infinity, 1, 1 ], [ 0, 0, 0 ], [ 1, 1, 1 ] );
		expect( () => writeQuantizationFrame( nodes, 0, frame, 0 ) ).toThrow( 'finite' );

		nodes.set( [ 0, - Infinity, 0, 1, 1, 1 ], 0 );
		expect( () => writeQuantizationFrame( nodes, 0, frame, 0 ) ).toThrow( 'finite' );

	} );

	it( 'should pack a mesh BVH into nodes whose decoded child bounds contain the source bounds.', () => {

		const geometry = new TorusKnotGeometry( 3, 0.4, 200, 30 );
		geometry.translate( 1000, - 20, 5 );
		const root = new MeshBVH( geometry, { targetLeafSize: 4 } )._roots[ 0 ];
		const nodeCount = getSubtreeNodeCount( root, 0 );
		const target = new ArrayBuffer( nodeCount * GPU_BYTES_PER_NODE );
		appendBVHSubtree( root, 0, nodeCount, 7, 0, target );

		const rootF32 = new Float32Array( root );
		const rootU32 = new Uint32Array( root );
		const rootU16 = new Uint16Array( root );
		const targetU32 = new Uint32Array( target );
		const targetU16 = new Uint16Array( target );
		const frame = new Float32Array( 6 );
		const decoded = new Float32Array( 6 );
		writeQuantizationFrame( rootF32, 0, frame, 0 );

		let internal = 0;
		const leafFields = [];
		const expectedLeafFields = [];
		for ( let i = 0; i < nodeCount; i ++ ) {

			const r32 = i * UINT32_PER_NODE;
			const n32 = i * GPU_UINT32_PER_NODE;
			if ( IS_LEAF( r32 * 2, rootU16 ) ) {

				leafFields.push( targetU32[ n32 + 6 ], targetU16[ n32 * 2 + 14 ], targetU16[ n32 * 2 + 15 ] );
				expectedLeafFields.push( rootU32[ r32 + 6 ] + 7, rootU16[ r32 * 2 + 14 ], IS_LEAFNODE_FLAG );
				continue;

			}

			internal ++;
			expect( targetU32[ n32 + 6 ] ).toBe( rootU32[ r32 + 6 ] );
			expect( targetU32[ n32 + 7 ] ).toBe( rootU32[ r32 + 7 ] );
			[ i + 1, i + rootU32[ r32 + 6 ] ].forEach( ( child, side ) => {

				readQuantizedBounds( targetU16, n32 * 2 + side * 6, frame, 0, decoded, 0 );
				const c32 = child * UINT32_PER_NODE;
				for ( let c = 0; c < 3; c ++ ) {

					expect( decoded[ c ] ).toBeLessThanOrEqual( rootF32[ c32 + c ] );
					expect( decoded[ c + 3 ] ).toBeGreaterThanOrEqual( rootF32[ c32 + c + 3 ] );

				}

			} );

		}

		expect( internal ).toBeGreaterThan( 100 );
		expect( leafFields ).toEqual( expectedLeafFields );

	} );

} );
