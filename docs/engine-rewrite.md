# 兼容引擎绞杀者登记册（D7）

> 引擎目录（`packages/engine/scratch/`）只出不进：新实现一律落产品层域包；
> 引擎内被替换/删除的模块在此登记（替换物、验证记录）。
> 原则见 [IDE 架构](ide-architecture.md) §1/§7；改动必跑兼容回归（§8）。

## 状态说明

- **已圈定**：`@tesslo-dead` 注释标记，代码仍在（引用链未断），删除前需兼容回归基线就位
- **已删除**：模块移除，引用链清理完毕
- **已替换**：功能由产品层包承接

## 登记表

| # | 模块 | 状态 | 说明 / 替代物 | 日期 |
| --- | --- | --- | --- | --- |
| E1 | scratch-gui 背包（13 文件：components/backpack、containers/backpack、lib/backpack/、lib/backpack-api、lib/legacy-backpack-storage） | **已删除** | 引用链全清（gui.jsx aria/render/propTypes、target-pane/stage-selector 拖拽分支、costume-tab/sound-tab DropArea、sprite-list 样式条件、cards 注释、drag-constants BACKPACK_* 常量、legacy-storage backpackStorage、gui-config GUIBackpackStorage 类型族 + PropTypes、index-standalone 导出）；回归 30/30 全绿验证 | 2026-11-18 |
| E2 | scratch-gui 云变量（cloud-manager-hoc、cloud-provider） | **已删除** | 引用链全清（containers/gui HOC 链/cloudHost props、gui-config cloudVariables 字段 + GUICloudVariableConfig/Provider 类型、legacy-storage cloudVariables 字段 + CloudProvider import、index-standalone LegacyCloudProvider 导出）；回归 30/30 | 2026-11-18 |
| E3 | scratch-gui 遥测弹窗（components/telemetry-modal/） | **已删除** | 引用链全清（components/gui import/render/propTypes 五个回调、containers/gui telemetryModalVisible + closeTelemetryModal）；modals reducer 的 action 函数保留（exported-reducers 导出面，不影响行为）；回归 30/30 | 2026-11-18 |
| E4 | scratch-svg-renderer webpack findMonorepoRoot | 已替换 | 构建 bug：npm workspaces 检测在本仓库（pnpm-workspace.yaml）永假，`../..` 回退在引擎目录归组（U9）后错位，导致 nodeExternals 失效、node-canvas 被打进产物。改为按 pnpm-workspace.yaml 定位根。纯构建配置修复，无行为语义变化 | 2026-11-17 |
| E8 | scratch-gui 用户可见文案品牌化（lib/tesslo-brand.ts + locales reducer 覆盖） | 已新增 | 崩溃页/不支持浏览器/WebGL/连接断开/默认作品名 7 个词条统一替换为 Tesslo 立场（zh-cn 中文，其余语言英文兜底）；引擎原始文案保持不动（覆盖层运行时生效）。2026-11-19 扩展：删除角色/造型/声音确认（`gui.gui.shouldDeleteSprite/Costume/Sound`、`deleteAssetHeading`、确认按钮 yes/no）接入同一覆盖层，中文界面不再出现英文 Scratch 提示。同时修复：harmony adapter readProject/readSnapshot 未解包 {tessBase64} 导致打开已保存项目必崩（`atob` 报错 → "Could not find project"） | 2026-11-19 |
| E7 | scratch-gui 嵌入面扩充（主出口导出 `EditorState`、`setColorMode`/`setTheme`；`menuBarHidden` 供工作台使用） | 已新增 | Tesslo 工作台自绘导航条（设置/保存/导出/关于，Scratch 菜单栏隐藏）：产品层自持 EditorState + Provider 包住导航条与 GUI，导航可 dispatch 设置；引擎仅提供状态与开关，不渲染 Tesslo chrome | 2026-11-19 |
| E6 | scratch-gui 新出口 `./player`（index-player.tsx + createPlayerStore + dist-player 构建） | 已新增 | Tesslo 播放端专用出口：Stage+MonitorList 最小树、createPlayerStore 去 paint reducer、语言裁剪别名、react external；产物 42.5→12.3MB。属引擎嵌入面扩充（非删除），与主出口并存 | 2026-11-18 |
| E5 | scratch-gui index-standalone.tsx（standalone 出口） | 已圈定 | **build:dist-standalone 已从构建链移除**（零消费者：EditorPane/player 均改主出口 AppStateHOC，React 双实例问题真机实测）；源文件标记 @tesslo-dead 待删——EditorState/AppStateProviderHOC 被主出口链依赖，删除需连同架构调整 | 2026-11-18 |

## 删除前置条件

E1–E3 整段删除前必须：

1. 兼容回归体系 v1 基线入库（语料 ≥20 + 行为金测基准，架构 §8）；
2. 全局搜索确认产品层无引用（`pnpm lint` boundaries + grep 双保险）；
3. standalone 出口同步修剪（`index-standalone.tsx` 现仍导出
   `LegacyBackpackStorage` / `LegacyCloudProvider`——删除时出口一并移除，
   属接口破坏，需在 PR 说明列出破坏面）。
