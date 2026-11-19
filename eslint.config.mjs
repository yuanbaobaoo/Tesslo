// 根 ESLint（flat config）：产品层 + web 装配层 + 宿主 TS + 构建脚本 + 测试。
// 引擎（packages/engine/scratch/**）的常规 lint 保留各包自有配置；
// 根配置仅对引擎施加"不得 import 产品层"的边界检查（D8）。
// 架构依据：docs/ide-architecture.md §4 依赖规则 / §17 决策记录；
// 代码规范：.agent/coding-rules.md §10 / §14.1。
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import globals from 'globals';

// 边界元素定义（eslint-plugin-boundaries 按 glob 归类，不要求目录已存在）
const boundarySettings = {
    'boundaries/elements': [
        {type: 'web-entry', pattern: 'apps/host/ohos/web/**'},
        {type: 'app', pattern: 'packages/app/**'},
        {type: 'state', pattern: 'packages/state/**'},
        {type: 'ui', pattern: 'packages/ui/**'},
        {type: 'formats', pattern: 'packages/formats/**'},
        {type: 'extensions', pattern: 'packages/extensions/**'},
        {type: 'adapter', pattern: 'packages/platform-adapter/**'},
        {type: 'host', pattern: 'apps/host/**'},
        {type: 'engine', pattern: 'packages/engine/scratch/*/**', mode: 'full'}
    ],
    'boundaries/include': [
        'apps/host/ohos/web/**',
        'packages/app/**',
        'packages/state/**',
        'packages/ui/**',
        'packages/formats/**',
        'packages/extensions/**',
        'packages/platform-adapter/**',
        'apps/host/**',
        'packages/engine/scratch/**'
    ]
};

// 产品层 → 引擎只允许包名级导入（嵌入面：包名本身 + gui 的官方 standalone 出口）
const engineSurfaceOnly = {
    'no-restricted-imports': ['error', {
        patterns: [
            {
                regex: '^(@scratch/scratch-(?:gui|vm|storage|render|blocks|paint|audio|svg-renderer|parser)|scratch-(?:vm|blocks|storage|audio|parser|l10n))/(?!standalone$).+$',
                message: '引擎只允许包名级导入（嵌入面），禁止深层路径引用（D8）'
            }
        ]
    }]
};

// 产品层禁止出现宿主回环细节（§10.2：adapter 是唯一出口）
const noLoopbackLiterals = {
    'no-restricted-syntax': ['error',
        {
            selector: 'Literal[value=/127\\.0\\.0\\.1/]',
            message: '产品层禁止直连回环地址：一律经 platform-adapter（§10.2）'
        },
        {
            selector: 'Literal[value=/localhost:20[0-9]{3}/]',
            message: '产品层禁止散写宿主端口：一律经 platform-adapter（§10.2）'
        }
    ]
};

export default tseslint.config(
    // 全局忽略：产物与三方目录；引擎常规 lint 走包内配置
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/build/**',
            '**/oh_modules/**',
            'packages/engine/**',
            'packages/scratch-link/**',
            'apps/host/ohos/assets/**',
            'apps/host/ohos/entry/**',
            'apps/host/ohos/AppScope/**',
            '.pnpm-store/**'
        ]
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,

    // —— Node 侧：构建脚本 / 测试 / webpack 配置（CommonJS + Node globals）——
    {
        files: ['tests/**/*.js', 'tests/**/*.mjs', '**/*.config.{js,cjs}', 'scripts/**/*.{js,mjs}',
            'apps/host/ohos/web/webpack.player.js'],
        languageOptions: {
            sourceType: 'commonjs',
            globals: globals.node
        },
        rules: {
            // CommonJS 配置文件合法使用 require
            '@typescript-eslint/no-require-imports': 'off',
            // 测试可显式遮蔽内置全局（如 import WebSocket from 'ws'）
            'no-redeclare': ['error', {builtinGlobals: false}]
        }
    },

    // —— web 装配层（apps/host/ohos/web/src）：浏览器环境；迁移期允许存量直连，
    //    P1 内由 platform-adapter 替换后收紧 ——
    {
        files: ['apps/host/ohos/web/src/**/*.{js,jsx,ts,tsx}'],
        languageOptions: {
            globals: {...globals.browser, __TESSLO_VERSION__: 'readonly'}
        }
    },

    // —— 产品层 + 装配层 + 宿主：TS strict 风格 + 边界（D8）——
    {
        files: [
            'packages/{app,state,ui,formats,extensions,platform-adapter}/**/*.{ts,tsx}',
            'apps/host/ohos/web/src/**/*.{ts,tsx,js,jsx}',
            'apps/host/**/*.ts',
            'scripts/**/*.ts'
        ],
        plugins: {boundaries},
        settings: boundarySettings,
        rules: {
            'boundaries/element-types': ['error', {
                default: 'disallow',
                rules: [
                    // web 装配层：初始化 adapter → 挂 app（架构 §7）
                    {from: 'web-entry', allow: ['app', 'state', 'adapter', 'formats']},
                    // app → 各域包 + 引擎嵌入面（D8）
                    {from: 'app', allow: ['state', 'ui', 'formats', 'extensions', 'adapter', 'engine']},
                    // state：EditorState 装配（guiReducers）+ 项目模型
                    {from: 'state', allow: ['formats', 'adapter', 'engine']},
                    // ui：纯 UI kit，不依赖引擎与其他域包
                    {from: 'ui', allow: []},
                    // formats：纯编解码，经引擎嵌入面取 sb3 语义
                    {from: 'formats', allow: ['engine']},
                    // extensions：Tesslo 扩展经引擎 extension API
                    {from: 'extensions', allow: ['engine']},
                    // adapter：零内部依赖（协议出口唯一化）
                    {from: 'adapter', allow: []},
                    // 宿主：不 import 任何 Web 侧包（桥协议解耦）
                    {from: 'host', allow: []}
                ]
            }],
            '@typescript-eslint/consistent-type-imports': ['warn', {prefer: 'type-imports'}],
            '@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_'}]
        }
    },

    // —— 回环细节与深层引擎导入限制：仅产品包（web 装配层迁移期豁免，§10.2）——
    {
        files: ['packages/{app,state,ui,formats,extensions,platform-adapter}/**/*.{ts,tsx}'],
        rules: {
            ...engineSurfaceOnly,
            ...noLoopbackLiterals
        }
    },

    // —— 产品包 TS：类型感知规则（各包有 tsconfig，projectService 定位最近工程）——
    {
        files: [
            'packages/{app,state,ui,formats,extensions,platform-adapter}/**/*.{ts,tsx}',
            'apps/host/**/*.ts',
            'scripts/**/*.ts'
        ],
        languageOptions: {
            parserOptions: {projectService: true}
        },
        rules: {
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': 'error'
        }
    },

    // —— 测试文件：node:test 注册由框架管理，floating-promise 规则豁免 ——
    {
        files: ['packages/**/test/**/*.ts', 'tests/**/*.js'],
        rules: {
            '@typescript-eslint/no-floating-promises': 'off'
        }
    },

    // —— 引擎：仅边界检查（引擎 → 产品层：禁止；引擎内部自由）——
    // 常规 lint 由引擎各包自有 eslint.config.mjs 负责，根配置不重复。
    {
        files: ['packages/engine/scratch/**/*.{js,mjs,cjs,jsx,ts,tsx}'],
        plugins: {boundaries},
        settings: boundarySettings,
        rules: {
            'boundaries/element-types': ['error', {
                default: 'allow',
                rules: [
                    {
                        from: 'engine',
                        disallow: [
                            'app', 'state', 'ui', 'formats', 'extensions',
                            'adapter', 'host', 'web-entry'
                        ],
                        message: '引擎不得 import 产品层/宿主（D8）：需要产品层能力时下沉到嵌入面'
                    }
                ]
            }]
        }
    }
);
