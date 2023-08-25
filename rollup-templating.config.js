import * as glob from 'glob';
import { preprocess } from 'preprocess';

function generateStars( num ) {

	let result = '';
	for ( let i = 0; i < num; i ++ ) {

		result += '*';

	}

	return result;

}

const preprocessPlugin = options => {

	return {
		name: 'preprocess',
		transform: ( code, id ) => {

			const file = id.split( /[/\/]/g ).pop();
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

