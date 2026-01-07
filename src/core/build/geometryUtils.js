import { BufferAttribute } from 'three';

export function getVertexCount( geo ) {

	return geo.index ? geo.index.count : geo.attributes.position.count;

}

export function getTriCount( geo ) {

	return getVertexCount( geo ) / 3;

}

export function getIndexArray( vertexCount, BufferConstructor = ArrayBuffer ) {

	if ( vertexCount > 65535 ) {

		return new Uint32Array( new BufferConstructor( 4 * vertexCount ) );

	} else {

		return new Uint16Array( new BufferConstructor( 2 * vertexCount ) );

	}

}

// ensures that an index is present on the geometry
export function ensureIndex( geo, options ) {

	if ( ! geo.index ) {

		const vertexCount = geo.attributes.position.count;
		const BufferConstructor = options.useSharedArrayBuffer ? SharedArrayBuffer : ArrayBuffer;
		const index = getIndexArray( vertexCount, BufferConstructor );
		geo.setIndex( new BufferAttribute( index, 1 ) );

		for ( let i = 0; i < vertexCount; i ++ ) {

			index[ i ] = i;

		}

	}

}

// Computes the set of { offset, count } ranges which need independent BVH roots. Each
// region in the geometry index that belongs to a different set of material groups requires
// a separate BVH root, so that triangles indices belonging to one group never get swapped
// with triangle indices belongs to another group. For example, if the groups were like this:
//
// [-------------------------------------------------------------]
// |__________________|
//   g0 = [0, 20]  |______________________||_____________________|
//                      g1 = [16, 40]           g2 = [41, 60]
//
// we would need four BVH roots: [0, 15], [16, 20], [21, 40], [41, 60].
function getFullPrimitiveRange( geo, range, stride ) {

	const primitiveCount = getVertexCount( geo ) / stride;
	const drawRange = range ? range : geo.drawRange;
	const start = drawRange.start / stride;
	const end = ( drawRange.start + drawRange.count ) / stride;

	const offset = Math.max( 0, start );
	const count = Math.min( primitiveCount, end ) - offset;
	return {
		offset: Math.floor( offset ),
		count: Math.floor( count ),
	};

}

function getPrimitiveGroupRanges( geo, stride ) {

	return geo.groups.map( group => ( {
		offset: group.start / stride,
		count: group.count / stride,
	} ));

}

// Function that extracts a set of mutually exclusive ranges representing the primitives being
// drawn as determined by the geometry groups, draw range, and user specified range
export function getRootPrimitiveRanges( geo, range, stride ) {

	const drawRange = getFullPrimitiveRange( geo, range, stride );
	const primitiveRanges = getPrimitiveGroupRanges( geo, stride );
	if ( ! primitiveRanges.length ) {

		return [ drawRange ];

	}

	const ranges = [];
	const drawRangeStart = drawRange.offset;
	const drawRangeEnd = drawRange.offset + drawRange.count;

	// Create events for group boundaries
	const primitiveCount = getVertexCount( geo ) / stride;
	const events = [];
	for ( const group of primitiveRanges ) {

		// Account for cases where group size is set to Infinity
		const { offset, count } = group;
		const groupStart = offset;
		const groupCount = isFinite( count ) ? count : ( primitiveCount - offset );
		const groupEnd = ( offset + groupCount );

		// Only add events if the group intersects with the draw range
		if ( groupStart < drawRangeEnd && groupEnd > drawRangeStart ) {

			events.push( { pos: Math.max( drawRangeStart, groupStart ), isStart: true } );
			events.push( { pos: Math.min( drawRangeEnd, groupEnd ), isStart: false } );

		}

	}

	// Sort events by position, with 'end' events before 'start' events at the same position
	events.sort( ( a, b ) => {

		if ( a.pos !== b.pos ) {

			return a.pos - b.pos;

		} else {

			return a.type === 'end' ? - 1 : 1;

		}

	} );

	// sweep through events and create ranges where activeGroups > 0
	let activeGroups = 0;
	let lastPos = null;
	for ( const event of events ) {

		const newPos = event.pos;
		if ( activeGroups !== 0 && newPos !== lastPos ) {

			ranges.push( {
				offset: lastPos,
				count: newPos - lastPos,
			} );

		}

		activeGroups += event.isStart ? 1 : - 1;
		lastPos = newPos;

	}

	return ranges;

}
