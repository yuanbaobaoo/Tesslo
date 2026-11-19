# P1：作品管理（项目列表 + 作品库 + 版本管理 + 导出）

> 优先级 1 · 规模 L（4–8 周） · 前置：无
> · 故事线：**打开见作品，存得下、悔得了、带得走**

## 目标

1. **打开即项目列表**：Tesslo 启动首屏是"我的作品"（新建 / 打开 /
   重命名 / 删除 / 复制 / 导入），编辑器成为二级页面——项目是
   产品的一等概念；
2. **项目目录用户可选可见**：创建项目时选择默认库位置或自定义
   目录（必须是空目录），自定义目录出现在用户文件空间，可在
   系统文件管理器中直接看到；
3. **存得下 / 悔得了**：本地作品库 + 快照式版本历史，杀进程不丢，
   一键回滚；
4. **带得走**：导出三种产物——
   - `.tess` 工程文件（自有格式，**默认**）
   - `.sb3` 工程文件（Scratch 互通格式）
   - `.html` 执行文件（单文件、只读播放、双击即玩）

## 文件模型（本迭代最重要的决策）

### .tess 工程文件（自有格式，zip 容器）

```text
我的游戏.tess (zip)
├── tesslo.json    # formatVersion + 元数据（名称/缩略图/时间/作者/项目ID）
│                  #   + Tesslo 项目级设置（后续迭代扩展：传感器默认值等）
├── project.json   # 纯净 Scratch 项目：一字不动，含扩展积木 opcode
└── <md5>.*        # 全部素材（造型 / 声音）
```

- 项目 ID 存于 tesslo.json 内：**身份在文件里，不在路径上**——
  目录改名 / 搬家不丢身份，重新关联即恢复；
- 专属积木走官方扩展机制存于 project.json（opcode + 角色变量，
  仓库内 text2speech 即先例），格式层面零改动；
- `.tes`（易读作 test 截断）/ `.tlo`（丢品牌前缀）/ `.tproj` /
  `.sb3t`（从属感）候选已评估排除（冲突 / 辨识度 /
  从属感）。

### 项目工作区（目录即工程，用户可见）

```text
<项目目录>/                 # 默认：库内 <libraryRoot>/projects/<项目ID>/
│                          # 自选：用户指定空目录（folder picker + 持久授权）
├── tesslo.json           # 元数据：projectId / 名称 / 时间 / 设置 / 内容指纹
├── project.json          # 纯 Scratch 项目（代码）
├── assets/               # 素材原文件（<md5>.<ext>）
└── snapshots/
    ├── <时间戳>/          # 新快照：tesslo.json + project.json（轻量，素材不复制）
    └── <时间戳>.tess      # 旧版快照（兼容读取）
```

**`.tess` / `.sb3` / `.html` 都是导出产物**：导出时从工作区组装单文件；
工作区才是唯一事实来源。空目录校验因此仍然有意义——Tesslo 会向目录写入
上述结构（这也是 v5 与"单 .tess 文件"方案的分界）。

> **v5 真机实证（2026-11-19）**：目录 URI 不能直接拼子文件名交给 `fs`
> （`file://docs/.../Desktop/a.txt` → 13900002）。正确姿势：
> `new fileUri.FileUri(dirUri).path` 转真实路径，配合 `persistPermission` +
> `activatePermission` 后，`statFile / listFile / mkdir / open / write /
> rename / unlink / rmdir` **全部可用**。旧版单 `.tess` 工作文件在首次
> 打开时自动迁移为目录工作区：内容转存为快照后删除旧文件，无损。
> 导出下载仍用 open+write（copyFile 不接受 docs URI）。

**导入去重**：`.tess` 与 Tesslo 导出的 `.sb3` 按文件内 `projectId` 判定
（权威身份）；无元数据的官方 `.sb3` 按项目 JSON 内容指纹判定。命中已有
作品时拒绝导入并用提示弹窗告知（不再产生重复作品）。

### 库注册表（应用沙箱内）

`files/docs/Tesslo/library.json`：全部项目的注册信息
（id / 路径或 URI / 名称 / 更新时间 / 位置类型 sandbox|external /
存储形态 directory|legacy / 内容指纹）。列表页读注册表；项目元数据以
工作区 `tesslo.json` 为准，注册表仅作缓存与排序。

### 与 .sb3 / .html 的关系

| 文件 | 角色 | 说明 |
| --- | --- | --- |
| `.tess` | 工程文件（默认导出） | 完整 Tesslo 数据 |
| `.sb3` | 工程文件（互通导出） | 纯净 sb3 + 静默内嵌 tesslo.json zip 成员：官方 Scratch 忽略未知成员，导回 Tesslo 时专属数据完整恢复 |
| `.html` | 执行文件（导出产物） | player 引擎 + 项目 + 全素材 dataURI 内联，只读播放 |

### 兼容矩阵（"100% 兼容原生 sb3"的精确含义）

| 流向 | 结果 |
| --- | --- |
| Tesslo → 导出 .sb3 → 官方 Scratch 打开 | ✅ 核心内容 100% 可编辑可运行；Tesslo 专属积木显示为灰块（非官方扩展通行表现）；附加区被忽略 |
| 官方 .sb3 → 导入 Tesslo | ✅ 完全兼容，入库转为 .tess |
| .tess → 导回 Tesslo | ✅ 完整恢复（含设置与元数据） |
| Tesslo .sb3 经官方 Scratch 编辑重存再回 | ⚠️ 附加区/专属积木不保证保留 → 降级为纯 Scratch 项目打开并提示，不崩溃 |
| .tess → 官方 Scratch | ❌ 不支持（自有格式，改后缀为 .zip 也不可读 project.json 位置差异）——需要互通时导出 .sb3 |

执行文件边界：.html 无 ArkTS 宿主，若含 Tesslo 专属积木（P4 后
才可能出现），走浏览器原生 API 降级或提示。P1 阶段全是官方积木，
导出即全功能。

## 技术设计

### 首屏项目列表（Launcher）

- 同一 web bundle 内、挂编辑器之前的一层 React 路由：
  `index.jsx` 先渲染 `<ProjectList>`，点开/新建才挂编辑器
  ——不再使用 `defaultProjectId` 直进编辑器
- 挂载方式（架构 v4 §12）：产品层自持 `EditorState`，经
  `createStandaloneRoot` / `AppStateProviderHOC` 挂载（standalone
  路径，P1 首周 spike 验证 ArkWeb 表现；不过则临时回落 legacy
  `AppStateHOC` 挂载，仅挂载方式差异，产品层代码不变）
- 列表项：缩略图 + 名称 + 更新时间 + 位置标记（库内 / 自定义目录）
  - 封面区 = 项目舞台截图：保存时用 `vm.renderer.requestSnapshot` 截取，
    缩放到 320×240 JPEG 写入 `tesslo.json.thumbnail`（无缩略图的旧项目
    显示项目名首字兜底，不再用网格占位）
  - **整张卡片即"打开"**（名称行右侧有轻量进入箭头，PC hover 有"打开作品"
    提示），不再额外放"打开"按钮；底部只保留轻量操作：
    导出 / 历史 / 更多（文字 + 线性 SVG 图标，不用彩色 emoji）
  - 「更多」收纳收藏/取消收藏、重命名、复制、删除（图标+文字）；
    缺失项目底部只保留「更多」（点击卡片即重新关联）
  - PC（hover:hover + pointer:fine）：hover 浮起 + "更多"锚定下拉菜单；
    触屏（无 hover）：操作 ≥48px，"更多"变为底部动作面板（遮罩/大行高），
    不依赖任何 hover 反馈
  - 收藏状态用缩略图角标「已收藏」展示；操作统一在"更多"菜单
- **新建项目对话框**（名称 + 存储位置同一表单，无"下一步"）：
  - 作品名输入框；位置二选一：
    - 默认位置（库内，自动建目录）
    - 自定义目录：`DocumentViewPicker` 目录选择（selectMode=FOLDER）→
      **校验必须为空目录**（转 FileUri.path 后 listFile）→
      `fileShare.persistPermission` 持久化授权（失败则明确拒绝）
  - 目录不合法（非空/无权限）用 **AlertDialog 弹窗**提示，且
    **新建表单不关闭**（保留已填名称与已选目录），可直接重选后重试
- 全局错误呈现：一律 `AlertDialog`（标题 + 文案），不使用页面内横幅；
  保存/导出/删除/快照等操作失败同样弹窗反馈
- 导入：接受 `.tess` 与 `.sb3`（ArkWeb 文件选择器 → 入库）
- 目录缺失态：外部目录被移走 / 删除 → 列表置灰"目录缺失"，
  提供"重新关联"（目录选择器重选，按文件内项目 ID 匹配恢复）
- 编辑器返回路径：gui 的 logo 点击（`onClickLogo`）回列表，返回前
  自动保存；`canSave` / `canEditTitle` 转 true

### 作品库（ArkTS ProjectServer）

- 回环 HTTP JSON 服务，`Ports.ets` 登记
  `PROJECT_SERVER_PORT = 20117`：
  - `GET /projects`（注册表列表）、`POST /projects`
    （新建：{name, customDirUri?}，校验空目录 + 持久授权）、
    `POST /projects/find`（导入去重：projectId / 内容指纹）、
    `GET/PUT /projects/:id`（读/存工作区 bundle：
    tesslo.json + project.json + assets）、
    `GET /projects/:id/legacy`（旧 .tess 迁移读取）、
    `DELETE /projects/:id`（询问是否连目录删除，递归删除）、
    `PUT /projects/:id/meta`（重命名/收藏）、
    `GET /projects/:id/snapshots`（新目录快照 + 旧 .tess 快照）、
    `GET /projects/:id/snapshots/:snap`（快照内容，回滚在客户端合成
    后经 PUT 保存）、
    `POST /projects/:id/relink`（重新关联目录）、
    `POST /pick-dir`（目录选择器 + 持久授权）、
    `POST /projects/import`（.tess / .sb3 入库转换）
- 写入原子性：临时文件 + rename（同目录内，保证原子）
- 外部目录 IO 一律 try-catch 出结构化错误（只读 / 已拔出 / 无授权），
  不让单个坏项目拖垮列表页

### Web 端接通（按架构 D5：经官方 GUIConfig.storage，不接管 chrome）

- 实现 `TessloStorage implements GUIConfig['storage']`
  （上游接口见 `scratch-gui/src/gui-config.ts`）：
  - `saveProject(projectId, vmState, params)` → `ProjectStore.save`
    写 .tess（vmState 即序列化项目字节）
  - `scratchStorage` 配 WebStorageHelper 同语义的 AssetStore
    （素材仍走 20114）
  - 以 `storage` prop 注入 GUI（legacy 路径同样生效，
    `containers/gui.jsx:57`），gui 内部零改动
- 新增 `packages/platform-adapter`（接口冻结 v1，见
  [IDE 架构](../ide-architecture.md) §8）与 `packages/tesslo-shell`
  （Launcher 落于此），harmony + browser 双实现
- 导出菜单（编辑器内 + 列表页）：
  - 导出工程文件 → 格式选择（**默认 .tess**，可选 .sb3）
  - 导出执行文件（.html）

### 版本历史 UI

- 快照列表 + 每行两个动作：**对比 / 回滚**
- 对比弹窗：以该版本为基准对比当前版本——角色数、积木总数、
  每个角色的积木增减、角色增删、积木类别增减（中文类别名）；
  完全一致时明确提示"完全一致"（不做文本 diff）

### 导出执行文件（自包含 HTML）

- player-only 引擎模板：`apps/host/ohos/web/` 新增 player 入口
  （`isPlayerOnly`、仅 zh-CN + en-US、去编辑器/素材库/blocks），
  构建产物 `player.html` 模板入 rawfile，内嵌版本号占位符
- 导出器（Web 端，JSZip 随 scratch-vm 依赖链可用）：
  工程文件（.tess/.sb3）由页面从 ProjectBundle 组装；
  **执行文件（.html）改由宿主 ProjectServer 组装**（读 rawfile 模板 + 工作区，
  避免 13MB 模板经页面 base64 传输冻结主线程），组装完直接弹保存选择器 →
  `下载/作品名.html`；导出成功后底部 Toast「已导出『作品名』.格式」，
  "取消"不阻塞（系统 picker 未弹出时可退出重试）
- 播放端 `ExportedAssetHelper`：素材从内嵌映射解析，声音
  base64 → ArrayBuffer，SVG 保留矢量，全程零网络
- 体验：`<title>`/favicon 用作品名与缩略图；全屏自适应 + 绿旗
  启动页；文件名走 `common/FileName.ts` 清洗

## 任务拆解

> 执行状态（2026-11-17 首轮开工）：✅ = 代码完成且本机验证；
> ⏳ = 代码完成、待真机/模拟器验收；☐ = 未开始。

工程统一（架构 M1 同步项，P1 首周执行）：

- [x] 目录归组：`packages/scratch-*` → `packages/engine/scratch/`
      （workspace globs 与构建脚本清单同步，U9）✅ 全链构建验证
      （修复 svg-renderer findMonorepoRoot 归组后错位，E4）
- [x] 挂载 spike：ArkWeb 冒烟 ✅（编辑器在 ArkWeb 内完整运行：canvas 舞台、
      Blockly 积木引擎、默认项目载入、自动保存——CDP 触摸链路实证；
      注：编辑器挂载最终采用主出口 + AppStateHOC，standalone 出口因内嵌
      react 双实例问题废弃，legacy 回落开关 `TESSLO_LEGACY=1` 保留）
- [x] 工程配置统一：根 eslint + boundaries（D8 双向拦截已验证）、
      tsconfig（per-package strict + `typecheck:product`）、CI lint 门禁 ✅
      （tsconfig references 链未做，以逐包 tsc 替代，够用不追）
- [x] 兼容回归体系 v1（部分）：语料 24 官方固定件入库
      （`tests/corpus/`，独立于引擎）+ 格式往返金测入 CI ✅
      （行为金测/舞台视觉回归待 U8 基线）
- [x] 引擎首刀（**已删除**）：E1 背包 13 文件 + E2 云变量 2 文件 + E3 遥测弹窗
      全部删除，引用链全清（gui-config 类型族/drag-constants/HOC 链/DropArea/
      standalone 导出），`docs/engine-rewrite.md` E1–E5 登记；**回归 30/30
      全绿验证**。standalone 构建链移出 build:gui（E5，源文件标待删）
- [x] 宿主层地基（v6 修订：放弃 ArkUI-X，改三原生壳）：`apps/host/`
      规划文档完成（harmony 壳 = entry 永久主线不迁移；android/ios
      原生壳按需启动，U10 差异登记表就绪）；无 SDK 依赖，决策记录见
      架构 v6 D9

Launcher 与作品库：

- [x] ProjectServer 骨架：端口登记（20117）、路由、JSON 信封协议、
      原子写（tmp+rename）、快照转存与裁剪、picker、persistPermission ✅
      ArkTS 编译通过（hvigor）；真机行为验收 ⏳
- [x] .tess 容器读写器（`@tesslo/formats`：STORE 压缩 zip 组装/解析/
      formatVersion 前向拒绝）+ 注册表（library.json）✅ 7 单测
- [x] 新建流程：默认位置 + 自定义目录（目录 picker + 空目录校验 +
      持久授权；v4 真机实证：URI→FileUri.path 后目录 IO 全可用）✅
- [x] `<ProjectList>` 首屏（`@tesslo/app`）：列表 + 新建 + 重命名 /
      删除（确认，含是否连目录删除）/ 复制 / 收藏 / 导入（.tess/.sb3，
      sb3 经 formats 转换后入库）✅ 类型与构建验证；真机验收 ⏳
- [x] 目录缺失态 + 重新关联（列表置灰 + relink 端点）✅ ⏳
- [x] 编辑器接通（`EditorPane`：产品层自持 EditorState + Provider、logo 返回前
      保存等待）✅ 真机触摸链路实证
- [x] **修复：打开已保存项目崩溃**（2026-11-19）：harmony adapter
      `readProject/readSnapshot` 未解包 `{tessBase64}` 响应体，`atob(对象)`
      必抛 → 项目加载失败并显示崩溃页。修复后连续 3 轮「新建→保存→返回→重开」
      真机通过（Blockly 正常渲染）；补 adapter 契约测试 2 例锁死回归。
      同时修复导出链路（.tess/.sb3/.html 导出走同一 readProject）
- [x] **修复：自定义目录被静默忽略 / 工程文件不落盘**（2026-11-19，真机）：
      ①`pickProjectDir` 未解包 `{dirUri,persisted}` → `customDirUri` 传对象，
      服务端按缺省回落到沙箱；②目录 URI 不能直接拼子文件（13900002），
      需 `fileUri.FileUri(uri).path` 转真实路径。修复后空目录创建/保存/
      重启/删除/relink 全链路真机通过；补契约测试锁死解包行为
- [x] **修复：void 端点误判失败**（2026-11-19）：删除/恢复快照/下载返回
      `{ok:true}`（无 data），adapter 曾按 `data===undefined` 抛 E_IO，
      导致"删除成功却报错、列表不刷新"；改为仅看 `ok`，补契约测试
- [x] **修复：系统 picker 30s 超时**（2026-11-19）：用户在目录选择器里
      停留超过 30s 会触发 AbortController，服务端随后写响应报
      Network is down；picker 请求改用 5 分钟专用超时
- [x] **重构：目录即工程（v5）**（2026-11-19，用户要求）：工作区改为
      tesslo.json + project.json + assets/ + snapshots/，.tess/.sb3 仅导出；
      旧单 .tess 项目首次打开自动迁移（真机验证：迁移后目录结构正确、
      项目可正常打开/保存/回滚）
- [x] **修复：重复导入**（2026-11-19，用户要求）：.tess / Tesslo 导出 sb3
      按 projectId、官方 sb3 按内容指纹去重；命中时 AlertDialog 拒绝
      （真机验证：导出「我的作品2」后再导入 → 提示已存在，未产生副本）
- [x] **修复：快照时间显示 1970**（2026-11-19）：OHOS `Stat.mtime` 单位是
      秒而非毫秒，快照时间戳换算修正
- [x] **验证：外部目录持久授权跨重启有效**（2026-11-19）：force-stop →
      重新启动 → 外部目录作品列表不显示缺失、可正常打开并保存
      （updatedAt 更新；日志无 activatePermission 失败）
- [x] **工作台导航条自绘**（2026-11-19，用户要求）：`WorkbenchNav` 顶部工具栏
      设置 / 保存项目 / 导出项目，最右 关于；Scratch `menuBarHidden`，仅复用
      工作区 UI。真机验证：导航条/设置面板（颜色模式/语言）/保存反馈
      （已保存→回落）/关于弹窗/导出三格式对话框/logo 返回自动保存→列表 ✅
- [x] **自研 UI 风格统一（Scratch 对齐 + 响应式）**：设计令牌
      `packages/app/src/ui/tokens.css`（紫 menu-bar/蓝主按钮/Helvetica/
      4px 圆角/蓝色半透明遮罩）；列表页、导航条、三个弹窗全部重写为
      Scratch 观感；响应式断点 640/720/1024，宽/窄视口真机截图验证 ✅
- [x] `packages/platform-adapter`（接口 v1 + harmony/browser 双实现）✅
      协议 v1 冻结（ADAPTER_PROTOCOL=1）
- [x] Web 端 `TessloStorage`（GUIConfig.storage：saveProject 组 .tess、
      Helper 服务项目/素材、脏素材 store 语义、默认项目回落）✅ ⏳
- [x] 快照列表 + 一键回滚（回滚前转存当前版）✅；差异摘要 ✅
      （积木总数/角色数/新积木类别，孩子友好文案；adapter 协议 v2 增
      `readSnapshot`，真机验证快照字节往返；4 单测）
- [x] 可靠性测试（真机实证）：保存中杀进程 ×6 全部完整（打断在 rename 前
      保持旧版，tmp+rename 原子写语义实证）；1.8MB 大保存 → force-stop →
      重启读回 1853KB 完整 zip、13 成员、快照完整；空库冷启动多轮 ✓；
      外部目录 .tess 被删 → missing=true → relink 重指含 .tess 目录恢复
      missing=false（连带修复"目录在但文件丢失不判缺失"的真 bug，2026-11-18）

导出：

- [x] 工程文件导出：.tess（默认）与 .sb3（含静默附加区）
      双格式 + 格式选择 UI（列表卡片"导出"→ 三选一对话框；默认 .tess）✅
- [x] player 入口 + 独立 webpack 配置（`webpack.player.js` → 模板内联
      `scripts/inline-player-template.mts`，占位符协议 + `</script>` 转义）✅
      注：用主出口 + legacy AppStateHOC 挂载（standalone UMD 的 React external
      在自包含场景解析为 null，实测废弃该路径）
- [x] HTML 导出器（web 装配层 `exporter.ts`：模板经 AssetServer rawfile 通道
      取用，adapter 接口零改动）+ ExportedAssetHelper + 零网络 ✅
      桌面 Chrome 实测：绿旗启动、角色渲染、performance 资源请求 = 0
- [x] 全屏自适应 + 绿旗启动页 + title 注入 ✅（favicon/缩略图 P2）
- [ ] 三端验证：桌面 Chrome ✅ / 手机浏览器 ☐ / HarmonyOS 浏览器 ☐
      （断网验证经"零资源请求"结构性证明）
- [x] 体积基线入档并优化（2026-11-18）：42.5MB → **12.3MB 模板 / 12.2MB 产物**
      （-71%）。手段：①gui 源码级 player 出口 `index-player.tsx`（只挂
      舞台+监视器，不含积木/画板/素材库）②播放端 createPlayerStore（去掉
      scratch-paint reducer ~3.8MB）③语言裁剪 zh-cn+en（74 语言 4.3MB→101KB，
      `scripts/trim-player-locales.mts`）④react/redux 走 external 单实例。
      桌面 Chrome 实证：canvas 渲染、绿旗运行、零网络请求、零报错。
      剩余 2.2MB 距 ≤10MB 目标：vm/render/blocks(vm 内) 为必需内核，
      后续可在 vm 层做扩展懒加载（face-detection ~4.7MB 未进 player）
- [x] 兼容矩阵实测：**五行全部机器验证**（`tests/compat-matrix.test.ts`：
      用官方语义引擎 scratch-vm node dist 加载 Tesslo 全部产物，
      targets/blocks/名称 deepEqual 等价；行 4 剥离静默成员降级不崩溃；
      行 5 .tess 格式身份断言；audioEngine Proxy stub 处理 node 无声卡）✅

## 验收标准

- [x] 冷启动首屏为项目列表；新建（默认 / 自定义目录）→ 编辑 →
      返回 → 重开，作品完整（**CDP 真机触摸链路 8 步全通**：新建对话框 →
      位置二选一 → 编辑器挂载+canvas → 默认项目载入（Stage+Sprite1）→
      logo 返回自动保存 47KB 完整 .tess → 返回列表 → 服务端读回完整 →
      再次打开正常。经 ArkWeb CDP（dev 构建 setWebDebuggingAccess，
      锁屏下页面级验证）；v4 自定义目录经 URI→path 后落桌面工程文件（真机）
- [x] 自定义目录非空时创建被拒绝并有明确提示（真机实证：桌面非空 →
      E_DIR_NOT_EMPTY；空目录 → external 创建成功；UI 文案按错误码映射）
- [x] 外部目录被移动 / 删除后：列表显示缺失态，重新关联可恢复
      （真机实证：.tess 删除 → missing=true → relink 重指 → missing=false）
- [x] 保存中杀进程不损坏（×6 竞速 + 1.8MB 大保存重启读回完整）；
      回滚可直接运行且可再撤销（restore 前先转存当前版，API 实证）
- [x] 导出工程默认 .tess；.sb3 互通核心内容 100% 可用（官方语义引擎
      scratch-vm 加载导出产物 deepEqual 等价，矩阵行 1）；导入往返无损
      （矩阵行 2/3）
- [x] 单 HTML 双击即玩，断网可用，全程零网络请求
      （桌面 Chrome 实证：绿旗运行、角色渲染、performance 资源请求=0；
      ArkWeb 内核侧由触摸链路编辑器全功能运行覆盖（同一 WebView 内核）；
      手机浏览器端留待后续真机补充）
- [ ] 中型作品导出 < 30s；引擎 ≤ 10MB；中文文件名跨平台合法

## 风险与备注

- 授权持久化依赖 `fileShare.persistPermission` + `activatePermission`
  （module.json5 已声明 `ohos.permission.FILE_ACCESS_PERSIST`；重启后
  首次列表/打开时激活）：持久化失败的项目需重新选择目录，UI 有稳定引导
- 外部目录在可移动存储 / 云同步目录时的 IO 抖动：全部结构化
  错误处理，不崩溃
- 用户可能手动移走/删除外部目录或 .tess：读不到内容 → 按"目录缺失"处理
- 删除作品勾选"同时删除作品文件/文件夹"时递归清理（文件 + snapshots/）；
  外部目录的父目录未授权，`rmdir` 根目录会被拒（Operation not permitted），
  结果为"清空后保留空文件夹"（UI 文案按 sandbox/external 区分）
- 运行中保存的一致性：保存前暂停或序列化期间冻结运行，
  与上游 scratch-gui 行为对齐
- .tess 与 .sb3 双格式导出维持同一导出器骨架，只换容器组装层，
  避免两套代码
