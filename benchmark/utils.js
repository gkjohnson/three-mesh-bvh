// https://stackoverflow.com/questions/1248302/how-to-get-the-size-of-a-javascript-object
function getPrimitiveSize( el ) {

	switch ( typeof el ) {

		case 'number':
			return 8;
		case 'string':
			return el.length * 2;
		case 'boolean':
			return 4;
		default:
			return 0;

	}

}

function getSize( obj ) {

	const traversed = [ ];
	const stack = [ obj ];
	let bytes = 0;

	while ( stack.length ) {

		const curr = stack.pop();
		if ( traversed.includes( curr ) ) continue;
		traversed.push( curr );

		for ( let key in curr ) {

			if ( ! curr.hasOwnProperty( key ) ) continue;

			bytes += getPrimitiveSize( key );

			const value = curr[ key ];
			if ( value && ( typeof value === 'object' || typeof value === 'function' ) ) {

				stack.push( value );

			} else {

				bytes += getPrimitiveSize( value );

			}


		}

	}

	return bytes;

}

function pad( str, len ) {

	let res = str;
	while ( res.length < len ) {

		res += ' ';

	}

	return res;

}

export { getSize, pad };
