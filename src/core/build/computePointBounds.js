import { FLOAT32_EPSILON } from '../Constants.js';

// Computes bounds for points
export function computePointBounds( geometry, offset, count, indirectBuffer = null, target = null ) {

	const posAttr = geometry.attributes.position;
	const needsIndirectBuffer = indirectBuffer && indirectBuffer !== posAttr.array;

	let result;
	if ( target ) {

		result = target;

	} else {

		// Use SharedArrayBuffer if the indirect buffer is a SharedArrayBuffer
		const BufferConstructor = needsIndirectBuffer && indirectBuffer.buffer instanceof SharedArrayBuffer
			? SharedArrayBuffer
			: ArrayBuffer;

		const buffer = new BufferConstructor( 6 * count * 4 );
		result = new Float32Array( buffer );

	}

	const boundsOffset = result.offset || 0;
	for ( let i = offset, end = offset + count; i < end; i ++ ) {

		const pointIndex = needsIndirectBuffer ? indirectBuffer[ i ] : i;
		const baseIndex = ( i - boundsOffset ) * 6;

		// Get point position
		const px = posAttr.getX( pointIndex );
		const py = posAttr.getY( pointIndex );
		const pz = posAttr.getZ( pointIndex );

		// For points, center equals position and half extents are zero (with epsilon for stability)
		const eps = FLOAT32_EPSILON * Math.max( Math.abs( px ), Math.abs( py ), Math.abs( pz ) );

		// [centerX, halfExtentX, centerY, halfExtentY, centerZ, halfExtentZ]
		result[ baseIndex + 0 ] = px;
		result[ baseIndex + 1 ] = eps;
		result[ baseIndex + 2 ] = py;
		result[ baseIndex + 3 ] = eps;
		result[ baseIndex + 4 ] = pz;
		result[ baseIndex + 5 ] = eps;

	}

	return result;

}
