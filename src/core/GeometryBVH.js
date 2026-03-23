/** @import { BufferGeometry } from 'three' */
import { Box3 } from 'three';
import { SKIP_GENERATION, DEFAULT_OPTIONS } from './Constants.js';
import { isSharedArrayBufferSupported } from '../utils/BufferUtils.js';
import { ensureIndex, getRootPrimitiveRanges } from './build/geometryUtils.js';
import { BVH } from './BVH.js';

// construct a new buffer that points to the set of triangles represented by the given ranges
export function generateIndirectBuffer( ranges, useSharedArrayBuffer ) {

	const lastRange = ranges[ ranges.length - 1 ];
	const useUint32 = lastRange.offset + lastRange.count > 2 ** 16;

	// use getRootIndexRanges which excludes gaps
	const length = ranges.reduce( ( acc, val ) => acc + val.count, 0 );
	const byteCount = useUint32 ? 4 : 2;
	const buffer = useSharedArrayBuffer ? new SharedArrayBuffer( length * byteCount ) : new ArrayBuffer( length * byteCount );
	const indirectBuffer = useUint32 ? new Uint32Array( buffer ) : new Uint16Array( buffer );

	// construct a compact form of the triangles in these ranges
	let index = 0;
	for ( let r = 0; r < ranges.length; r ++ ) {

		const { offset, count } = ranges[ r ];
		for ( let i = 0; i < count; i ++ ) {

			indirectBuffer[ index + i ] = offset + i;

		}

		index += count;

	}

	return indirectBuffer;

}

/**
 * Abstract base class for geometry-backed BVH implementations. Handles geometry
 * indexing, indirect mode, and bounding box initialization. Subclasses implement
 * primitive-specific bounds computation and raycasting via `writePrimitiveBounds`
 * and `raycastObject3D`.
 *
 * @param {BufferGeometry} geometry
 * @param {Object} [options]
 * @param {number} [options.strategy=CENTER] - Split strategy: `CENTER`, `AVERAGE`, or `SAH`.
 * @param {number} [options.maxDepth=40] - Maximum tree depth.
 * @param {number} [options.maxLeafSize=10] - Maximum primitives per leaf node.
 * @param {boolean} [options.setBoundingBox=true] - Set `geometry.boundingBox` if not already present.
 * @param {boolean} [options.useSharedArrayBuffer=false] - Use `SharedArrayBuffer` for BVH root buffers.
 * @param {boolean} [options.indirect=false] - Build using an indirect buffer, leaving the original index unmodified.
 * @param {boolean} [options.verbose=true] - Log build progress to the console.
 * @param {Function|null} [options.onProgress=null] - Called with a progress value in [0, 1] during build.
 * @param {Object|null} [options.range=null] - Restrict the BVH to a specific geometry group range.
 * @extends BVH
 */
export class GeometryBVH extends BVH {

	/**
	 * Whether the BVH was built in indirect mode.
	 * @type {boolean}
	 * @readonly
	 */
	get indirect() {

		return ! ! this._indirectBuffer;

	}

	get primitiveStride() {

		return null;

	}

	get primitiveBufferStride() {

		return this.indirect ? 1 : this.primitiveStride;

	}
	set primitiveBufferStride( v ) {}

	get primitiveBuffer() {

		return this.indirect ? this._indirectBuffer : this.geometry.index.array;

	}
	set primitiveBuffer( v ) {}

	constructor( geometry, options = {} ) {

		if ( ! geometry.isBufferGeometry ) {

			throw new Error( 'BVH: Only BufferGeometries are supported.' );

		} else if ( geometry.index && geometry.index.isInterleavedBufferAttribute ) {

			throw new Error( 'BVH: InterleavedBufferAttribute is not supported for the index attribute.' );

		}

		if ( options.useSharedArrayBuffer && ! isSharedArrayBufferSupported() ) {

			throw new Error( 'BVH: SharedArrayBuffer is not available.' );

		}

		super();

		// retain references to the geometry so we can use them it without having to
		// take a geometry reference in every function.

		/**
		 * The geometry this BVH was built from.
		 * @type {BufferGeometry}
		 * @readonly
		 */
		this.geometry = geometry;
		this.resolvePrimitiveIndex = options.indirect ? i => this._indirectBuffer[ i ] : i => i;
		this.primitiveBuffer = null;
		this.primitiveBufferStride = null;
		this._indirectBuffer = null;

		options = {
			...DEFAULT_OPTIONS,
			...options,
		};

		// build the BVH unless we're deserializing
		if ( ! options[ SKIP_GENERATION ] ) {

			this.init( options );

		}

	}

	init( options ) {

		const { geometry, primitiveStride } = this;

		if ( options.indirect ) {

			// construct an buffer that is indirectly sorts the triangles used for the BVH
			const ranges = getRootPrimitiveRanges( geometry, options.range, primitiveStride );
			const indirectBuffer = generateIndirectBuffer( ranges, options.useSharedArrayBuffer );
			this._indirectBuffer = indirectBuffer;

		} else {

			ensureIndex( geometry, options );

		}

		super.init( options );

		if ( ! geometry.boundingBox && options.setBoundingBox ) {

			geometry.boundingBox = this.getBoundingBox( new Box3() );

		}

	}

	// Abstract methods to be implemented by subclasses
	getRootRanges( range ) {

		// TODO: can we avoid passing options in here
		if ( this.indirect ) {

			return [ { offset: 0, count: this._indirectBuffer.length } ];


		} else {

			return getRootPrimitiveRanges( this.geometry, range, this.primitiveStride );

		}

	}

	raycastObject3D( /* object, raycaster, intersects = [] */ ) {

		throw new Error( 'BVH: raycastObject3D() not implemented' );

	}

}
