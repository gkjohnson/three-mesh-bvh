import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import vitest from '@vitest/eslint-plugin';
import globals from 'globals';
import mdcs from 'eslint-config-mdcs';

export default [
	{
		ignores: [ '**/*.generated.js', '**/node_modules/**', '**/build/**' ],
	},
	js.configs.recommended,
	{
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
			'no-unused-vars': [ 'error', { args: 'none' } ],
			'no-inner-declarations': 'off',
			'no-constant-condition': 'off',
		},
	},
	{
		files: [ '**/*.ts' ],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				ecmaVersion: 2020,
				sourceType: 'module',
			},
		},
		plugins: {
			'@typescript-eslint': tseslint,
		},
		rules: {
			'no-unused-vars': [ 'error', { args: 'none' } ],
			'indent': [ 'error', 'tab' ],
		},
	},
	{
		files: [ '**/*.test.js', '**/*.test.ts' ],
		plugins: {
			vitest,
		},
		languageOptions: {
			globals: {
				...vitest.environments.env.globals,
				...globals.node,
			},
		},
		rules: {
			...vitest.configs.recommended.rules,
			'vitest/no-disabled-tests': 'warn',
			'vitest/no-focused-tests': 'error',
			'vitest/no-identical-title': 'error',
			'vitest/prefer-to-have-length': 'warn',
			'vitest/valid-expect': 'error',
			'vitest/valid-describe-callback': 0,
		},
	},
];
