/* eslint-disable */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );
const inputPath = path.resolve( __dirname, '../src/castFunctions.template.js' );
const outputPath = path.resolve( __dirname, '../src/castFunctions.js' );
let contents = fs.readFileSync( inputPath, { encoding: 'utf8' } );

contents = replaceFunctionMacro( contents, 'IS_LEAF', '( $2[ $1 + 15 ] === 0xFFFF )' );
contents = replaceFunctionMacro( contents, 'OFFSET', '$2[ $1 + 6 ]' );
contents = replaceFunctionMacro( contents, 'COUNT', '$2[ $1 + 14 ]' );
contents = replaceFunctionMacro( contents, 'LEFT_NODE', '$1 + 8' );
contents = replaceFunctionMacro( contents, 'RIGHT_NODE', '$2[ $1 + 6 ]' );
contents = replaceFunctionMacro( contents, 'SPLIT_AXIS', '$2[ $1 + 7 ]' );
contents = replaceFunctionMacro( contents, 'BOUNDING_DATA_INDEX', '$1' );
contents = '/* Generated from "castFunctions.template.js". Do not edit. */\n' + contents;

fs.writeFileSync( outputPath, contents );

function replaceFunctionMacro( contents, name, body ) {

	const functionRegexp = new RegExp( `function\\s+${ name }[^{]+{[^}]+}([\n\r]*)?` );
	const regexp = new RegExp( `(function )?${ name }\\((.*?)\\)`, 'g' );
	return contents
		.replace( functionRegexp, () => {

			return '';

		} )
		.replace( regexp, ( match, funcToken, arg ) => {

			let result = body;
			const args = arg.split( /,/g );
			for ( let i = 0; i < args.length; i ++ ) {

				result = result.replace( `$${ i + 1 }`, args[ i ].trim() );

			}

			return result;

		} );

}
