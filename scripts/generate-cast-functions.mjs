import fs from 'fs';
import path from 'path';

function addHeaderComment( str ) {

	return `
/**************************************************************************************************
 *
 * This file is generated from castFunctions.js and scripts/generate-cast-function.mjs. Do not edit.
 *
 *************************************************************************************************/
` + str;

}

function replaceNodeNames( str ) {

	const coerce = ( name, count = 4 ) => {

		return name === 'node' ? `stride${ count }Offset` : name;

	};

	const map = {

		'(\\w+)\\.boundingData': name => `float32Array[ ${ coerce( name ) } ]`,
		'(\\w+)\\.offset': name => `uint32Array[ ${ coerce( name ) } + 6 ]`,

		'! ! (\\w+)\\.count': name => `uint16Array[ ${ coerce( name, 2 ) } ] === 0xffff`,
		'(\\w+)\\.count': name => `uint16Array[ ${ coerce( name, 2 ) } + 14 ]`,

		'(\\w+)\\.left': name => `${ coerce( name ) } + 8`,
		'(\\w+)\\.right': name => `uint32Array[ ${ coerce( name ) } + 6 ]`,
		'(\\w+)\\.splitAxis': name => `uint32Array[ ${ coerce( name ) } + 7 ]`,

	};

	Object.entries( map ).forEach( ( [ key, value ] ) => {

		str = str.replace(
			new RegExp( key, 'g' ),
			( match, name ) => {

				return `/* ${ match.replace( '.', ' ' ) } */ ` + value( name );

			}
		);

	} );

	return str;

}

function replaceFunctionNames( str ) {

	const arr = [

		'\\sraycast',
		'\\sraycastFirst',
		'\\sshapecast',
		'\\sintersectsGeometry'

	];

	const defRegexp = new RegExp( '(' + arr.join( '|' ) + ')\\((\\s|\\n)?node', 'gm' );
	const callRegexp = new RegExp( '(' + arr.join( '|' ) + ')\\(', 'gm' );
	const constRegexp = new RegExp( 'const(' + arr.join( '|' ) + ')', 'gm' );

	return str
		.replace( defRegexp, ( match, funcName ) => `${ funcName }Buffer( stride4Offset` )
		.replace( callRegexp, ( match, funcName ) => `${ funcName }Buffer(` )
		.replace( constRegexp, ( match, funcName ) => `const${ funcName }Buffer` );

}

function replaceFunctionCalls( str ) {

	return str
		.replace( /arrayToBox\(/g, 'arrayToBoxBuffer(' )
		.replace( /intersectRay\(/g, 'intersectRayBuffer(' );

}

function removeUnneededCode( str ) {

	const continueGenerationRegexp = new RegExp( 'if \\( node.continueGeneration \\)(.|\n)*?}\n', 'mg' );
	const intersectRayRegexp = new RegExp( 'function intersectRay\\((.|\n)*?}\n', 'mg' );
	return str
		.replace( continueGenerationRegexp, 'const stride2Offset = stride4Offset * 2;' )
		.replace( intersectRayRegexp, '' );

}

function addFunctions( str ) {

	const instersectsRayBuffer =
`
function intersectRayBuffer( stride4Offset, ray, target ) {

	arrayToBoxBuffer( stride4Offset, boundingBox );
	return ray.intersectBox( boundingBox, target );

}`;

	const setBuffer =
`
let float32Array;
let uint16Array;
let uint32Array;
export function setBuffer( buffer ) {

	float32Array = new Float32Array( buffer );
	uint16Array = new Uint16Array( buffer );
	uint32Array = new Uint32Array( buffer );

}

export function clearBuffer() {

	float32Array = null;
	uint16Array = null;
	uint32Array = null;

}
`;

	const arrayToBoxBuffer =
`
function arrayToBoxBuffer( stride4Offset, target ) {

	target.min.x = float32Array[ stride4Offset ];
	target.min.y = float32Array[ stride4Offset + 1 ];
	target.min.z = float32Array[ stride4Offset + 2 ];

	target.max.x = float32Array[ stride4Offset + 3 ];
	target.max.y = float32Array[ stride4Offset + 4 ];
	target.max.z = float32Array[ stride4Offset + 5 ];

}
`;

	return str + arrayToBoxBuffer + instersectsRayBuffer + setBuffer;


}


const templatePath = path.resolve( './src/castFunctions.js' );
const bufferFilePath = path.resolve( './src/castFunctionsBuffer.js' );
const str = fs.readFileSync( templatePath, { encoding: 'utf8' } );

let result = str;
result = replaceNodeNames( result );
result = removeUnneededCode( result );
result = replaceFunctionNames( result );
result = addFunctions( result );
result = replaceFunctionCalls( result );
result = addHeaderComment( result );
fs.writeFileSync( bufferFilePath, result );
