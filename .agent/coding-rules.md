# Tesslo 编码规范（ArkTS / TS / React / C#）

> `scratch-link-ohos` 的 C#/NAPI 约束参考同一文件第 1 节 Java 规则中可迁移的
> 注释、常量、枚举部分，按 C#/NativeAOT 惯例改写；C++/NAPI 另按 §13 的
> ABI/内存约束执行。

## 0. 适用范围与总纲

架构定位与决策号见 `docs/ide-architecture.md`（评审稿 v5），本规范是其
代码层落地。

**分区与政策**：

| 分区 | 路径 | 语言政策 | 修改政策 |
| --- | --- | --- | --- |
| 产品层 | `packages/app` `state` `ui` `formats` `extensions` `platform-adapter`、`apps/host/ohos/web` | **TypeScript（strict）无例外**（D4'） | 自有代码，完全适用本规范 |
| 兼容引擎 | `packages/engine/scratch/**`（gui/vm/render/blocks/paint/storage/…；迁移期仍在 `packages/scratch-*`） | 现状 JS；**接触即 TS**：改到的文件顺手迁移类型，不做专项 | **绞杀者（D7）**：引擎只出不进——新实现落产品层，被替换模块删除并登记 `docs/engine-rewrite.md`；引擎改动必跑兼容回归（§11） |
| 宿主 | `apps/host/ohos/entry/**`（harmony 壳 = ArkTS+ArkWeb，**永久主线**，D9 v6 三原生壳）；Android 壳 `apps/host/android`（Kotlin）、iOS 壳 `apps/host/ios`（Swift）按需启动 | harmony 用 ArkTS；Android 用 Kotlin；iOS 用 Swift | 自有代码；服务成对启停、仅回环监听（§10）；三壳共用桥协议规格 |
| C# Link | `packages/scratch-link/{scratch-link-ohos,napi,src,test}` | C# / C++ | 自有实现，适用 §12/§13 |
| C# Link 上游 | `packages/scratch-link/{scratch-link-common,scratch-link-win,scratch-link-mac,scratch-link-win-msix,ohos-net/runtime}` | — | 保持上游/外部原样；必要修改单独说明并评估 win/mac 影响 |

- **语言边界**：TS 只出现在产品层与被触碰的引擎文件；UI 层不引入第二门
  语言；ArkTS 限制 > 本规范 > 文件现有风格（引擎文件触碰时可整体统一
  风格与格式）。
- 引擎死代码（云变量 / 社区 / 背包 / 遥测路径）优先清理：先标
  `@tesslo-dead` 注释圈定，随后整段删除并登记。

## 1. 缩进与格式（强制）

- `.ets` / `.ts` / `.tsx` / `.js` / `.jsx` / `.mjs` 统一 **2 个空格**，
  禁止 Tab；`.json5` / `.css` / `.cs` / `.cpp` 统一 **4 个空格**，禁止 Tab。
- 编辑器 `editor.tabSize`：JS/TS/ETS 为 2，CSS/C#/C++ 为 4；
  Prettier / ESLint 的 `tabWidth` 按文件类型对应设置。
- 单引号、语句结尾分号；多行对象/数组的尾随逗号按文件现有风格，不混用。
- 不新增横向超过一屏的长行；长表达式按第 8 节换行。
- 引擎文件的批量重排仅限本次触碰的文件内，且必须同 PR 过兼容回归；
  跨文件纯格式化重排不单独提交。

## 2. 代码组织顺序（强制）

### 2.1 ArkTS `.ets`

1. `import`
2. 常量 / `enum` / `interface` / `type`
3. `@Entry` / `@Component` `struct`
4. 状态与入参：`@State` / `@Prop` / `@Link` / `@Provide` / `@Consume` /
   `@StorageLink` / `@ObjectLink`
5. 私有服务、控制器、定时器/监听器句柄
6. 生命周期：`aboutToAppear` / `aboutToDisappear`
7. `@Watch` 回调、计算属性 / getter
8. `@Builder` / `@Styles` / `@Extend`
9. `build()`
10. 私有辅助方法

- `build()` 只写 UI 结构；网络、文件、蓝牙、重计算放生命周期或 service。
- 单行 `const` 可连续声明不空行；多行声明/对象/逻辑块之间空一行。
- 跨文件共享常量放宿主 `common/`（迁移期 `entry/src/main/ets/common/`）。

### 2.2 产品层 TS/TSX 模块（React）

1. `import`（分组：react → 产品层包 → 引擎嵌入面 → 本地模块）
2. 常量 / 类型
3. 内部辅助函数 / hooks
4. 导出组件 / 函数
5. `default export`（仅在需要时）

- 一个模块只负责一个主题；不混 Web、协议、UI 三类逻辑。
- 组件薄：数据/存储/网络逻辑下沉到 `packages/app` 的模块或
  `platform-adapter`，组件不直接碰桥。
- 引擎类型不外泄：产品层对外 API 用自有类型，引擎类型只在嵌入面
  边界内出现。

## 3. 命名

| 对象 | 规则 | 示例 |
| --- | --- | --- |
| ArkTS `struct`/`class`/`interface`/`enum` | PascalCase | `AssetServer`、`BleTcpBridge` |
| ArkTS 字段/方法 | camelCase | `startAssetServer`、`rawPath` |
| 模块级常量 | UPPER_SNAKE_CASE | `ASSET_PREFIX`、`ADAPTER_PROTOCOL` |
| JS/TS 函数/变量 | camelCase | `loadMedia`、`getAdapter` |
| TS 类型/接口 | PascalCase | `ProjectMeta`、`PlatformError` |
| React 组件 | PascalCase | `ProjectList` |
| 产品层包名 | `tesslo` 域小写 | `@tesslo/app`、`@tesslo/formats` |
| 文件 | 沿用目录现有风格 | ArkTS `Index.ets`；TSX `project-list.tsx` |

- 布尔值用 `is/has/can/should` 前缀。
- 事件回调用 `onXxx` / `handleXxx`，不要 `callback1`。
- 不用 `_` 前缀表示私有；TS/ArkTS 用 `private`，TS 模块内不导出即私有。
- 不用缩写，除非是团队通用词（`vm`、`ble`、`napi`、`sb3`）。

## 4. 注释（强制）

- 模块级/字段级 `const`/`let` 必须有注释；函数内局部变量仅在语义不直观时注释
  （循环下标等自解释变量除外）。
- `const`/`let` 用 `//` 单行注释；**禁止** `/** 中文 */` 单行 JSDoc 修饰变量。
- 函数/方法用 JSDoc `/**`，`/**` 后必须换行；导出/公共 API 写
  `@param` / `@returns`。
- 生命周期与 `@Watch` 方法用多行 `/** */` 或 `//` 说明触发时机与副作用。
- `enum` 成员用 `//` 或跨行 `/** */`；禁止单行 `/** 中文 */`。
- 注释解释"为什么/约束"，不复述代码；用中文，和现有代码一致。
- 不保留注释掉的代码；需要时用 git 历史。
- 引擎改动若涉及行为语义（而非纯实现），在 `engine-rewrite.md` 记
  一行决策记录，不在代码里留长篇历史叙述。

## 5. 函数与异步

- 顶层独立函数用 `function` 声明；回调用箭头函数（`map`/`filter`/`forEach`/
  `setTimeout`/Promise 回调）。
- ArkTS `struct`/`class` 用方法语法；不要把方法写成 `const fn = () => {}` 字段，
  除非 API 明确要求函数类型。
- 业务代码统一 `async/await` + `try/catch`；禁止 `.then/.catch` 链。
  例外：底层 API 只提供 Promise 链（如 ArkTS socket `send().then().catch()`），
  但必须处理 rejection。
- 不允许 floating promise：每个 async 调用要么 `await`，要么显式
  `void promise.catch(...)` 并记录错误。
- 导出/公共函数写显式返回类型；`Promise<T>` 写明 `T`。
- `catch` 不允许空块；记录日志并决定重试/降级/抛出。
- 错误对象按 `BusinessError` / `Error` / `PlatformError` 处理；不要吞掉
  错误后返回假数据。

## 6. 类型（TypeScript strict 与 ArkTS）

产品层 `tsconfig` 开 `strict` 全家（`strictNullChecks` 等）；引擎迁移
TS 的文件同样按 strict 写。

- TS 侧不使用 `any` / 隐式 `any`；跨边界 JSON 先定义 `interface`/`type`，
  字段逐项校验后再使用。
- ArkTS 不使用结构化类型；对象形状用显式 `interface`/`class`；
  不使用索引签名 / `obj[key]` 动态访问，键值集合用 `Map<string, T>`。
- 不使用 `eval`、`Function`、`arguments`、原型改写、`delete`。
- 不用 `as` 掩盖类型错误；跨边界（JSON、Native、引擎互操作）才用断言，
  并在断言前校验；禁止 `as unknown as T`（引擎遗留代码触碰时顺手消除）。
- 可空值用 `?` / `| null` 显式表达；使用前收窄；非空断言 `!` 只在有注释的
  不变量下使用。
- **大整数精度（强制）**：ArkTS/JS 的 `number` 只有 53 位安全整数。后端
  Long / 雪花 ID / 时间戳必须以 `string` 传输；前端类型声明为 `string`，
  禁止 `Number(id)`、`parseInt(id)` 后再比较/拼接。
- 固定集合用 `enum` 或 union type；协议字段不要用裸字符串魔法值
  （错误码用 `PlatformErrorCode` union，见 §10）。

## 7. 状态与 UI

### 7.1 ArkTS

- `@State` 只放组件内部可变状态；`@Prop` 单向入参；`@Link` 双向；
  `@Provide/@Consume` 跨层级；`@Observed/@ObjectLink` 处理嵌套对象。
- 不直接修改 `@Prop`；子组件通过回调通知父组件。
- 不把可推导的展示状态放进全局/持久化存储。
- 不把 `@Observed`/`@State` 对象解构成局部变量；整体传递，避免丢失
  引用/响应式语义。
- `@Watch` 写法紧凑：装饰器与状态字段同一行；回调命名 `onXxxChanged`；
  回调内不做长耗时/网络操作，转异步并捕获错误。
- `build()` 保持纯 UI；`ForEach` 使用稳定 key，不要用数组下标作为可重排列表的 key。
- 生命周期成对申请/释放资源（socket、timer、listener）。
- 日志用 `AppLog` 的 `log`，不要在生产代码用 `console.log`；不打印敏感数据。
- 用户可见文案/颜色优先用资源 `$r('app.string.xxx')`；离线素材路径集中定义。

### 7.2 React / Redux（产品层，强制）

- **不引入第二状态库（D6）**：Launcher 与轻页面用组件本地 state
  （`useState`）；编辑器状态一律经产品层自持的 `EditorState`
  （标准 redux store，`guiReducers` 与自有 reducers 同 store 分域挂载）。
- 组件不 dispatch 引擎内部 action；项目流只用嵌入面导出的 action
  （`setProjectId` / `requestNewProject` / `manualUpdateProject` 等）。
- 自有 reducers 命名域隔离（如 `tesslo/` 前缀），不与 gui reducers
  字段交叉。
- selector 放 `packages/state`，组件不手写 `store.getState()` 深取值。
- 异步动作的错误按 `PlatformError.code` 映射用户文案与恢复动作
  （`E_DIR_MISSING` → relink 流；`E_NO_AUTH` → 重新授权），不允许
  裸 `alert` / 静默失败。
- **用户可见文案品牌化（强制）**：任何弹窗/提示/错误不得出现 Scratch
  立场的表述（如"Scratch 出现故障/报告给 Scratch 团队"），一律以 Tesslo
  为主体。引擎自带文案统一经 `packages/engine/scratch/scratch-gui/src/lib/tesslo-brand.ts`
  覆盖；新增产品层文案直接用 Tesslo。仅保留必要的 "Powered by Scratch"
  归属说明（关于弹窗）。

## 8. 组件与长链格式

ArkTS 链式调用/多参数组件：超过一屏宽时，一次调用/一个参数一行，缩进 2 空格，
闭合对齐；短链可单行。

```ts
Text(item.name)
  .fontSize(14)
  .fontColor(Color.Gray)
  .maxLines(1)
```

```ts
ComponentName({
  title: item.title,
  onClick: () => this.handleClick(item)
})
  .width('100%')
```

JSX/TSX 同理：

```tsx
<Component
  title={item.title}
  onClick={() => handleClick(item)}
/>
```

- 不在模板/JSX 里写复杂三元表达式和多层函数；抽成变量或辅助函数。
- 不留行尾空格；闭合标签/括号与起始对齐。

## 9. 常量、单位与样式

- 魔法字符串/数字抽成 `UPPER_SNAKE_CASE` 常量；共享常量：宿主放
  `common/`（迁移期 `entry/src/main/ets/common/`），Web 侧放
  `web/src/constants.js` 或产品层包内 `constants.ts`。
- **端口只登记在 `Ports.ets`**；任何代码不得散写端口号（Web 侧经
  adapter，不出现端口字面量）。
- ArkTS 长度用 `vp`，字体用 `fp`，相对布局用 `%`；禁止新代码使用 `px`。
  需要 px 转换时集中封装，不在业务代码散落 `px2vp()`。
- Web/CSS 新代码用 `rem` / `%` / `vw` 或 CSS 变量；静态布局不写死 `px`。
  存量样式逐步迁移，不为此批量重排。
- **触屏目标（tesslo-ui 及一切新产品 UI）**：可点击目标 ≥ 48vp/48px
  逻辑像素，间距按触屏优先设计（P2 方案约束）。
- **自研 UI 视觉必须对齐 Scratch（强制）**：一切 Tesslo 自有页面/组件
  （列表页、工作台导航条、弹窗、tesslo-ui）统一引用
  `packages/app/src/ui/tokens.css` 的设计令牌——紫 menu-bar
  `#855CD6` / 蓝主按钮 `#4C97FF`（hover `#3373CC`）/ 文本 `#575E75` /
  `Helvetica Neue` 字族 / `0.25rem` 圆角 / 蓝色半透明弹窗遮罩
  `hsla(215,100%,65%,.9)`；禁止散写颜色与字号。产品层只复用 Scratch
  工作区（积木/舞台/画板/角色面板），chrome 一律自绘且保持 Scratch 观感。
- **响应式（强制）**：自研 UI 必须通过 `clamp()/min()/max()` 与断点适配——
  窄屏 < 640px 单列/压缩、中屏 640–1024px 自适应网格、宽屏完整布局；
  整页高度用 `vh` + `dvh` 双写；弹窗宽度 `min(px, 100%)` 且内容可滚动。
- ArkTS：简单颜色/透明度可以内联；长样式链抽到 `@Styles`/`@Extend` 或样式常量。
- Web：静态样式放 CSS/class；内联 `style` 只用于动态值（颜色、transform）。

## 10. 网络与平台适配（含桥契约，强制）

### 10.1 通用

- 所有 HTTP/WebSocket 走统一 client/service；组件里不直接 `fetch` /
  `new WebSocket`。
- 请求/响应有显式类型；错误、超时、空响应分别处理；不把裸 JSON 直接塞进 UI。
- 事件流/长连接按事件类型过滤（`event.type` / `method`）；如用 SSE，
  统一走封装的 `fetchEventSource` 客户端。
- 大整数 ID 按字符串处理（见 §6）。
- 重试要有上限和退避；不要无限重连。

### 10.2 平台适配（platform-adapter）

- **产品层禁止绕过 adapter 直连回环服务**：不出现 `127.0.0.1`、端口
  号、`/internalapi` 等宿主细节；adapter 是唯一出口。
- adapter 所有方法 reject `PlatformError`（`code: PlatformErrorCode`
  union + `retryable`）；**桥层不自动重试**，重试归 UI 层；超时约定
  常规 10s、save/load 30s。
- adapter 接口改动视为协议变更：`ADAPTER_PROTOCOL` 版本号 +1，harmony /
  browser 双实现同步改，并在 PR 说明里列破坏面。
- `browser` 实现不得引用任何宿主能力；`harmony` 实现不 import 产品层
  UI 代码。

### 10.3 宿主桥服务（ArkTS）

- 新服务：宿主平台目录下 `<域>/`（迁移期 `entry/ets/<域>/`）+
  `Ports.ets` 端口登记 + `start/stop` 成对（挂 EntryAbility 生命周期）。
- 服务实现基于 `common/MiniHttp`（抽自 AssetServer 模式）：路径白名单、
  `..` 逃逸拦截、统一响应信封
  `{ok:true,data} | {ok:false,error:PlatformError}`；二进制走
  `application/octet-stream`。
- **只绑定 127.0.0.1**；不加鉴权逻辑（回环内无敏感面），不监听非回环地址。
- 三原生壳共用桥协议规格（信封格式/端口表，见 `apps/host/common/`）；
  harmony 壳在 `apps/host/ohos/entry`，Android/iOS 壳在 `apps/host/{android,ios}`
  （D9 v6：不引入跨平台 UI/壳框架）。

## 11. 测试与兼容回归

- Node 测试用 `node:test` + `assert/strict`，放在 `tests/` 或包的 `test/`。
- 测试名描述行为；Arrange/Act/Assert 清晰；不依赖真实网络/设备。
- BLE/存储等外部依赖用 mock/fake；测试结束清理定时器和 socket。
- **兼容回归（引擎改动必跑，CI 强制）**：
  - 语料加载运行（官方示例 + 社区项目分层语料库）；
  - 行为金测：确定性运行后快照（角色位置/变量/列表/消息计数）；
  - 格式往返：load → save → 项目哈希；`.tess ↔ .sb3` 双向；
  - 舞台视觉回归（截图 diff，阈值容差）。
- 单元测试 Vitest、端到端 Playwright（经 browser adapter，M1 引入，
  U7 定案前先以 node:test 覆盖纯逻辑）。
- 提交前跑 `pnpm test`；引擎/产品层/宿主改动分别按 §14 的门槛执行。

## 12. C#（scratch-link-ohos）

本模块是 OHOS 平台实现：`BLE/`、`Exports.cs`、`OhosGattHelpers.cs`、
`OhosSessionManager.cs`、`Program.cs`。`scratch-link-common` 是上游共享实现，
不在本模块重写。

### 12.1 文件与命名

- 一个文件一个类型；文件名 = 类型名（`OhosBleClient.cs`）。
- 命名空间 `ScratchLink.Ohos`；子目录用 `ScratchLink.Ohos.BLE`。
- 类型/方法/属性/事件用 PascalCase；参数/局部变量用 camelCase；
  私有字段沿用现有 camelCase（如 `app`），不要加 `_` 前缀。
- 常量用 PascalCase（如 `BaseUuidSuffix`）；枚举成员 PascalCase；
  协议字符串/数字不裸写，抽常量或 enum。
- 平台实现默认 `internal`；只有 NAPI 导出/跨程序集契约才 `public`。
- Attribute 只用于 ABI/序列化/裁剪提示（如 `[UnmanagedCallersOnly]`、
  `[JsonPropertyName]`、`[DynamicallyAccessedMembers]`）；不要用 attribute
  做业务逻辑或隐藏副作用。

### 12.2 注释

- 公共/内部类型与成员用 XML doc：`/// <summary>`、`/// <param>`、
  `/// <returns>`；覆盖/实现接口用 `/// <inheritdoc/>`。
- 私有辅助方法、复杂分支、平台 workaround 用 `//` 说明"为什么"。
- 新增注释用中文；与上游 common 对应的 XML doc 可保留英文，
  但同一段不要中英混写。
- 文件头用 `//` 说明平台职责与边界（参考 `Exports.cs`、
  `OhosSessionManager.cs`）。
- 不保留注释掉的代码。

### 12.3 可空、异常与异步

- 工程已开启 `<Nullable>enable</Nullable>`；可空值显式 `?`；
  不用 `!` 掩盖可空，除非不变量有注释。
- 不用 `null` 表示空集合/默认值；返回 `Array.Empty<T>()` 或空集合。
- 捕获具体异常；不空 catch；记录后重抛或返回明确错误码。
- **跨 NAPI ABI 的 `[UnmanagedCallersOnly]` 导出必须捕获所有异常并返回错误码**；
  禁止托管异常穿过 ABI。
- `async` 方法用 `Task`/`ValueTask` + `CancellationToken`；
  禁止 `.Result`/`.Wait()`；除事件处理器外禁止 `async void`。
- `IDisposable`/`using`/`await using` 管理 socket、timer、stream；
  不在 finalizer 里做异步清理。

### 12.4 NativeAOT / trimming

- 不使用 `dynamic`、`Activator.CreateInstance`、`Assembly.Load`、
  `Type.GetType`、`MakeGenericType` 等反射路径；确需反射时更新 `rd.xml`
  并注释原因。
- JSON 用源生成 `JsonSerializerContext`；不依赖运行时反射序列化。
- JSON/协议 DTO 用显式属性类型；字段名与协议一致；不把 `JsonElement`
  直接散落到业务层，边界解析后转成强类型。
- 新增依赖前确认 NativeAOT 兼容；不使用 AOT 不支持的 API。
- `AllowUnsafeBlocks` 仅用于 interop；`unsafe` 块最小化，并注释
  内存/长度/所有权。
- 跨 ABI 返回的 unmanaged 内存必须明确所有权与释放约定：
  调用侧复制后释放，或在 C# 侧提供释放函数。
- `rd.xml` 只增必要项，并在提交说明里写清为什么需要。

### 12.5 结构与边界

- 平台差异只放 `scratch-link-ohos`；不要修改 `scratch-link-common`
  的通用行为。确需修改时，单独说明并评估 win/mac 影响。
- 一个类只负责一个平台能力（BLE client/session/peripheral/gatt）；
  共享逻辑上移到 common 或本模块 helper。
- 日志/错误输出沿用 `Console.Error` 或现有 logger；库代码避免
  `Console.WriteLine`；不打印敏感数据。
- 枚举/协议字符串在边界校验；未知值返回明确错误，不静默回退到默认行为
  （除非注释说明）。

## 13. C++ / NAPI（packages/scratch-link/napi）

本模块只有 `tesslo_link_napi.cpp`：把 C# `[UnmanagedCallersOnly]` 导出包装成
Node-API 函数，供 ArkTS 侧加载。

- 4 空格缩进；`nullptr`；能用 `const`/`constexpr` 就用；RAII 管理资源，
  禁止裸 `new`/`delete`。
- 只在 `extern "C"` 边界导出；符号名必须与 C# `UnmanagedCallersOnly(EntryPoint=...)`
  一致（`TessloLinkStart`/`TessloLinkStop`/`TessloLinkVersion`）。
- 每个 `napi_*` 调用检查 `napi_status`；失败用 `napi_throw_error`/
  `napi_throw_type_error` 并返回 `nullptr`。
- 禁止 C++ 异常穿过 NAPI 边界；内部 `try/catch (...)` 兜底并转成 JS 错误。
- 不缓存 `napi_env`/`napi_value` 跨调用；不引入全局可变状态；
  需要共享状态时明确线程安全策略。
- 字符串/缓冲区长度显式传递；检查空指针/越界；不信任 JS 传入的指针/长度。
- 与 C# 导出约定同步修改（符号名、参数、返回码），两侧注释互相引用。

## 14. 架构边界、修改政策与提交门槛（强制）

### 14.1 依赖方向（D8，CI 以 eslint-boundaries / dependency-cruiser 强制）

```text
产品层 app → state / ui / formats / extensions / platform-adapter
产品层 → 引擎：仅经嵌入面（EngineFacade、嵌入组件、GUIStorage 实现）
引擎 → 产品层：禁止
platform-adapter：零运行时依赖，不 import 产品层
宿主 → 桥协议：不感知 IDE 概念
```

- 产品层不使用任何宿主专有 API（D9 v6 保险：桥为平台无关 HTTP/WS，
  三原生壳任意替换产品层零改）。
- 引擎代码不得 import `@tesslo/*`；确需产品层能力时，把能力下沉到
  嵌入面或平台无关模块。

### 14.2 修改政策（绞杀者，D7）

- 引擎只出不进：新实现落产品层域包；被替换的引擎模块删除并登记
  `docs/engine-rewrite.md`（替换物、验证记录）。
- 引擎行为语义改动必须跑全量兼容回归（§11），纯死代码删除跑语料
  加载子集。
- 删除引擎功能前先确认产品层无引用（boundaries 检查 + 全局搜索）。

### 14.3 生成物与密钥

- 不提交生成物：`rawfile/`、`build/`、`dist/`、`oh_modules/`、
  `node_modules/`、`*.hap`、`apps/host/**/build 产物`、
  `packages/scratch-link/ohos-net/runtime/`、
  `packages/scratch-link/scratch-link-ohos/bin|obj/`、
  `packages/scratch-link/napi/*.so`。
- 不提交密钥/令牌；用 `.env` / 环境变量。

### 14.4 提交门槛（按改动分区）

| 改动区 | 提交前必须 |
| --- | --- |
| 产品层 | `pnpm test` + lint（含 boundaries）+ 相关单元测试 |
| 兼容引擎 | 兼容回归全绿（CI）+ `engine-rewrite.md` 登记（若删除/替换/语义变化） |
| 宿主（ArkTS / host） | 真机冒烟清单 + 服务成对启停自查 |
| C# / NAPI | `dotnet build scratch-link-ohos`（本机有 .NET 9 时）；符号/参数/返回码两侧同步；发布前 `pnpm build:link:csharp` + CI |

- 通用自查：`git status` 无意外文件；注释/类型/大整数规则复查；
  floating promise / 空 catch 复查。

## 附：与源规则的对应关系

| 源规则 | 本节 |
| --- | --- |
| 3.0 缩进规范 | §1 |
| 3.1 `<script setup>` 组织顺序 | §2 |
| 3.2 注释风格 | §4 |
| 3.3 函数声明 | §5 |
| 3.4 watch 写法 | §7（`@Watch`） |
| 3.5 Composable 规范 | §2.2 / §7 / §10 |
| 3.6 常量 | §9 |
| 3.7 el-tag 格式 | §8（ArkTS/JSX 组件格式） |
| 3.8 单位规范 | §9（`vp`/`fp`；Web 相对单位） |
| 3.9 模板内样式 | §9（`@Styles`/`@Extend`；CSS class） |
| 6.4 前端类型对齐 | §6（大整数按 `string`） |

### C# / C++（源第 1 节 Java 规则的可迁移部分）

| 源规则 | 本节 |
| --- | --- |
| 1.1 注解 | §12.1 / §12.3（attributes 只用于边界/导出） |
| 1.2 注释风格 | §12.2（XML doc） |
| 1.4 枚举类型字段 | §12.5（enum/协议校验） |
| 1.6 VO/DTO 规范 | §12.4（AOT DTO/源生成序列化） |
| 1.7 枚举值校验 | §12.5 |
| 1.8 常量 | §12.1 |

- 1.3 Entity、1.5 Repository 分层不适用：`scratch-link-ohos` 没有数据库/仓储层。
- C++/NAPI 没有直接对应的 Java 规则，按 §13 的 ABI/内存约束执行。
