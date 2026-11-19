// 播放端（导出执行文件）的 webpack 构建：
// entry player.tsx → dist/static/fetched/player.js，
// 内联模板由 scripts/inline-player-template.mts 完成。
// 产物经 build-hap 整目录入 rawfile，AssetServer 以
// /static/fetched/player-template.html 供导出器取用。
const path = require('path');
const webpack = require('webpack');

module.exports = {
  mode: 'production',
  target: 'web',
  entry: path.resolve(__dirname, 'src/player.tsx'),
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'static/fetched/player.js',
    publicPath: ''
  },
  devtool: false,
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: [/node_modules/, /packages[\\/]engine[\\/]scratch[\\/]scratch-gui[\\/]dist/],
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', {targets: 'defaults'}],
              ['@babel/preset-react', {runtime: 'classic'}],
              '@babel/preset-typescript'
            ]
          }
        }
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    alias: {
      // 播放端双语裁剪（scripts/trim-player-locales.mts 生成）：74 语言 4.3MB → 101KB
      'scratch-l10n/locales/editor-msgs$': path.resolve(
        __dirname, '.player-build/editor-msgs-trimmed.js')
    }
  },
  plugins: [
    new webpack.DefinePlugin({
      // 播放端无宿主服务；host 常量仅为通过 adapter 类型层（运行时不触达）
      __TESSLO_HOST__: JSON.stringify('harmony')
    })
  ],
  performance: {hints: false}
};
