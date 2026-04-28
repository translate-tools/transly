import { globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import paths from 'eslint-plugin-paths';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unusedImports from 'eslint-plugin-unused-imports';
import { readFileSync } from 'fs';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import cspellPlugin from '@cspell/eslint-plugin';
import eslint from '@eslint/js';

const readLinesInFile = (file: string) =>
	readFileSync(file, { encoding: 'utf8' }).split('\n');

export default tseslint.config(
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

			// Types
			// TODO: enable and fix all cases
			'@typescript-eslint/no-require-imports': 'off',
			'@typescript-eslint/unbound-method': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/require-await': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-invalid-void-type': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-misused-promises': 'off',
			'@typescript-eslint/no-unnecessary-condition': 'off',
			'@typescript-eslint/no-floating-promises': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-empty-function': 'off',
			'@typescript-eslint/restrict-plus-operands': 'off',
			'@typescript-eslint/await-thenable': 'off',
			'@typescript-eslint/no-confusing-void-expression': 'off',
			'@typescript-eslint/use-unknown-in-catch-callback-variable': 'off',
			'@typescript-eslint/prefer-optional-chain': 'off',
			'@typescript-eslint/no-redundant-type-constituents': 'off',
			'@typescript-eslint/no-dynamic-delete': 'off',
			'@typescript-eslint/unified-signatures': 'off',
			'@typescript-eslint/prefer-for-of': 'off',
			'class-methods-use-this': 'off',
			'@typescript-eslint/no-unnecessary-type-constraint': 'off',
			'@typescript-eslint/return-await': 'off',
			'@typescript-eslint/no-unnecessary-type-parameters': 'off',
			'@typescript-eslint/prefer-promise-reject-errors': 'off',
			'@typescript-eslint/no-deprecated': 'off',
			'@typescript-eslint/no-misused-spread': 'off',
			'@typescript-eslint/no-non-null-assertion': 'off',
			'@typescript-eslint/no-for-in-array': 'off',
			'@typescript-eslint/no-this-alias': 'off',

			// Disabled, because force programmers to cast anything to `String()` with no profit
			'@typescript-eslint/restrict-template-expressions': 'off',
			// Disabled, since case with `or, if empty` is too frequent
			'@typescript-eslint/prefer-nullish-coalescing': 'off',
			// Disabled, since conflict with many cases where third party property is not in camelCase
			'@typescript-eslint/dot-notation': 'off',
			// Disabled, because replaced `type` to `interface` and it makes type is incompatible with an `Record`/object
			'@typescript-eslint/consistent-type-definitions': 'off',
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

	// React
	{
		files: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
		extends: [
			react.configs.flat['recommended']!,
			reactHooks.configs.flat['recommended-latest'],
		],
		settings: {
			react: {
				version: 'detect',
			},
		},
		languageOptions: {
			parserOptions: {
				ecmaFeatures: {
					jsx: true,
				},
			},
			globals: {
				...globals.browser,
			},
		},
		rules: {
			'react/prop-types': 'off',
			'react/no-unescaped-entities': 'off',
			'react/display-name': 'off',
			'react/no-deprecated': 'off',

			'react-hooks/refs': 'off',
			'react-hooks/set-state-in-effect': 'off',

			// TODO: find option for specify immutable objects for improve consistency
			// for example in `src/hooks/useLiveRef.ts` required as deps a `forceUpdate`
			// but setter from `useState` is never required
			'react-hooks/exhaustive-deps': [
				'warn',
				{
					// custom hooks with deps
					additionalHooks:
						'(useEqualMemo|useImmutableCallback|useIsomorphicLayoutEffect)',
				},
			],

			'react/jsx-curly-brace-presence': [
				'error',
				{
					props: 'never',
					children: 'never',
				},
			],
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
