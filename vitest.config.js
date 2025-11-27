import { defineConfig } from 'vitest/config';

export default defineConfig( {
	test: {
		environment: 'jsdom',
		globals: true,
		pool: 'forks',
		poolOptions: {
			forks: {
				singleFork: false,
			},
		},
	},
	worker: {
		format: 'es',
	},
	server: {
		fs: {
			allow: [ '.' ],
		},
	},
} );
