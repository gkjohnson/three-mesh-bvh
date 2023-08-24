
const NAME_WIDTH = 35;
const COLUMN_WIDTH = 20;
const SEPARATOR = '|';
const SPACE = '&nbsp;&nbsp;&nbsp;';

function pad( str, len, char = ' ' ) {

	let res = str;
	while ( res.length < len ) {

		res += char;

	}

	return res;

}

export function logObjectAsRows( info, exclude = [ 'name', 'iterations', 'table' ], depth = 1 ) {

	for ( const key in info ) {

		if ( exclude.includes( key ) ) continue;

		if ( typeof info[ key ] === 'object' ) {

			logObjectAsRows( info[ key ], exclude, depth + 1 );

		} else {

			const value = typeof info[ key ] === 'string' ? info[ key ] : `${ info[ key ].toFixed( 5 ) } ms`;
			console.log( SEPARATOR + pad( pad( '', depth, SPACE ) + key, NAME_WIDTH ) + SEPARATOR + pad( value, COLUMN_WIDTH ) + SEPARATOR );

		}

	}

}

export function logTable( info, columns = [] ) {

	if ( info.name ) {

		console.log( `**${ info.name }**` );

	}

	if ( columns.length > 0 ) {

		let row = SEPARATOR + pad( '', NAME_WIDTH ) + SEPARATOR;
		let split = '|---|';
		columns.forEach( key => {

			row += pad( key, COLUMN_WIDTH ) + SEPARATOR;
			split += '---|';

		} );
		console.log( row );
		console.log( split );

	} else {

		console.log( '| | Values |' );
		console.log( '|---|---|' );

	}

	info.results.forEach( data => {

		if ( data.table ) {

			console.log( SEPARATOR + pad( data.name, NAME_WIDTH ) + SEPARATOR );
			logObjectAsRows( data.table );

		} else if ( columns.length > 0 ) {

			let row = SEPARATOR + pad( data.name, NAME_WIDTH ) + SEPARATOR;
			columns.forEach( key => {

				if ( ! ( key in data ) ) {

					row += pad( `--`, COLUMN_WIDTH ) + SEPARATOR;

				} else {

					const value = typeof data[ key ] === 'string' ? data[ key ] : `${ data[ key ].toFixed( 5 ) } ms`;
					row += pad( value, COLUMN_WIDTH ) + SEPARATOR;

				}

			} );
			console.log( row );

		} else {

			console.log( SEPARATOR + pad( data.name, NAME_WIDTH ) + SEPARATOR );
			logObjectAsRows( data );

		}

	} );
	console.log();

}
