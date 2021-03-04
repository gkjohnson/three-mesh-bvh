/* eslint-disable */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );
const inputPath = path.resolve( __dirname, '../src/castFunctions.template.js' );
const outputPath = path.resolve( __dirname, '../src/castFunctions.js' );
let contents = fs.readFileSync( inputPath, { encoding: 'utf8' } );

contents = replaceFunctionMacro( contents, 'IS_LEAF', '( uint16Array[ $1 + 15 ] === 0xFFFF )' );
contents = replaceFunctionMacro( contents, 'OFFSET', 'uint32Array[ $1 + 6 ]' );
contents = replaceFunctionMacro( contents, 'COUNT', 'uint16Array[ $1 + 14 ]' );
contents = replaceFunctionMacro( contents, 'LEFT_NODE', '$1 + 8' );
contents = replaceFunctionMacro( contents, 'RIGHT_NODE', 'uint32Array[ $1 + 6 ]' );
contents = replaceFunctionMacro( contents, 'SPLIT_AXIS', 'uint32Array[ $1 + 7 ]' );
contents = replaceFunctionMacro( contents, 'BOUNDING_DATA_INDEX', '$1' );

fs.writeFileSync( outputPath, contents );

function replaceFunctionMacro( contents, name, body ) {

	const regexp = new RegExp( `${ name }\\((.*?)\\)`, 'g' );
	return contents.replace( regexp, ( match, arg ) => {

		return body.replace( /\$1/g, arg.trim() );

	} );

}
