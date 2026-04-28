import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/cli.ts', 'src/index.ts'],
	format: ['esm', 'cjs'],
	dts: true,
	outputOptions: {
		entryFileNames: '[name].js',
		chunkFileNames: '[name].js',
		assetFileNames: '[name][extname]', // ← key line
	},
});
