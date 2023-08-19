import { BufferAttribute } from 'three';

// ensures that an index is present on the geometry
export function ensureIndex( geo, options ) {

	if ( ! geo.index ) {

		const vertexCount = geo.attributes.position.count;
		const BufferConstructor = options.useSharedArrayBuffer ? SharedArrayBuffer : ArrayBuffer;
		let index;
		if ( vertexCount > 65535 ) {

			index = new Uint32Array( new BufferConstructor( 4 * vertexCount ) );

		} else {

			index = new Uint16Array( new BufferConstructor( 2 * vertexCount ) );

		}

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

	const triCount = ( geo.index ? geo.index.count : geo.attributes.position.count ) / 3;
	return [ { offset: 0, count: triCount } ];

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

	// note that if you don't pass in a comparator, it sorts them lexicographically as strings :-(
	const sortedBoundaries = Array.from( rangeBoundaries.values() ).sort( ( a, b ) => a - b );
	for ( let i = 0; i < sortedBoundaries.length - 1; i ++ ) {

		const start = sortedBoundaries[ i ], end = sortedBoundaries[ i + 1 ];
		ranges.push( { offset: ( start / 3 ), count: ( end - start ) / 3 } );

	}

	return ranges;

}
