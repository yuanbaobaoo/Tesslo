# 编辑器移植

## 源码内嵌

`packages/` 下是完整的 Scratch 编辑器源码，而不是构建时从 npm 或 GitHub 解析：

| 包 | 作用 |
| --- | --- |
| `scratch-gui` | 编辑器界面、扩展库、菜单与舞台容器 |
| `scratch-vm` | 积木执行、扩展与外设协议 |
| `scratch-render` | WebGL 舞台渲染 |
| `scratch-svg-renderer` | 角色与造型的 SVG 渲染 |
| `scratch-blocks` | Blockly 积木界面 |
| `scratch-paint` | 造型编辑器 |
| `scratch-audio` | 声音播放与处理 |
| `scratch-storage` | 项目与素材加载、请求队列 |
| `scratch-l10n` | 界面翻译 |
| `scratch-parser`、`scratch-sb1-converter` | 项目格式解析与转换 |
| `scratch-render-fonts` | 渲染字体 |

内部包版本保持上游值，避免 workspace 链接被 npm 版本覆盖；产品版本只放在根
`package.json` 和 `apps/tesslo`。

## 构建顺序

```text
pnpm build:editor
  sb1 → blocks → storage → svg-renderer → render → vm → audio → l10n → paint → gui
pnpm build:desktop
  desktop main + renderer
```

依赖方向决定了顺序：GUI 最终把 VM、渲染器、存储、画笔、声音等打成浏览器 bundle，
因此这些包必须先产出 `dist`。

`scratch-storage` 的请求队列是本地实现（`src/TaskQueue.ts`），不依赖额外包；
它保留 token bucket 速率限制与并发上限，用于素材下载。

## GUI 作为库

HarmonyOS 构建不产出独立网页，而是让 `apps/tesslo/desktop` 的渲染进程引用 GUI：

- `build:gui` 以 `BUILD_TYPE=dist`、`NODE_ENV=production` 运行 webpack。
- 输出库类型改为 `commonjs2`。默认的命名库会导出 `{GUI: ...}`，破坏
  `import GUI from '@scratch/scratch-gui'`。
- 渲染进程通过 `TessloGUIHOC.jsx` 注入桌面能力，再挂载 GUI。

## React 单例

workspace 的符号链接会让 GUI 与桌面壳各自解析到一份 React，导致 hooks 在运行时
报错。`apps/tesslo/desktop/webpack.renderer.js` 把 `react`、`react-dom`、
`react-redux`、`redux` 显式 alias 到桌面壳解析到的同一份包，保证 Context 与
store 是单例。

## 素材与离线库

Scratch 默认素材库（角色、造型、背景、声音）在构建时从本地缓存注入：

- `media/fetched/` 保存已下载素材，`media/manifest.json` 记录来源与数量。
- 素材不进入 git；离线构建前需要先准备好该目录。
- `pnpm build:hap` 把它复制到 HAP 应用负载的 `static/fetched`。
- `ElectronStorageHelper` 在运行时从应用资源目录读取这些文件，扩展库因此不需要
  访问 CDN。

`scratch-gui` 的 `scripts/prepare.mjs` 负责准备 micro:bit 固件 hex。该脚本在
`pnpm install` 的 `prepare` 阶段执行；hex 已存在时跳过下载。

## 平台边界

编辑器源码只保留通用的浏览器行为。窗口、菜单、文件选择器、权限、蓝牙等由
`apps/tesslo` 提供，不在 GUI/VM 中写 HarmonyOS 判断。这样同步上游编辑器时，
冲突集中在少数桌面适配文件。
