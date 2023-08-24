import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const CRITICAL_ONLY = process.argv.includes( '--critical' );
const __filename = fileURLToPath( import.meta.url );
const __dirname = dirname( __filename );

const prData = JSON.parse( fs.readFileSync( join( __dirname, '../pr-benchmark.json' ) ) );
const maData = JSON.parse( fs.readFileSync( join( __dirname, '../master-benchmark.json' ) ) );

const exclude = [ 'iterations', 'name' ];
for ( let i = 0; i < prData.length; i ++ ) {

	const prInfo = prData[ i ];
	const maInfo = maData[ i ];

	const prResults = prInfo.results;
	const maResults = maInfo.results;

	let finalTable = '';
	for ( let j = 0; j < prResults.length; j ++ ) {

		const prData = prResults[ j ];
		const maData = maResults[ j ];

		let result = '';
		for ( const key in prData ) {

			if ( exclude.includes( key ) ) continue;

			const prValue = prData[ key ];
			const maValue = maData[ key ];
			const delta = prValue - maValue;
			const perc = delta === 0 ? 0 : delta / maValue;

			if ( CRITICAL_ONLY && perc > 3 || ! CRITICAL_ONLY ) {

				const star = perc > 1 ? '*&nbsp;' : '&nbsp;&nbsp;';
				result += `| ${ star } ${ key } | ${ maValue.toFixed( 5 ) } ms | ${ prValue.toFixed( 5 ) } ms | ${ delta.toFixed( 5 ) } ms | ${ ( perc * 100 ).toFixed( 5 ) } % |\n`;

			}

		}

		if ( result ) {

			finalTable += `| ${ prData.name } | | | | |\n`;
			finalTable += result;

		}

	}

	if ( finalTable ) {

		console.log( `\n**${ prInfo.name }**` );
		console.log( '| | before | after | delta | increase |' );
		console.log( '|---|---|---|---|---|' );
		console.log( finalTable );

	}

}
