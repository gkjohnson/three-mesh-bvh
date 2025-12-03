import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import vitest from '@vitest/eslint-plugin';
import globals from 'globals';
import mdcs from 'eslint-config-mdcs';

export default [
	// files to ignore
	{
		ignores: [
			'**/*.generated.js',
			'**/node_modules/**',
			'**/build/**',
		],
	},

	// recommended settings
	js.configs.recommended,

	// js & ts settings
	{
		files: [ '**/*.js', '**/*.ts' ],
		languageOptions: {
			ecmaVersion: 2020,
			sourceType: 'module',
			parser: tsparser,
			parserOptions: {
				ecmaVersion: 2020,
				sourceType: 'module',
			},
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
		plugins: {
			'@typescript-eslint': tseslint,
		},
		rules: {
			...mdcs.rules,
		},
	},

	// typescript declaration files
	{
		files: [ '**/*.d.ts' ],
		rules: {
			'no-unused-vars': 'off',
		},
	},

	// vitest
	{
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
