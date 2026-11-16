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
pnpm build:web
  web/src/index.jsx + GUI dist + GUI 静态资源 → web/dist
```

依赖方向决定了顺序：GUI 最终把 VM、渲染器、存储、画笔、声音等打成浏览器 bundle，
因此这些包必须先产出 `dist`。

`scratch-storage` 的请求队列是本地实现（`src/TaskQueue.ts`），不依赖额外包；
它保留 token bucket 速率限制与并发上限，用于素材下载。

## Web 入口

`apps/tesslo/web` 是一个独立的 Web 构建，不再有 Electron 主进程：

- `src/index.jsx` 引入 `@scratch/scratch-gui` 的 `GUI` 与 `AppStateHOC`，挂载到
  `index.html` 的 `#app`。
- 使用 `projectId={defaultProjectId}` 触发默认项目加载。
- 关闭遥测弹窗：`isTelemetryEnabled={false}`、`showTelemetryModal={false}`。
- `onStorageInit` 注入 `WebStorageHelper`，从本地素材服务加载默认素材。
- `window.__TESSLO_ASSET_ORIGIN__` 指向本地素材服务，GUI 素材库缩略图不再访问
  `cdn.assets.scratch.mit.edu`；未设置时仍回退到上游 CDN。
- `onClickAbout` 提供“关于 Tesslo / 隐私政策”，恢复菜单栏帮助入口。
- 上游品牌资源不修改：菜单栏继续使用 `scratch-logo.svg` 的原始内容，重新构建
  `scratch-gui` 后会使用当前上游 SVG。
- webpack 把 GUI 的 `static`、`libraries`、`chunks`、`extension-worker` 复制进
  `web/dist`。

产物是 `web/dist/index.html`、`main.js` 和静态资源，由 HAP 构建复制到
`entry/src/main/resources/rawfile`。

## 素材与离线库

Scratch 默认素材库（角色、造型、背景、声音）在构建时从本地缓存注入：

- `apps/tesslo/assets/fetched/` 保存素材并随仓库提交，
  `apps/tesslo/assets/manifest.json` 记录来源与数量。
- 构建不需要联网，也不需要额外准备。
- `pnpm build:hap` 把它硬链接到 `rawfile/static/fetched`（不支持硬链接时回退复制）。
- ArkTS `AssetServer` 在 `127.0.0.1:20114` 提供这些文件；`WebStorageHelper` 通过
  HTTP 读取，不依赖 `resource://` 的 fetch。

`scratch-gui` 的 `scripts/prepare.mjs` 负责准备 micro:bit 固件 hex。该脚本在
`pnpm install` 的 `prepare` 阶段执行；hex 已存在时跳过下载。

## 平台边界

编辑器源码只保留通用的浏览器行为。窗口、文件选择器、权限、蓝牙和素材服务由
`apps/tesslo/entry` 提供，不在 GUI/VM 中写 HarmonyOS 判断。这样同步上游编辑器时，
冲突集中在 Web 入口和 ArkTS 宿主。
