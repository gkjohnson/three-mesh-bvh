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
export function getFullGeometryRange( geo ) {

	const drawRange = geo.drawRange;
	const start = drawRange.start;
	const end = drawRange.start + drawRange.count;
	const triCount = getTriCount( geo );

	const offset = Math.max( 0, start / 3 );
	const count = Math.min( triCount, end / 3 ) - offset;
	return [ {
		offset: Math.floor( offset ),
		count: Math.floor( count ),
	} ];

}

export function getRootIndexRanges( geo ) {

	if ( ! geo.groups || ! geo.groups.length ) {

		return getFullGeometryRange( geo );

	}

	const ranges = [];
	const rangeBoundaries = new Set();
	for ( const group of geo.groups ) {

		rangeBoundaries.add( group.start );
		rangeBoundaries.add( group.start + group.count );

	}

	const drawRange = geo.drawRange;
	const drawRangeStart = drawRange.start;
	const drawRangeEnd = drawRange.start + drawRange.count;

	// note that if you don't pass in a comparator, it sorts them lexicographically as strings :-(
	const sortedBoundaries = Array.from( rangeBoundaries.values() ).sort( ( a, b ) => a - b );
	for ( let i = 0; i < sortedBoundaries.length - 1; i ++ ) {

		const start = sortedBoundaries[ i ] / 3;
		const end = sortedBoundaries[ i + 1 ] / 3;

		const offset = Math.max( start, drawRangeStart / 3 );
		const count = Math.min( end, drawRangeEnd / 3 ) - offset;
		ranges.push( {
			offset: Math.floor( offset ),
			count: Math.floor( count ),
		} );

	}

	return ranges;

}

export function hasGroupGaps( geometry ) {

	if ( geometry.groups.length === 0 ) {

		return false;

	}

	const vertexCount = getTriCount( geometry );
	const groups = getRootIndexRanges( geometry )
		.sort( ( a, b ) => a.offset - b.offset );

	const finalGroup = groups[ groups.length - 1 ];
	finalGroup.count = Math.min( vertexCount - finalGroup.offset, finalGroup.count );

	let total = 0;
	groups.forEach( ( { count } ) => total += count );
	return vertexCount !== total;

}
