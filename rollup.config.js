import { readFileSync } from 'fs';
import { REVISION } from 'three';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

const { version } = JSON.parse( readFileSync( './package.json', 'utf8' ) );

// self-contained worker scripts with three.js bundled in, used as a fallback via blob urls
function bundledWorker( name ) {

	return {
		input: `./src/workers/${ name }.worker.js`,
		plugins: [ nodeResolve(), terser() ],

		output: {

			format: 'iife',
			file: `./src/workers/${ name }.bundled.worker.js`,
			banner: `/*! three-mesh-bvh ${ version }, generated from "${ name }.worker.js" with three.js r${ REVISION } bundled */`,

		},

	};

}

export default [
	{
		input: './src/index.js',
		treeshake: false,
		external: p => /^three/.test( p ),

		output: {

			name: 'MeshBVHLib',
			extend: true,
			format: 'umd',
			file: './build/index.umd.cjs',
			sourcemap: true,

			globals: p => /^three/.test( p ) ? 'THREE' : null,

		},

	},
	{
		input: './src/index.js',
		treeshake: false,
		external: p => /^three/.test( p ),

		output: {

			format: 'esm',
			file: './build/index.module.js',
			sourcemap: true,

		},

	},
	bundledWorker( 'generateMeshBVH' ),
	bundledWorker( 'parallelMeshBVH' ),
];
