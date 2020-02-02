export default {
	input: './src/index.js',
	treeshake: false,
	external: p => /^three/.test( p ),

	output: {

		name: 'MeshBVHLib',
		extend: true,
		format: 'umd',
		file: './umd/index.js',
		sourcemap: true,

		globals: p => /^three/.test( p ) ? 'THREE' : null,

	},

};
