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

	}
];
