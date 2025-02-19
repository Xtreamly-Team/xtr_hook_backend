module.exports = {
	env: {
		browser: false,
		es2021: true,
		node: true,
	},
	parser: '@typescript-eslint/parser', // Specifies the ESLint parser
	extends: [
		'eslint:recommended',
		'plugin:@typescript-eslint/recommended',
		'plugin:prettier/recommended', // Integrates Prettier with ESLint
	],
	parserOptions: {
		ecmaVersion: 12, // Latest ECMAScript version you want to support
		sourceType: 'module',
	},
	rules: {
		// Enforce tab-based indentation
		indent: ['error', 'tab'],
		// Disallow the use of tabs for line indentation (since we're using tabs)
		'no-tabs': 'off',
		// Ensure consistent use of tabs in import/export
		'no-mixed-spaces-and-tabs': ['error', 'smart-tabs'],
		// Other custom rules can go here
		// Example: Enforce single quotes
		quotes: ['error', 'single'],
		// Example: Enforce semicolons
		semi: ['error', 'always'],
	},
};
