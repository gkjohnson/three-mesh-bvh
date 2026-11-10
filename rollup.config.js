import { readFileSync } from 'fs';
import { REVISION } from 'three';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

const { version } = JSON.parse( readFileSync( './package.json', 'utf8' ) );

// Self-contained, minified copies of the worker scripts with three.js bundled in. They are
// classic scripts with no imports so they can be loaded into a Worker from a blob url when the
// worker module can't be loaded directly, such as when the library is loaded from a CDN.
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
