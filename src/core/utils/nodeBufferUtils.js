export function IS_LEAF( n16, array, useUint32 = false ) {

	if ( ! useUint32 ) {

		return array[ n16 + 15 ] === 0xFFFF;

	} else {

		const wordIndex = ( n16 + 15 ) >> 1;
		const word = array[ wordIndex ];
		const value = ( ( n16 + 15 ) % 2 === 0 ) ? ( word & 0xFFFF ) : ( word >>> 16 );

		return value === 0xFFFF;

	}

}

export function COUNT( n16, array, useUint32 = false ) {

	if ( ! useUint32 ) {

		return array[ n16 + 14 ];

	} else {

		const wordIndex = ( n16 + 14 ) >> 1;
		const word = array[ wordIndex ];
		const value = ( ( n16 + 14 ) % 2 === 0 ) ? ( word & 0xFFFF ) : ( word >>> 16 );

		return value;

	}

}

export function OFFSET( n32, uint32Array ) {

	return uint32Array[ n32 + 6 ];

}

export function LEFT_NODE( n32 ) {

	return n32 + 8;

}

export function RIGHT_NODE( n32, uint32Array ) {

	return uint32Array[ n32 + 6 ];

}

export function SPLIT_AXIS( n32, uint32Array ) {

	return uint32Array[ n32 + 7 ];

}

export function BOUNDING_DATA_INDEX( n32 ) {

	return n32;

}
