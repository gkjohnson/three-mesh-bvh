import * as glob from 'glob';
import { preprocess } from 'preprocess';

const preprocessPlugin = options => {

	return {
		name: 'preprocess',
		transform: code => {

			return {
				code:
					'/* THIS FILE IS GENERATED */\n' +
					preprocess( code, options, { type: 'js' } ),
			};

		}

	};

};

export default glob.sync( './src/core/cast/*.js' )
	.flatMap( input => [ {
		input,
		plugins: [ preprocessPlugin( { INDIRECT: true, INDIRECT_STRING: '_indirect' } ) ],
		external: () => true,
		output: {
			file: input.replace( /\.template\.js$/, '_indirect.js' ),
		},
	}, {
		input,
		plugins: [ preprocessPlugin( { INDIRECT: false, INDIRECT_STRING: '' } ) ],
		external: () => true,
		output: {
			file: input.replace( /\.template\.js$/, '.js' ),
		},
	} ] );

