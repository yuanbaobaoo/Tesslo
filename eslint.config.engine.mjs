// 引擎专用 lint 配置：只执行 D8 反向依赖检查（引擎 → 产品层：禁止）。
// 常规 lint 由引擎各包自有 eslint.config.mjs 负责；本配置独立运行：
//   pnpm lint:engine
// 与根配置分离的原因：根配置忽略引擎目录（避免上游遗留风格报错泛滥），
// 而边界检查必须覆盖引擎——D8 的另一半。
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

// noop 规则：引擎文件携带上游 eslint-disable 内联指令，引用的规则名
// 在本最小配置中不存在会报 "Definition for rule was not found"。
// 注册为 noop 仅为消化指令，不做任何检查（引擎风格检查归各包配置）。
const makeNoopRule = () => ({
    meta: {schema: [], messages: {noop: 'noop'}},
    create: () => ({})
});
const noopRules = {
    'max-len': makeNoopRule(),
    'jsx-no-bind': makeNoopRule(),
    'forbid-prop-types': makeNoopRule(),
    'prop-types': makeNoopRule(),
    'jsx-filename-extension': makeNoopRule(),
    'no-unused-expressions': makeNoopRule(),
    'no-unused-vars': makeNoopRule(),
    'unbound-method': makeNoopRule()
};
const noopPlugins = {
    '@stylistic': {rules: noopRules},
    react: {rules: noopRules},
    '@typescript-eslint': {rules: noopRules}
};

export default tseslint.config(
    {
        ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/playground/**']
    },
    {
        files: ['packages/engine/scratch/**/*.{js,mjs,cjs,jsx,ts,tsx}'],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                ecmaFeatures: {jsx: true},
                sourceType: 'module'
            }
        },
        linterOptions: {
            // noop 规则必然产生 unused 指令告警，与边界检查无关
            reportUnusedDisableDirectives: 'off'
        },
        plugins: {boundaries, ...noopPlugins},
        settings: {
            'boundaries/elements': [
                {type: 'engine', pattern: 'packages/engine/scratch/*/**', mode: 'full'},
                {type: 'app', pattern: 'packages/app/**'},
                {type: 'state', pattern: 'packages/state/**'},
                {type: 'ui', pattern: 'packages/ui/**'},
                {type: 'formats', pattern: 'packages/formats/**'},
                {type: 'extensions', pattern: 'packages/extensions/**'},
                {type: 'adapter', pattern: 'packages/platform-adapter/**'},
                {type: 'host', pattern: 'apps/host/**'},
                {type: 'web-entry', pattern: 'apps/tesslo/web/**'}
            ],
            'boundaries/include': ['packages/engine/scratch/**']
        },
        rules: {
            // D8 主规则：包名级封禁（不依赖模块解析，未安装的包名也拦截）
            'no-restricted-imports': ['error', {
                patterns: [
                    {
                        regex: '^@tesslo/',
                        message: '引擎不得 import 产品层（D8）：需要产品层能力时下沉到嵌入面'
                    }
                ]
            }],
            // D8 辅规则：可解析的跨目录引用（相对路径越界）
            'boundaries/element-types': ['error', {
                default: 'allow',
                rules: [
                    {
                        from: 'engine',
                        disallow: [
                            'app', 'state', 'ui', 'formats', 'extensions',
                            'adapter', 'host', 'web-entry'
                        ],
                        message: '引擎不得 import 产品层/宿主（D8）'
                    }
                ]
            }]
        }
    }
);
