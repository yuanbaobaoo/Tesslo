const path = require('path');
const fsExtra = require('fs-extra');

const HtmlWebpackPlugin = require('html-webpack-plugin');

const CopyWebpackPlugin = require('copy-webpack-plugin');

const makeConfig = require('./webpack.makeConfig.js');

const getModulePath = moduleName => path.dirname(require.resolve(`${moduleName}`));

// Keep React/Redux singletons on the desktop copy. Without this, webpack's
// symlinks:false setting resolves the workspace GUI's copy separately from the
// renderer's copy, which breaks hooks at runtime.
const getPackageRoot = moduleName => {
    let dir = path.dirname(require.resolve(moduleName, {paths: [__dirname]}));
    while (!fsExtra.existsSync(path.join(dir, 'package.json'))) {
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return dir;
};

const reactAliases = Object.fromEntries(
    ['react', 'react-dom', 'react-redux', 'redux'].map(name => [name, getPackageRoot(name)])
);

const generateIndexFile = template => {
    let html = template;

    if (process.env.NODE_ENV !== 'production') {
        html = html.replace(
            '</head>', '<script>require("source-map-support/source-map-support.js").install()</script></head>'
        );
    }

    const filePath = path.join('dist', '.renderer-index-template.html');
    fsExtra.outputFileSync(filePath, html);
    return `!!html-loader?minimize=false&attributes=false!${filePath}`;
};

const template = fsExtra.readFileSync('src/renderer/index.html', {encoding: 'utf8'});

module.exports = makeConfig(
    {
        target: 'electron-renderer',
        entry: {
            renderer: './src/renderer/index.js'
        },
        context: path.resolve(__dirname),
        resolve: {
            alias: reactAliases
        },
        externals: [
            'source-map-support',
            'electron',
            'webpack'
        ],
        output: {
            filename: '[name].js',
            assetModuleFilename: 'static/assets/[name].[hash][ext]',
            chunkFilename: '[name].bundle.js',
            libraryTarget: 'commonjs2',
            path: path.resolve(__dirname, 'dist/renderer')
        },
        module: {
            rules: [
                {
                    test: /\.node$/,
                    use: 'node-loader'
                },
                {
                    test: /\.(html)$/,
                    use: {loader: 'html-loader'}
                }
            ]
        }
    },
    {
        name: 'renderer',
        useReact: true,
        disableDefaultRulesForExtensions: ['js', 'jsx', 'css', 'svg', 'png', 'wav', 'gif', 'jpg', 'ttf'],
        babelPaths: [
            path.resolve(__dirname, 'src', 'renderer'),
            /node_modules[\\/]+@scratch[\\/]+[^\\/]+[\\/]+src/,
            /node_modules[\\/]+pify/,
            /node_modules[\\/]+@vernier[\\/]+godirect/
        ],
        plugins: [
            new HtmlWebpackPlugin({
                filename: 'index.html',
                template: generateIndexFile(template),
                minify: false
            }),
            new CopyWebpackPlugin({
                patterns: [
                    {
                        from: path.join(getModulePath('@scratch/scratch-gui'), 'static'),
                        to: 'static'
                    },
                    {
                        from: 'extension-worker.{js,js.map}',
                        context: getModulePath('@scratch/scratch-gui')
                    },
                    {
                        from: path.join(getModulePath('@scratch/scratch-gui'), 'libraries'),
                        to: 'static/libraries',
                        flatten: true
                    },
                    {
                        // We need to copy the chunks for translating tutorial images for
                        // the tutorial translations to work.
                        from: path.join(getModulePath('@scratch/scratch-gui'), 'chunks'),
                        to: 'chunks'
                    }
                    // This still results in a missing fetch worker error, because the fetch-worker
                    // is attempted to be resolved on an absolute path (e.g. file:///chunks/fetch-worker..)
                    // That is still fine, because we don't need the fetch-worker to retrieve information.
                    // TODO: For a long term fix, change how the fetch-worker is resolved in `scratch-storage`
                    // {
                    //     context: getModulePath('@scratch/scratch-gui'),
                    //     from: 'chunks/fetch-worker.*.{js,js.map}',
                    //     noErrorOnMissing: true
                    // }
                ]
            })
        ]
    }
);
