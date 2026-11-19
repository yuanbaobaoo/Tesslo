# IDE 架构方案（评审稿 v4）

> 状态：待评审 · 2026-11 · v4 立场反转（Scratch 仅为 .sb3 兼容引擎，
> 绞杀者重写）· v5 宿主层按 ArkUI-X 落地 · **v6：D9 修订——放弃
> ArkUI-X，宿主层改为三原生壳（harmony ArkWeb 永久主线 +
> Android/iOS 原生 WebView 壳）**。未确认项集中列于 §16。

## 0. 术语

| 术语 | 定义 |
| --- | --- |
| 产品层 | Tesslo 自有的一切：外壳、状态、项目模型、格式、扩展、UI kit |
| 兼容引擎（engine/scratch） | 内嵌的 Scratch 系代码（vm/render/blocks/paint/storage/gui 容器），职责仅一个：加载/运行/编辑 .sb3 语义的项目 |
| 引擎嵌入面 | 引擎对产品层暴露的公开 API：格式编解码、嵌入组件、EngineFacade |
| 宿主 | 每平台原生应用壳（现 HarmonyOS ArkTS，未来 Android/iOS） |
| 桥 | Web IDE ↔ 宿主的能力通道（现回环 HTTP/WS，见 §11） |

## 1. 定性与总原则

Tesslo 是**独立的图形化编程 IDE**；若非 .sb3 兼容，无需 Scratch 引擎。
由此确立三条总原则：

1. **架构按 Tesslo 域组织**：目录、包、接口、状态、构建全部以自有
   域划分；引擎是挂在产品层之下的一个子系统，不是骨架。
2. **没有上游同步管道**：内嵌 Scratch 代码即自有代码，随意改写、
   删减、TS 化；上游仓库仅在排查兼容性问题时作**规格参考**。
3. **模块可重写，采用绞杀者模式**：新实现落在自有域包，引擎目录
   只出不进、随替换逐步收缩（云/社区/背包/遥测等非内核功能直接
   删除）；每一次替换由 §8 兼容性回归体系验证。

## 2. 现状事实（已确认，v3 核验结论保留）

### 2.1 进程与服务

| 端口 | 服务 | 实现 |
| --- | --- | --- |
| 20111 | C# Scratch Link | `libtesslolink.so` NAPI |
| 20113 | BLE TCP 桥 | `entry/ets/ble/BleTcpBridge.ets` |
| 20114 | 素材 HTTP | `entry/ets/assets/AssetServer.ets` |

启动/释放挂 `EntryAbility` 成对；服务模式为 `@ohos.net.socket`
TCPSocketServer + 手写最小 HTTP/1.1 + 路径白名单（ProjectServer
复用，抽 `common/MiniHttp.ets`）。

### 2.2 构建链

`packages/scratch-*` 逐级构建 → gui `build:dist` 双出口（`.` 与
`./standalone`）→ `apps/host/ohos/web` webpack（main.js 21MB 基线，
CopyPlugin 拷 static/libraries/chunks/extension-worker）→
`build-hap.ts` 入 rawfile。

### 2.3 当前 Web 入口（`web/src/index.jsx`）

legacy 挂载（`GUI + AppStateHOC`），`canSave=false`；素材经
`onStorageInit` 注入 `WebStorageHelper` 走 20114；ArkWeb 宿主提供
权限 / 下载 / 外链拦截。

## 3. 引擎嵌入面（兼容引擎的公开 API，全部源码核验）

### 3.1 GUIConfig / GUIStorage —— 保存后端接口

`scratch-gui/src/gui-config.ts`：
`saveProject(projectId, vmState, params) → {id}`、`scratchStorage`、
`saveProjectThumbnail`。以 `storage` prop 注入（`containers/gui.jsx:57`）。
产品层实现 `TessloStorage` 即接管保存。

### 3.2 `./standalone` 出口 —— 嵌入根与状态所有权

`index-standalone.tsx`：`createStandaloneRoot(EditorState, container,
{wrappers})`；`EditorState` 封装标准 redux store（createStore +
combineReducers：locales / scratchGui / scratchPaint），
`AppStateProviderHOC` 经 react-redux Provider 注入；导出
`guiReducers / buildInitialState / guiMiddleware` 与项目流 action
（setProjectId / requestNewProject / 全部 modal 开关）。
**结论：产品层从第一天起自持状态（EditorState 由 Shell 创建持有），
不存在"先 legacy 后切换"的过渡。**

### 3.3 VM 与内核容器

VM 由 `vm-manager-hoc` 链内创建；内核容器
（`containers/blocks|stage|paint-editor-wrapper.jsx`）为嵌入组件，
chrome 外围（菜单/面板/弹窗）属可替换层。

## 4. 目标架构：三段式

```text
┌──────────────────── 产品层（Tesslo 自有，架构主体）───────────────────┐
│ tesslo-app（Shell：Launcher / IDE 外壳 / 设置 / 路由，React+TS）        │
│ tesslo-state（自持 EditorState / 自有 reducers / 项目模型 .tess）      │
│ tesslo-ui（自有 UI kit：触屏优先组件库，chrome 替换目标）               │
│ formats（.tess / .sb3 / .html 编解码，调用引擎嵌入面）                 │
│ extensions（Tesslo 扩展：传感器 / 端侧AI / 分布式，P4+）                │
│ platform-adapter（接口 + harmony / browser 实现，§10）                 │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ 仅经引擎嵌入面（§9）
┌──────────────────────────────┴─────────────────────────────────────────┐
│ 兼容引擎层 engine/scratch（内嵌 Scratch 系代码，绞杀者收缩区）          │
│  vm · render · blocks · paint · storage · gui 容器                      │
│  职责：.sb3 语义的加载/运行/编辑/渲染；云·社区·遥测等非内核功能删除      │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ 桥（§11）
┌──────────────────────────────┴─────────────────────────────────────────┐
│ 宿主层：apps/host = ArkUI-X 工程（common + harmony + android + ios，  │
│         D9）；harmony 目标 = 发布主线；android/ios 按 §14 达标后发版  │
└─────────────────────────────────────────────────────────────────────────┘
```

依赖规则（不可反向，CI 以 eslint-boundaries / dependency-cruiser 强制）：

```text
产品层 → 引擎嵌入面（formats 编解码、嵌入组件、EngineFacade）
产品层内部：app → state/ui/formats/extensions/adapter；adapter 零依赖
引擎内部自由互访；引擎不得 import 产品层
宿主 → 桥协议（不感知 IDE 概念）
```

## 5. 开发语言

| 层 | 语言 | 策略 |
| --- | --- | --- |
| 产品层全部 | TypeScript（strict），TS 5.8 | 无例外 |
| 兼容引擎 | 现状 JS（含上游遗留 .ts） | **接触即 TS**：改到的模块随手迁移类型，不做专项、不设"保持 JS"约束（无同步管道，D4'） |
| HarmonyOS 宿主 | ArkTS（API 26） | 现状 |
| C# Link | C# / .NET 9 NativeAOT | 现状 |
| 构建脚本 | TS on Node | 现状 |

UI 层不引入第二门语言；引擎被整模块重写时，新实现为纯 TS（落产品层
或新引擎模块）。

## 6. 技术框架与选型

| 层 | 框架 / 库 | 版本（已确认） | 说明 |
| --- | --- | --- | --- |
| Web UI | React | 18.3.1 | 产品层与引擎共用运行时 |
| 状态 | Redux（产品层自持 `EditorState`：createStore/combineReducers）+ react-redux | react-redux ^8.0.0 | 不引第二状态库；Launcher 用本地态；自有 reducers 与 guiReducers 同 store 分域挂载 |
| i18n | react-intl + scratch-l10n | react-intl 6.8.9 | 词条管道复用，P5 本土化同管道 |
| 样式 | 普通 CSS → tesslo-ui 内规范化（design tokens、触屏尺寸变量） | — | 不引 Tailwind / CSS-in-JS |
| 构建 | webpack 5.106.2 统一（IDE / player 双入口） | — | 不迁 Vite（D6） |
| 容器/网络 | 原生 fetch / WebSocket / JSZip（依赖链已有） | — | |
| 宿主（三原生壳，D9 v6） | harmony：ArkTS + ArkWeb + `@ohos.net.socket`，P1 `@kit.CoreFileKit`（picker/fileShare），P4 `@ohos.sensor` / `@kit.CoreSpeechKit`；Android：Kotlin + WebView + ServerSocket 回环；iOS：Swift + WKWebView + NWListener 回环 | API 26（harmony） | 壳只做 WebView 容器 + 桥服务，无 UI 框架层 |
| 跨平台策略 | 不引入跨平台 UI/壳框架；三壳按桥协议规格各自原生实现；Capacitor（CPF-Ionic 鸿蒙适配）/ RNOH 仅作后置备选，重启选型需重新尽调 | — | 宿主层代码量小（每壳约千行），原生可控性 > 框架统一收益 |
| 编排 | pnpm workspace 11.21.0 · Node ≥22.18 · JDK 17 | 现状 | |
| 测试 | node:test + Vitest（单元）+ Playwright（端到端，经 browser adapter）+ 兼容回归体系（§8） | U7 于 M1 定案 | |

## 7. 目录规划（按 Tesslo 域组织）

```text
tesslo/
├─ packages/
│  ├─ app/            # [P1] Shell：Launcher、路由、IDE 外壳装配（React+TS）
│  ├─ state/          # [P1] 自持 EditorState 装配、自有 reducers、项目模型
│  ├─ ui/             # [P2起] tesslo-ui 自有组件库（触屏优先，chrome 替换目标）
│  ├─ formats/        # [P1] .tess / .sb3 / .html 编解码（含导入导出）
│  ├─ extensions/     # [P4] Tesslo 扩展（sensors / ai / distributed）
│  ├─ platform-adapter/ # [P1] 接口 + harmony/browser 实现
│  ├─ engine/
│  │  └─ scratch/     # 兼容引擎：现 packages/scratch-*（gui/vm/render/
│  │                 #   blocks/paint/storage/audio/l10n/parser/…）整体
│  │                 #   移入；包名不变（import 零改动），仅目录归组
│  └─ scratch-link/   # C# Link（common + OHOS）
├─ apps/
│  └─ host/           # [v6] 三原生壳（ohos 为 workspace 包 @tesslo/hap）：
│     ├─ ohos/        #   HarmonyOS 壳（原 apps/tesslo 整体迁入，git mv 保历史）：
│     │               #   ArkTS+ArkWeb HAP 工程 + web/（双 webpack 入口装配层），
│     │               #   entry/ = 永久发布主线；README 附 H1–H9 回归对等清单
│     ├─ common/      #   桥协议规格对照（信封格式/端口表/MiniHttp 语义），
│     │               #   三壳实现的共同规格文档
│     ├─ android/     #   Android 壳（Kotlin+WebView+ServerSocket，按需启动）
│     └─ ios/         #   iOS 壳（Swift+WKWebView+NWListener，按需启动）
├─ scripts/ tests/ docs/ build/
└─ 工程配置统一（P1 一并落）：根 eslint + boundaries 规则、tsconfig
   references、Vitest/Playwright 接入、CI 分包流水线
```

绞杀者目录规则：

1. 引擎目录**只出不进**：新实现一律落产品层域包；引擎内被替换的
   模块删除并在 `docs/engine-rewrite.md` 登记（替换物、验证记录）；
2. 首刀（P1 期间即可执行）：删除引擎内云变量 / 社区 / 背包 / 遥测 /
   账号相关代码路径（不可达死代码先标记 `@tesslo-dead` 后清）；
3. 引擎目录物理位置 P1 一次性归组到 `packages/engine/scratch/`
   （workspace globs 与构建脚本同步改，包名与 import 不变，纯移动）。

## 8. 兼容性回归体系（重写的安全网，M1 建立）

这是"不考虑开发成本"真正的投资方向——**让激进重写安全**。

1. **语料库（corpus）**：
   - 官方示例项目 ≥ 20 个（覆盖九类积木、扩展、监视器）；
   - 真实社区项目分层抽样 50–100 个（小/中/大，含常用扩展）；
   - 入库为测试固定件（.sb3 原样提交，不含个人信息素材）。
2. **行为金测（golden behavior）**：绿旗运行 N 秒（确定性种子与
   时钟注入）后快照：角色位置/方向/大小、变量、列表、说气泡文本、
   消息计数。基准 = 当前引擎（U8），重写前后对比。
3. **舞台视觉回归**：关键帧截图 diff（阈值容差，WebGL 读回）。
4. **格式往返**：load → save → 项目哈希比对；.tess ↔ .sb3 双向。
5. **执行清单**：每类重写的手工补充项（如画板交互）。
6. **触发与 CI**：引擎目录任何改动 PR 必跑全量；产品层改动跑关联
   子集；语料新增随版本滚动。

## 9. 引擎嵌入面契约（EngineFacade）

产品层只见以下入口（TS 定义落于 `packages/formats` 与 `app`）：

```typescript
interface EngineFacade {
  // 格式
  loadSb3(bytes: ArrayBuffer): Promise<EngineProject>;
  toSb3(p: EngineProject): Promise<ArrayBuffer>;
  extractAssets(p: EngineProject): {md5ext: string; data: Uint8Array}[];
  // 运行（vm 装配仍由嵌入组件内部完成）
  readonly vm: ScratchVM;                 // 只读句柄：绿旗/停止/广播
  readonly runtimeEvents: EventEmitter;   // blockGlow 等信号（P3 用）
}
// 嵌入组件（React）：BlockEditor / Stage / PaintEditor / MonitorList
// 语义对齐现 gui 容器 props；tesslo-ui 替换 chrome 时逐个自绘外围
```

保存后端：`TessloStorage implements GUIStorage`（§3.1）；
挂载根：编辑器 = 主出口 + `AppStateHOC`（standalone 出口因内嵌双 React 废弃，
E5 待删）；**播放端 = 引擎 `./player` 出口**（`index-player.tsx`：Stage +
MonitorList 最小树 + `createPlayerStore`（不含 paint reducer）+ 语言裁剪
zh-cn/en，产物 12.3MB，E6）。

## 10. PlatformAdapter 接口（v7）

（基础内容与 v3 §8 一致：ProjectStore / AssetStore / pickProjectDir /
saveDownload / 错误码 / 超时 / harmony + browser 实现；落地文件
`packages/platform-adapter`。）

**v7 宿主侧 HTML 导出（2026-11-19）**：`ProjectStore` 增加可选
`exportHtmlProject(id)`。harmony 实现由 ProjectServer 直接读取 rawfile 里的
13MB player 模板与工作区文件，组装单文件 HTML 后弹系统保存选择器——不再把
模板/字节经页面 base64 + 回环 JSON 传输（真机实测页面主线程会冻结约 44s，
表现为"点击导出没反应"）。浏览器实现不提供该方法，装配层仍回落到页面内
`buildExportedHtml`。导出对话框在 Promise 完成前显示"正在准备导出…"，
1.2s 后改为"请在弹出的保存窗口中选择位置…"（系统 picker 是独立窗口）；
保存成功底部弹 Toast「已导出『作品名』.格式」，取消仍可随时关闭对话框。

**v6 项目封面（2026-11-19）**：`ProjectSummary` 增加可选 `thumbnail`
（dataURI）。编辑器保存时用 `vm.renderer.requestSnapshot` 截取舞台，缩放为
320×240 JPEG 写入 `tesslo.json.thumbnail`，宿主同步到注册表供列表展示；
无缩略图的旧项目显示项目名首字兜底。

**v5 目录即工程（2026-11-19）**：`ProjectStore` 的读写单位从 `.tess` 字节
改为 **ProjectBundle**（tesslo.json + project.json + assets），宿主把项目存为
目录工作区，`.tess` / `.sb3` / `.html` 仅作为导出产物在导出时组装。
新增 `findExistingProject`（导入去重：projectId / 内容指纹）与
`readLegacyTess`（旧单 .tess 工作文件首次打开自动迁移）。
**v4 真机结论仍有效**：外部目录 URI 经 `fileUri.FileUri(uri).path` 转真实
路径后目录 IO 全部可用；持久授权重启后 `activatePermission` 恢复。

## 11. 桥传输层（harmony 实现细节）

（与 v3 §9 一致：回环 HTTP + MiniHttp 抽公共 + 20117 + 信封与
错误模型 + 仅回环监听；U1 = javaScriptProxy 条件触发。）

## 12. 产品层路线（原 tesslo-shell 章节重写）

- **P1 已落地（2026-11-19）：工作台导航条自绘**。`WorkbenchNav`（packages/app）
  承担 设置 / 保存项目 / 导出项目 / 关于（最右），Scratch `menuBarHidden`
  隐藏其自带菜单栏——产品层只复用工作区（积木/舞台/画板/角色面板）。
  引擎主出口导出 `EditorState`（自持 store）+ `setColorMode` 供导航 dispatch。
- **P1 起：standalone 自持**。入口不再走 legacy `AppStateHOC`，
  而是 `EditorState`（产品层创建）+ `AppStateProviderHOC`/
  `createStandaloneRoot` 挂载；`TessloStorage implements GUIStorage`
  接管保存；Launcher 为同 bundle 的路由层。
  **P1 首周 spike**：standalone 路径在 ArkWeb 的冒烟（默认项目加载/
  保存往返/扩展加载/绿旗/画板），不过则 P1 临时回落 legacy 挂载
  （仅挂载方式差异，产品层代码不变），问题单独立项修引擎。
- **P2 起：tesslo-ui 生长**。自有触屏优先组件库按面板替换 chrome：
  菜单栏 → 精灵面板 → 造型/声音页签 → 弹窗组；每批过 §8 回归。
- **Launcher ↔ 编辑器**：默认卸载重建（返回前 `await saveProject`）；
  常驻优化按 M1 实测重建耗时（> 1.5s 且可感）再启。

## 13. 里程碑

| 里程碑 | 内容 | 退出条件 |
| --- | --- | --- |
| M0 事实核验 | §2/§3 | 已完成 |
| M1 = P1 交付 + 工程统一 | 目录归组（engine/scratch）；工程配置统一（eslint/boundaries/CI）；兼容回归体系 v1；Launcher/编辑器/保存链（主出口挂载）+ .tess + 导出（已完成，真机触摸链路实证） | P1 验收全过；回归体系在 CI 生效；引擎首刀圈定完成 |
| M2 = 自有 chrome 生长 | tesslo-ui 首批（菜单/文件流），P2 触屏改造共用 | 每批回归全绿 |
| M3 = 引擎重写梯度 | 按触发执行（§13.1） | 每次替换行为金测全绿 |
| M4 = 跨平台发版 | android/ios 目标从骨架到可用（硬件服务逐目标补齐） | §14 达标矩阵全绿 |

### 13.1 引擎重写梯度（触发制，非排期制）

| 梯度 | 模块 | 触发条件 | 风险 |
| --- | --- | --- | --- |
| T0（M1 内） | 引擎死代码清除（云/社区/背包/遥测）；scratch-storage 收缩为 AssetStore 语义 | 无条件 | 低 |
| T1（P2–P3） | chrome 全量替换（tesslo-ui）；gui 容器瘦身至内核挂载 | 随 P2 触屏推进 | 中 |
| T2（按需） | vm 执行器升级（JIT 编译路线，衔接性能与双视图）；render 后端化（离屏/导出） | 性能预算不达标，或双视图/导出需要 | 高（金测兜底） |
| T3（战略可选） | blocks 编辑器 / 渲染内核完全自研 | 上游语义瓶颈真实出现（多年尺度） | 极高，默认不启 |

## 14. 跨平台目标达标矩阵（M1 地基验证 + M4 发版门槛）

| # | 用例 | M1 地基（骨架） | M4 发版 |
| --- | --- | --- | --- |
| 1 | 加载 IDE bundle（本地服务指向 web dist） | ✅ 冒烟通过 | 全功能编辑 + 绿旗 |
| 2 | WebGL（scratch-render） | 画布出现 | 中档项目 ≥45fps |
| 3 | WebAudio / WebSocket / 多 Worker | 可用 | 全部可用 |
| 4 | 文件下载 / picker | 基本可用 | .tess 落盘 + 目录选择 |
| 5 | BLE（micro:bit 实机） | —（stub） | 扫描 + 连接 + 收发 |
| 6 | 麦克风 / 摄像头 | —（stub） | 授权流与采集正常 |
| 7 | 内存峰值 | 登记基线 | < 800MB |
| 8 | common 服务代码各目标复用度 | 初值入档 | ≥ 60% |

地基保险（D9 v6 语义）：harmony 壳（ArkTS+ArkWeb）为永久发布主线；
Web IDE 平面不使用任何宿主专有 API（桥 = 平台无关的标准 HTTP/WS on
127.0.0.1），Android/iOS 壳按同一桥协议规格原生实现，承载同一
web dist——换壳产品层零改，壳之间互不依赖。

## 15. 性能预算与基线登记

（与 v3 一致：IDE bundle 21MB 基线；player ≤10MB；桥 RTT <20ms；
Launcher 首屏 <1s；VM 重建耗时 M1 登记。）

## 16. 未决问题（评审重点）

| # | 问题 | 验证方式 | 时点 |
| --- | --- | --- | --- |
| U1 | 回环 HTTP vs javaScriptProxy | M1 实测 RTT/吞吐 | M1 后 |
| U5 | 大 ArrayBuffer 过桥 | U1 若改 proxy 专项验证 | U1 触发时 |
| U7 | Vitest/Playwright 引入 | M1 用 browser adapter 跑通一条端到端 | M1 |
| U8 | 行为金测基准 | 当前引擎输出即基准（快照入库）；重写以"与基准一致"为通过 | M1 |
| U9 | 引擎目录物理归组的构建脚本影响面 | P1 首日试移（workspace globs/build 脚本清单） | P1 首周 |
| U10 | Android WebView / iOS WKWebView 引擎差异清单（WebGL·WS·Worker·下载·音频） | 各原生壳首个冒烟时逐项登记（host/android、host/ios README 已有登记表） | M4 前 |
| U11 | ~~已作废（ArkUI-X 放弃，无工程迁移）~~ → Android/iOS 壳的回环服务实现验证（ServerSocket/NWListener + 信封协议） | 各壳冒烟实测 | M4 前 |

（原 U2 standalone ArkWeb 表现 / U3 VM 重建 / U6 paint 挂载并入
P1 首周 spike 清单，不再是独立未决项。）

## 17. 决策记录

| # | 决策 | 理由 |
| --- | --- | --- |
| D1 | chrome / 产品 UI 不进原生框架 | 内核与 UI 同 DOM 上下文；高频交互不可过桥 |
| D2 | Launcher↔编辑器默认卸载重建 | 简单可靠；常驻按实测数据定 |
| D3 | 桥维持回环 HTTP；javaScriptProxy 条件触发 | 现网验证过；接口不变可平滑换 |
| D4' | 自有代码 TS 无例外；引擎"接触即 TS"，无同步管道约束 | 上游仅为规格参考 |
| D5 | 保存经 GUIStorage（TessloStorage），产品层不迁就引擎 chrome | 引擎嵌入面最小化 |
| D6 | 一致性优先：不迁 Vite / 不引第二状态库 / 不引新样式框架 | 替换需可量化收益 |
| D7 | **绞杀者重写**：新实现落自有域包，引擎只出不进；回归体系兜底 | 统一架构 + .sb3 兼容双目标 |
| D8 | 产品层访问引擎仅经嵌入面（§9），CI 边界规则强制 | 防引擎渗漏成新耦合 |
| D9 | **v6 修订：宿主层 = 三原生壳**——harmony（ArkTS+ArkWeb，`apps/host/ohos/entry` 为永久主线，不迁移）+ Android（Kotlin+WebView）+ iOS（Swift+WKWebView）；三壳共用桥协议规格与 web dist；不引入跨平台 UI/壳框架 | ArkUI-X 版本跟随节奏慢（配套 API 22 vs 主线 API 26）、仓库迁移 GitCode 生态不确定；宿主层代码量小，原生可控性优于框架统一（选型记录：Capacitor 鸿蒙靠社区组织 CPF-Ionic、RNOH 叠 React 运行时，均不如原生壳稳） |

## 18. 风险

- **无上游管道 = 自担维护**：引擎安全修复需自行识别（订阅上游
  security advisory 作参考，不做代码合并）；接受。
- 重写风险由 §8 回归体系兜底；T3（编辑器/渲染自研）默认不启，
  触发条件真实出现才评估——成本不是约束，**优先级仍是**。
- 引擎目录归组（U9）为纯移动，但构建脚本影响面需首周验证。
- （v6 已解除）ArkUI-X 框架风险：D9 修订后宿主层为三原生壳，
  无第三方壳框架依赖；剩余风险为三份壳代码的维护成本（每壳约千行，
  以桥协议规格文档对齐）。
- AGPL：引擎衍生部分维持 AGPL；完全自研重写模块为自有版权
  （协议随仓库统一 AGPL，不另设）。
