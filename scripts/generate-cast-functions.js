const fs = require( 'fs' );
const path = require( 'path' );

// Replace unneeded function definitions and checks. The `continueGeneration` block is always at the top of
// a function definition so we can replace that with local variable definitions we need.
function replaceUnneededCode( str ) {

	str = str.replace(
		/\/\* INSERT_BUFFER_VARS \*\//mg,
		match => {

			if ( match.indexOf( '/* skip */' ) !== - 1 ) {

				return '';

			} else {

				return 'let stride2Offset = stride4Offset * 2, ' +
					'float32Array = _float32Array, ' +
					'uint16Array = _uint16Array, ' +
					'uint32Array = _uint32Array;\n';

			}

		}

	);

	str = str.replace( /function intersectRay\((.|[\r\n])*?}[\r|\n]/mg, '' );

	str = str.replace( /import { arrayToBox.*?;[\r\n]/g, '' );

	return str;

}

// Replace function calls with buffer variants defined in the added functions.
function replaceFunctionCalls( str ) {

	str = str.replace( /arrayToBox\((.*?),/g, ( match, arg ) => {

		return `arrayToBoxBuffer(${ arg }, float32Array,`;

	} );

	str = str.replace( /intersectRay\((.*?),/g, ( match, arg ) => {

		return `intersectRayBuffer(${ arg }, float32Array,`;

	} );

	return str;

}

function replaceNodeNames( str ) {

	const convertName = ( name, count = 4 ) => {

		return name === 'node' ? `stride${ count }Offset` : name;

	};

	const names = 'c1|c2|left|right|node';

	str = str.replace(
		new RegExp( `(${ names })\\.boundingData\\[(.*)\\]\\[(.*)\\]`, 'g' ),
		( match, name, index, index2 ) => `/* ${ name } boundingData */ float32Array[ ${ convertName( name ) } +${ index }+${ index2 }]`
	);

	str = str.replace(
		new RegExp( `(${ names })\\.boundingData\\[(.*)\\]`, 'g' ),
		( match, name, index ) => `/* ${ name } boundingData */ float32Array[ ${ convertName( name ) } +${ index }]`
	);

	str = str.replace(
		new RegExp( `(${ names })\\.boundingData`, 'g' ),
		( match, name ) => `/* ${ name } boundingData */ ${ convertName( name ) }`
	);

	str = str.replace(
		new RegExp( `(${ names })\\.offset`, 'g' ),
		( match, name ) => `/* ${ name } offset */ uint32Array[ ${ convertName( name ) } + 6 ]`
	);

	str = str.replace(
		new RegExp( `! (${ names })\\.count`, 'g' ),
		( match, name ) => `/* ${ name } count */ ( uint16Array[ ${ convertName( name, 2 ) } + 15 ] !== 0xffff )`
	);

	str = str.replace(
		new RegExp( `(${ names })\\.count`, 'g' ),
		( match, name ) => `/* ${ name } count */ uint16Array[ ${ convertName( name, 2 ) } + 14 ]`
	);

	str = str.replace(
		new RegExp( `(${ names })\\.left`, 'g' ),
		( match, name ) => `/* ${ name } left */ ${ convertName( name ) } + 8`
	);

	str = str.replace(
		new RegExp( `(${ names })\\.right`, 'g' ),
		( match, name ) => `/* ${ name } right */ uint32Array[ ${ convertName( name ) } + 6 ]`
	);

	str = str.replace(
		new RegExp( `(${ names })\\.splitAxis`, 'g' ),
		( match, name ) => `/* ${ name } splitAxis */ uint32Array[ ${ convertName( name ) } + 7 ]`
	);

	str = str.replace(
		new RegExp( `(node)\\s*=([^;]*);`, 'g' ),
		( match, name, content ) => {

			return `/* ${ name } */ stride4Offset =${ content }, stride2Offset = stride4Offset * 2;`;

		}
	);

	return str;

}

function replaceFunctionNames( str ) {

	const orNames = '\\s(raycast|raycastFirst|shapecast|intersectsGeometry|getLeftOffset|getRightEndOffset)';

	str = str.replace(
		new RegExp( `(${ orNames })\\(([\\s\\r\\n]+)?node`, 'gm' ),
		( match, funcName ) => {

			return `${ funcName }Buffer( stride4Offset`;

		}
	);

	str = str.replace(
		new RegExp( `(${ orNames })\\(`, 'gm' ),
		( match, funcName ) => {

			return `${ funcName }Buffer(`;

		}
	);

	str = str.replace(
		new RegExp( `const(${ orNames })`, 'gm' ),
		( match, funcName ) => {

			return `const${ funcName }Buffer`;

		}
	);

	return str;

}

function addFunctions( str ) {

	str = str + `

function intersectRayBuffer( stride4Offset, array, ray, target ) {

	arrayToBoxBuffer( stride4Offset, array, boundingBox );
	return ray.intersectBox( boundingBox, target );

}

const bufferStack = [];
let _prevBuffer;
let _float32Array;
let _uint16Array;
let _uint32Array;
export function setBuffer( buffer ) {

	if ( _prevBuffer ) {

		bufferStack.push( _prevBuffer );

	}

	_prevBuffer = buffer;
	_float32Array = new Float32Array( buffer );
	_uint16Array = new Uint16Array( buffer );
	_uint32Array = new Uint32Array( buffer );

}

export function clearBuffer() {

	_prevBuffer = null;
	_float32Array = null;
	_uint16Array = null;
	_uint32Array = null;

	if ( bufferStack.length ) {

		setBuffer( bufferStack.pop() );

	}

}

function arrayToBoxBuffer( stride4Offset, array, target ) {

	target.min.x = array[ stride4Offset ];
	target.min.y = array[ stride4Offset + 1 ];
	target.min.z = array[ stride4Offset + 2 ];

	target.max.x = array[ stride4Offset + 3 ];
	target.max.y = array[ stride4Offset + 4 ];
	target.max.z = array[ stride4Offset + 5 ];

}
`;

	return str;

}

function addHeaderComment( str ) {

	str = `
/**************************************************************************************************
 *
 * This file is generated from castFunctions.js and scripts/generate-cast-function.mjs. Do not edit.
 *
 *************************************************************************************************/
` + str;

	return str;

}

const templatePath = path.resolve( './src/castFunctions.js' );
const bufferFilePath = path.resolve( './src/castFunctionsBuffer.js' );
const str = fs.readFileSync( templatePath, { encoding: 'utf8' } );

let result = str;
result = replaceUnneededCode( result );
result = replaceFunctionCalls( result );
result = replaceNodeNames( result );
result = replaceFunctionNames( result );
result = addFunctions( result );
result = addHeaderComment( result );
result = result.replace( /^[ \t]+$/gm, '' );
result = result.replace( /[\n\r]{3,}/g, '\n\n' );
fs.writeFileSync( bufferFilePath, result );
