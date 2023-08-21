import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pad } from './utils.js';

const __filename = fileURLToPath( import.meta.url );
const __dirname = dirname( __filename );

const prData = JSON.parse( fs.readFileSync( join( __dirname, '../pr-benchmark.json' ) ) );
const maData = JSON.parse( fs.readFileSync( join( __dirname, '../master-benchmark.json' ) ) );

const info = [];
let skipped = 0;
for ( let i = 0; i < prData.length; i ++ ) {

	const prInfo = prData[ i ];
	const maInfo = maData[ i ];
	const key = prInfo.key.replace( /\t/g, '  ' );

	if ( prInfo.key !== maInfo.key ) {

		skipped ++;

	}

	if ( prInfo.key === '' ) {

		continue;

	}

	if ( prInfo.value === null ) {

		info.push( { key: key } );
		continue;

	}

	const maValue = parseFloat( maInfo.value );
	const prValue = parseFloat( prInfo.value );

	const unit = maInfo.value.replace( /[\s\d\.]+/g, '' );
	const delta = prValue - maValue;
	const perc = delta / maValue;

	info.push( {
		key: key,
		before: maValue,
		after: prValue,
		delta: delta,
		perc: perc,
		unit: unit,
	} );

}

const isOverThreshold = v => v.perc && v.perc > 0.03;
info.forEach( v => {

	if ( isOverThreshold( v ) ) {

		const line = [
			'  ' + pad( v.key, 40 ),
			pad( `${ v.before.toFixed( 4 ) } ${ v.unit }`, 15 ),
			pad( `${ v.after.toFixed( 4 ) } ${ v.unit }`, 15 ),
			pad( `${ v.delta.toFixed( 4 ) } ${ v.unit }`, 15 ),
			pad( `${ ( 100 * v.perc ).toFixed( 3 ) } %`, 15 ),
		];
		console.log( line.join( '| ' ) );

	}

} );

console.log();
console.log();
console.log();

info.forEach( v => {

	let line = [
		pad( v.key, 40 ),
		pad( '', 15 ),
		pad( '', 15 ),
		pad( '', 15 ),
		pad( '', 15 ),
	];

	if ( v.perc ) {

		line = [
			( isOverThreshold( v ) ? '* ' : '  ' ) + pad( v.key, 40 ),
			pad( `${ v.before.toFixed( 4 ) } ${ v.unit }`, 15 ),
			pad( `${ v.after.toFixed( 4 ) } ${ v.unit }`, 15 ),
			pad( `${ v.delta.toFixed( 4 ) } ${ v.unit }`, 15 ),
			pad( `${ ( 100 * v.perc ).toFixed( 3 ) } %`, 15 ),
		];

	}

	if ( v.key[ 0 ] === '*' ) {

		console.log();

	}

	console.log( line.join( '| ' ) );

} );

// console.log( JSON.stringify( info, null, '\t' ) );

