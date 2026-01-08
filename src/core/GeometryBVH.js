import { Box3 } from 'three';
import { SKIP_GENERATION, DEFAULT_OPTIONS } from './Constants.js';
import { isSharedArrayBufferSupported } from '../utils/BufferUtils.js';
import { getRootPrimitiveRanges } from './build/geometryUtils.js';
import { BVH } from './BVH.js';

export class GeometryBVH extends BVH {

	get indirect() {

		return ! ! this._indirectBuffer;

	}

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
		this.geometry = geometry;
		this.resolvePrimitiveIndex = options.indirect ? i => this._indirectBuffer[ i ] : i => i;
		this.primitiveStride = null;
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

		const { geometry } = this;

		super.init( options );

		if ( ! geometry.boundingBox && options.setBoundingBox ) {

			geometry.boundingBox = this.getBoundingBox( new Box3() );

		}

	}

	// Abstract methods to be implemented by subclasses
	computePrimitiveBounds( /* offset, count */ ) {

		throw new Error( 'BVH: computePrimitiveBounds() not implemented' );

	}

	getRootRanges( range ) {

		// TODO: can we avoid passing options in here
		return getRootPrimitiveRanges( this.geometry, range, this.primitiveStride );

	}

	raycastObject3D( /* object, raycaster, intersects = [] */ ) {

		throw new Error( 'BVH: raycastObject3D() not implemented' );

	}

	shapecast( callbacks ) {

		let {
			iterateDirect,
			iterateIndirect,
			...rest
		} = callbacks;

		const selectedIterateFunc = this.indirect ? iterateIndirect : iterateDirect;
		return super.shapecast( {
			...rest,
			iterate: selectedIterateFunc,
		} );

	}

}
