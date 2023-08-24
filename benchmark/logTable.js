
const NAME_WIDTH = 35;
const COLUMN_WIDTH = 20;

function pad( str, len ) {

	let res = str;
	while ( res.length < len ) {

		res += ' ';

	}

	return res;

}

export function logObjectAsRows( info, exclude = [ 'name', 'iterations' ], depth = 1 ) {

	for ( const key in info ) {

		if ( exclude.includes( key ) ) continue;

		if ( typeof info[ key ] === 'object' ) {

			logObjectAsRows( info[ key ], exclude, depth + 1 );

		} else {

			console.log( pad( pad( '', depth ) + key, NAME_WIDTH ) + pad( info[ key ].toFixed( 5 ) + ' ms', COLUMN_WIDTH ) );

		}

	}

}

export function logTable( info, columns = [] ) {

	console.log( `*${ info.name }*` );

	if ( columns.length > 0 ) {

		let row = pad( '', NAME_WIDTH );
		columns.forEach( key => {

			row += pad( key, COLUMN_WIDTH );

		} );
		console.log( row );

	}

	info.results.forEach( data => {

		if ( columns.length > 0 ) {

			let row = pad( data.name, NAME_WIDTH );
			columns.forEach( key => {

				if ( ! ( key in data ) ) {

					row += pad( `--`, COLUMN_WIDTH );

				} else {

					row += pad( `${ data[ key ].toFixed( 5 ) } ms`, COLUMN_WIDTH );

				}

			} );
			console.log( row );

		} else {

			console.log( pad( data.name, NAME_WIDTH ) );
			logObjectAsRows( data );

		}

	} );
	console.log();

}
