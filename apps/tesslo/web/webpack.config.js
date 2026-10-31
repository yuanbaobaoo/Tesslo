// 离线编辑器的 webpack 构建：单页入口 + 把 scratch-gui 的静态资源原样拷进 dist，
// 产物 dist/ 会被 build-hap 脚本整目录拷进 HAP 的 rawfile。
const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

// scratch-gui 包内已构建好的静态资源目录（static/libraries/chunks 等）
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
      },
      {
        test: /\.(png|jpe?g|gif|webp)$/,
        type: 'asset/resource'
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
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
