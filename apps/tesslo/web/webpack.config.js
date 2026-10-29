const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

const guiDist = path.dirname(require.resolve('@scratch/scratch-gui'));

module.exports = {
    mode: 'production',
    target: 'web',
    entry: path.resolve(__dirname, 'src/index.jsx'),
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'main.js',
        publicPath: ''
    },
    devtool: false,
    module: {
        rules: [
            {
                test: /\.jsx?$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: [
                            ['@babel/preset-env', {targets: 'defaults'}],
                            ['@babel/preset-react', {runtime: 'classic'}]
                        ]
                    }
                }
            }
        ]
    },
    resolve: {
        extensions: ['.js', '.jsx']
    },
    plugins: [
        new CopyPlugin({
            patterns: [
                {from: path.resolve(__dirname, 'src/index.html'), to: 'index.html'},
                {from: path.join(guiDist, 'static'), to: 'static'},
                {
                    from: path.join(guiDist, 'libraries'),
                    to: 'static/libraries',
                    flatten: true
                },
                {
                    from: 'extension-worker.{js,js.map}',
                    context: guiDist,
                    noErrorOnMissing: true
                },
                {from: path.join(guiDist, 'chunks'), to: 'chunks'}
            ]
        })
    ],
    performance: {hints: false}
};
