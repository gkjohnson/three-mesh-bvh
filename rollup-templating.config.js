import * as glob from 'glob';
import { preprocess } from 'preprocess';

// The purpose of this file is to transform any template files into both "direct" and "indirect"
// variants to support retaining performance in the non-indirect bvh construction and casting cases.

// generates set of stars
function generateStars( num ) {

	let result = '';
	for ( let i = 0; i < num; i ++ ) {

		result += '*';

	}

	return result;

}

// Runs the preprocess package on the files with the provided env options
const preprocessPlugin = options => {

	return {
		name: 'preprocess',
		transform: ( code, id ) => {

			const file = id.split( /[/\\]/g ).pop();
			const stars = generateStars( file.length );
			return {
				code:
					`/***********************************${ stars }/\n` +
					`/* This file is generated from "${ file }". */\n` +
					`/***********************************${ stars }/\n` +
					preprocess( code, options, { type: 'js' } ),
			};

		}

	};

};

// Transforms every template.js files into a sibling directory with and without "indirect" flags
export default glob.sync( './src/**/*.template.js' )
	.flatMap( input => [ {
		input,
		plugins: [ preprocessPlugin( { INDIRECT: true, INDIRECT_STRING: '_indirect' } ) ],
		external: () => true,
		output: {
			file: input.replace( /\.template\.js$/, '_indirect.generated.js' ),
		},
	}, {
		input,
		plugins: [ preprocessPlugin( { INDIRECT: false, INDIRECT_STRING: '' } ) ],
		external: () => true,
		output: {
			file: input.replace( /\.template\.js$/, '.generated.js' ),
		},
	} ] );

