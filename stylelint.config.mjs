/** @type {import('stylelint').Config} */
export default {
	extends: ['stylelint-config-standard'],
	rules: {
		'selector-class-pattern': '.+',
	},
	ignoreFiles: ['**/*.ts', '**/*.tsx'],
};
