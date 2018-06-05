module.exports = {
    entry: `${__dirname}/example/index.js`,
    output: {
        path: `${__dirname}/example`,
        filename: 'index.bundle.js'
    },

    module: {
        rules: []
    }
};
