import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vitest from '@vitest/eslint-plugin';
import globals from 'globals';
import mdcs from 'eslint-config-mdcs';

export default [
	// files to ignore
	{
		name: 'files to ignore',
		ignores: [
			'**/*.generated.js',
			'**/node_modules/**',
			'**/build/**',
		],
	},

	// recommended
	js.configs.recommended,

	// base rules
	{
		name: 'base rules',
		files: [ '**/*.js', '**/*.ts' ],
		languageOptions: {
			ecmaVersion: 2020,
			sourceType: 'module',
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
		rules: {
			...mdcs.rules,
			'no-mixed-spaces-and-tabs': 'error',
		},
	},

	// ts recommended
	...tseslint.configs.recommended.map( config => ( {
		...config,
		files: [ '**/*.ts' ],
	} ) ),

	// ts rule overrides
	{
		name: 'ts rule overrides',
		files: [ '**/*.ts' ],
		rules: {
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': 'off',
		},
	},

	// vitest
	{
		name: 'vitest rules',
		files: [ '**/*.test.js', '**/*.test.ts' ],
		plugins: {
			vitest,
		},
		languageOptions: {
			globals: {
				...vitest.environments.env.globals,
			},
		},
		rules: {
			...vitest.configs.recommended.rules,
			'vitest/valid-describe-callback': 0,
		},
	},
];
