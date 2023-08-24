import * as glob from 'glob';
import { preprocess } from 'preprocess';

const preprocessPlugin = () => {

	return {
		name: 'preprocess',
		transform: code => {

			return {
				code: preprocess( code, { INDIRECT: 'test()' }, { type: 'js' } ),
			};

		}

	};

};

export default [ {
	input: glob.sync( './src/core/cast/*.js' ),
	plugins: [ preprocessPlugin() ],
	external: () => true,
	output: {
		dir: './src/core/cast-indirect/',
	},
} ];
