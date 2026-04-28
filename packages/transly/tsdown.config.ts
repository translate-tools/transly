import fs from 'fs';
import path from 'path';
import { defineConfig } from 'tsdown';

const root = process.cwd();

const publishDir = path.join(root, '.publish');
const distDir = path.join(root, 'dist');

function copyRecursive(src: string, dest: string) {
	fs.cpSync(src, dest, { recursive: true });
}

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		cli: 'src/cli/index.ts',
	},
	format: ['esm', 'cjs'],
	dts: true,
	exports: true,
	hash: false,

	plugins: [
		{
			name: 'prepare-publish',
			closeBundle() {
				fs.rmSync(publishDir, { recursive: true, force: true });
				fs.mkdirSync(publishDir, { recursive: true });

				// move dist → publish
				copyRecursive(distDir, path.join(publishDir, 'dist'));

				// copy metadata
				for (const file of [
					'package.json',
					{ from: '../../README.md', to: 'README.md' },
					{ from: '../../assets/demo.gif', to: 'assets/demo.gif' },
					{ from: '../../LICENSE', to: 'LICENSE' },
				]) {
					const { from, to } =
						typeof file === 'string' ? { from: file, to: file } : file;

					const src = path.resolve(path.join(root, from));
					if (!fs.existsSync(src))
						throw new Error(`File "${src}" is not found`);

					const writePath = path.join(publishDir, to);
					fs.mkdirSync(path.dirname(path.resolve(writePath)), {
						recursive: true,
					});
					fs.copyFileSync(src, writePath);
				}
			},
		},
	],
});
