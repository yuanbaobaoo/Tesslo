const CopyWebpackPlugin = require('copy-webpack-plugin');
const path = require('path');
const ScratchWebpackConfigBuilder = require('scratch-webpack-configuration');
const fs = require('fs');
const nodeExternals = require('webpack-node-externals');

// Helper to find monorepo root dynamically
// Tesslo：本仓库用 pnpm-workspace.yaml 声明工作区（package.json 无 workspaces 字段），
// 引擎包归组到 packages/engine/scratch/ 后，上游的 ../.. 回退不再指向仓库根；
// 按 pnpm 工作区标记定位根目录（nodeExternals 依赖根 node_modules）
const findMonorepoRoot = () => {
    let currentDir = path.dirname(__dirname);
    while (currentDir !== path.parse(currentDir).root) {
        if (fs.existsSync(path.join(currentDir, 'pnpm-workspace.yaml'))) {
            return currentDir;
        }
        currentDir = path.dirname(currentDir);
    }
    // Fallback to standard location if detection fails
    return path.resolve(__dirname, '../..');
};

const MONOREPO_ROOT = findMonorepoRoot();

const common = {
    libraryName: 'scratch-svg-renderer',
    rootPath: path.resolve(__dirname)
};

/**
 * @type {import('webpack').Configuration}
 */
const nodeConfig = new ScratchWebpackConfigBuilder(common)
    .setTarget('node')
    .merge({
        externals: [
            // Without this, a hoisted `isomorphic-dompurify` can fail to find its CSS.
            // TODO: consider moving this into `scratch-webpack-configuration`
            nodeExternals({
                modulesDir: path.resolve(MONOREPO_ROOT, 'node_modules')
            })
        ],
        output: {
            library: {
                name: 'ScratchSVGRenderer',
                type: 'umd'
            }
        }
    })
    .get();

/**
 * @type {import('webpack').Configuration}
 */
const webConfig = new ScratchWebpackConfigBuilder(common)
    .setTarget('browserslist')
    .merge({
        output: {
            library: {
                name: 'ScratchSVGRenderer',
                type: 'umd'
            }
        }
    })
    .get();

module.exports = [
    nodeConfig,
    webConfig
];
