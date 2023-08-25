import * as glob from 'glob';
import { preprocess } from 'preprocess';

const preprocessPlugin = options => {

	return {
		name: 'preprocess',
		transform: code => {

			return {
				code:
					'/****************************************/\n' +
					'/* THIS FILE IS GENERATED. DO NOT EDIT. */\n' +
					'/****************************************/\n' +
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

