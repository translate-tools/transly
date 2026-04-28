import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import paths from 'eslint-plugin-paths';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unusedImports from 'eslint-plugin-unused-imports';
import { readFileSync } from 'fs';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import cspellPlugin from '@cspell/eslint-plugin';
import eslint from '@eslint/js';

const readLinesInFile = (file: string) =>
	readFileSync(file, { encoding: 'utf8' }).split('\n');

export default defineConfig(
	eslint.configs.recommended,
	tseslint.configs.strictTypeChecked,
	tseslint.configs.stylisticTypeCheckedOnly,

	globalIgnores([
		...readLinesInFile('.prettierignore').filter(
			(rule) => rule && !rule.startsWith('#'),
		),
	]),

	// Base rules
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
			globals: {
				...globals.browser,
				...globals.node,
			},
		},

		plugins: {
			import: importPlugin,
			'unused-imports': unusedImports,
			'simple-import-sort': simpleImportSort,
			'@cspell': cspellPlugin,
			paths,
		},

		settings: {
			'import/resolver': {
				typescript: {
					alwaysTryTypes: true,
					project: './tsconfig.json',
				},
			},
		},

		rules: {
			'paths/alias': 'error',

			// Spellcheck
			'@cspell/spellchecker': [
				'warn',
				{
					cspell: {
						dictionaries: ['softwareTerms'],
						dictionaryDefinitions: [
							{
								name: 'softwareTerms',
								path: './node_modules/@cspell/dict-software-terms/cspell-ext.json',
							},
						],
						words: readLinesInFile('words.txt').filter(
							(w) => w && !w.startsWith('#'),
						),
					},
				},
			],

			// Imports
			'import/no-useless-path-segments': ['error', { noUselessIndex: true }],
			'import/no-unresolved': [
				'error',
				{
					ignore: [
						'^vitest/config',
						'^@docusaurus/',
						'^@site/',
						'^@assets/',
						'^astro:',
					],
				},
			],
			'import/export': 'off',
			'import/namespace': 'warn',
			'import/no-duplicates': ['error', { 'prefer-inline': true }],
			'import/newline-after-import': ['error', { count: 1 }],

			// Unused imports (single source of truth)
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': 'off',

			'unused-imports/no-unused-imports': 'error',
			'unused-imports/no-unused-vars': [
				'error',
				{
					args: 'all',
					argsIgnorePattern: '^_',
					caughtErrors: 'all',
					caughtErrorsIgnorePattern: '^_',
					destructuredArrayIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					ignoreRestSiblings: true,
				},
			],

			// Sorting
			'simple-import-sort/imports': [
				'error',
				{
					// docs: https://github.com/lydell/eslint-plugin-simple-import-sort#custom-grouping
					groups: [
						// Side effect imports.
						['^\\u0000'],
						// Node.js builtins prefixed with `node:`.
						['^node:'],
						// Packages.
						// Things that start with a letter (or digit or underscore), or `@` followed by a letter.
						['^react', '^\\w', '^@\\w'],
						// Absolute imports and other imports such as Vue-style `@/foo`.
						// Anything not matched in another group.
						['^'],
						// Relative imports.
						['^../../'],
						// Anything that starts with a dot.
						['^../', '^./', '^\\.'],
						// Global CSS files at bottom
						['\\.css$'],
					],
				},
			],

			// Disabled, because force programmers to cast anything to `String()` with no profit
			'@typescript-eslint/restrict-template-expressions': 'off',
			// Disabled, since case with `or, if empty` is too frequent
			'@typescript-eslint/prefer-nullish-coalescing': 'off',
			// Disabled, since conflict with many cases where third party property is not in camelCase
			'@typescript-eslint/dot-notation': 'off',
			// Disabled, because replaced `type` to `interface` and it makes type is incompatible with an `Record`/object
			'@typescript-eslint/consistent-type-definitions': 'off',
			// When we get value from an `Record` it may be actually `undefined`. So we want to use optional operator
			'@typescript-eslint/no-unnecessary-condition': 'off',

			'@typescript-eslint/prefer-readonly': 'error',
			// TODO: enable 'class-methods-use-this': ['error', { exceptMethods: [] }],
			'@typescript-eslint/no-empty-object-type': [
				'error',
				{
					allowObjectTypes: 'always',
				},
			],

			'@typescript-eslint/no-use-before-define': 'error',

			eqeqeq: ['error', 'always'],

			'no-multi-spaces': 'error',
			'no-multiple-empty-lines': 'error',
			semi: 'error',
			camelcase: [
				'error',
				{
					allow: ['^pg_', '^UNSAFE_', '^UNSTABLE_'],
				},
			],

			// Behavior
			'no-var': 'error',
			'prefer-const': 'error',
			'no-bitwise': 'error',

			'no-use-before-define': 'off',
		},
	},

	{
		files: ['**/*.test.ts'],
		extends: [tseslint.configs.disableTypeChecked],
		rules: {
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-require-imports': 'off',
			'@typescript-eslint/no-non-null-assertion': 'off',
		},
	},

	// Prevent conflicts with perrier
	prettier,

	// JS files
	{
		files: ['**/*.js', '*.{js,mjs,cjs}'],
		extends: [tseslint.configs.disableTypeChecked],
		rules: {
			'@typescript-eslint/no-require-imports': 'off',
		},
	},

	// Monorepo packages
	{
		files: ['packages/transly/**/*.ts'],
		languageOptions: {
			parserOptions: {
				projectService: {
					defaultProject: 'packages/transly/tsconfig.json',
				},
			},
		},
		settings: {
			'import/resolver': {
				typescript: {
					alwaysTryTypes: true,
					project: 'packages/transly/tsconfig.json',
				},
			},
		},
	},
);
