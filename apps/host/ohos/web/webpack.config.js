// 离线编辑器的 webpack 构建：单页入口 + 把 scratch-gui 的静态资源原样拷进 dist，
// 产物 dist/ 会被 build-hap 脚本整目录拷进 HAP 的 rawfile。
// 入口开关：默认走 packages/app Shell（standalone 自持）；TESSLO_LEGACY=1
// 回落 legacy 直进编辑器入口（P1 首周 spike 保险，见 src/index.tsx 头注）。
const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');

// scratch-gui 包内已构建好的静态资源目录（static/libraries/chunks 等）
const guiDist = path.dirname(require.resolve('@scratch/scratch-gui'));

// 应用版本来自 apps/host/ohos/package.json（发版时与根版本同步），
// 打包时注入 About 弹窗，避免界面版本号再手工维护一份
const appVersion = require('../package.json').version;

// legacy 回落开关（构建期决定，不进产物双份引擎）
const useLegacyEntry = process.env.TESSLO_LEGACY === '1';

module.exports = {
  mode: 'production',
  target: 'web',
  entry: path.resolve(__dirname, useLegacyEntry ? 'src/index.jsx' : 'src/index.tsx'),
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'main.js',
    publicPath: ''
  },
  devtool: false,
  module: {
    rules: [
      {
        // 产品层 TS 源码（无 JSX：保留泛型箭头函数语义）
        test: /\.ts$/,
        exclude: [/node_modules/, /packages[\\/]engine[\\/]scratch[\\/]scratch-gui[\\/]dist/],
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', {targets: 'defaults'}],
              ['@babel/preset-typescript']
            ]
          }
        }
      },
      {
        // 产品层 TSX / 存量 JSX 源码
        test: /\.(jsx|tsx)$/,
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
        // 纯 JS（web 装配层存量文件）
        test: /\.js$/,
        exclude: [/node_modules/, /packages[\\/]engine[\\/]scratch[\\/]scratch-gui[\\/]dist/],
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
    extensions: ['.ts', '.tsx', '.js', '.jsx']
  },
  plugins: [
    new webpack.DefinePlugin({
      __TESSLO_VERSION__: JSON.stringify(appVersion),
      // 宿主目标：adapter 选择（harmony = ArkWeb 宿主内运行）
      __TESSLO_HOST__: JSON.stringify('harmony')
    }),
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
