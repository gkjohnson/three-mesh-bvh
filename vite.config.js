import { searchForWorkspaceRoot } from 'vite';
import fs from 'fs';

export default {

	root: './example/',
	build: {
		outDir: './bundle/',
		rollupOptions: {
			input: fs
				.readdirSync( './example/' )
				.filter( p => /\.html$/.test( p ) )
				.map( p => `./example/${ p }` ),
		},
	},
	server: {
		fs: {
			allow: [
				// search up for workspace root
				searchForWorkspaceRoot( process.cwd() ),
			],
		},
	}

};
