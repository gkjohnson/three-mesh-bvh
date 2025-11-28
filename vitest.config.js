import { defineConfig } from 'vitest/config';

export default defineConfig( {
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: [ '@vitest/web-worker', './test/matchers/toEqualBVH.js' ],
	},
} );
