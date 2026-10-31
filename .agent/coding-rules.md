# Tesslo 编码规范（ArkTS / JS / C#）

> `scratch-link-ohos` 的 C#/NAPI 约束参考同一文件第 1 节 Java 规则中可迁移的
> 注释、常量、枚举部分，按 C#/NativeAOT 惯例改写；C++/NAPI 另按 §13 的
> ABI/内存约束执行。

## 0. 适用范围

- **ArkTS**：`apps/tesslo/entry/src/main/ets/**/*.ets`（UI、Ability、BLE、素材服务）。
- **JS/JSX**：`apps/tesslo/web/**/*.{js,jsx}`、`scripts/**/*.mjs`、`tests/**/*.js`。
- **自有 JS/TS**：`packages/scratch-link/src/**/*.js`、`packages/scratch-link/test/**/*.js`。
- **自有 C#**：`packages/scratch-link/scratch-link-ohos/**/*.cs`（OHOS 平台实现、NAPI 导出）。
- **自有 C++/NAPI**：`packages/scratch-link/napi/**/*.cpp`。
- `packages/scratch-*` 的 vendored 上游源码（含 `scratch-link-common`、
  `scratch-link-win`、`scratch-link-mac`、`scratch-link-win-msix`、
  `ohos-net/runtime`）**保持上游风格**，只改必要行，不整文件重排。
  `scratch-link-ohos`、`napi`、`src`、`test` 是本仓自有实现，适用本规范。
- 冲突优先级：官方 ArkTS 限制 > 本规范 > 文件现有风格；存量代码不做无意义重排。

## 1. 缩进与格式（强制）

- `.ets` / `.ts` / `.js` / `.jsx` / `.mjs` 统一 **2 个空格**，禁止 Tab；
  `.json5` / `.css` / `.cs` / `.cpp` 统一 **4 个空格**，禁止 Tab。
- 编辑器 `editor.tabSize`：JS/TS/ETS 为 2，CSS/C#/C++ 为 4；
  Prettier / ESLint 的 `tabWidth` 按文件类型对应设置。
- 单引号、语句结尾分号；多行对象/数组的尾随逗号按文件现有风格，不混用。
- 不新增横向超过一屏的长行；长表达式按第 8 节换行。
- 不制造格式化噪声：修改 vendored 文件时只改目标行。

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
- 跨文件共享常量放 `entry/src/main/ets/common/`。

### 2.2 JS/JSX 模块

1. `import`
2. 常量
3. 内部辅助函数
4. 导出函数 / React 组件
5. `default export`（仅在需要时）

- 一个模块只负责一个主题；不要在同一文件混 Web、协议、UI 三类逻辑。
- React 组件保持薄；数据/存储/网络逻辑放 `src/storage.js` 等独立模块。

## 3. 命名

| 对象 | 规则 | 示例 |
| --- | --- | --- |
| ArkTS `struct`/`class`/`interface`/`enum` | PascalCase | `AssetServer`、`BleTcpBridge` |
| ArkTS 字段/方法 | camelCase | `startAssetServer`、`rawPath` |
| 模块级常量 | UPPER_SNAKE_CASE | `ASSET_PREFIX`、`MAX_RETRY` |
| JS 函数/变量 | camelCase | `loadMedia`、`repoRoot` |
| React 组件 | PascalCase | `AboutModal` |
| 文件 | 沿用目录现有风格 | ArkTS `Index.ets`；JS `storage.js` |

- 布尔值用 `is/has/can/should` 前缀。
- 事件回调用 `onXxx` / `handleXxx`，不要 `callback1`。
- 不用 `_` 前缀表示私有；用 `private`。
- 不用缩写，除非是团队通用词（`vm`、`ble`、`napi`）。

## 4. 注释（强制）

- 模块级/字段级 `const`/`let` 必须有注释；函数内局部变量仅在语义不直观时注释
  （循环下标等自解释变量除外）。
- `const`/`let` 用 `//` 单行注释；**禁止** `/** 中文 */` 单行 JSDoc 修饰变量。
- 函数/方法用 JSDoc `/**`，`/**` 后必须换行；导出/公共 API 写
  `@param` / `@returns`。
- 生命周期与 `@Watch` 方法用多行 `/** */` 或 `//` 说明触发时机与副作用。
- `enum` 成员用 `//` 或跨行 `/** */`；禁止单行 `/** 中文 */`。
- 注释解释“为什么/约束”，不复述代码；用中文，和现有代码一致。
- 不保留注释掉的代码；需要时用 git 历史。

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
- 错误对象按 `BusinessError` / `Error` 处理；不要吞掉错误后返回假数据。

## 6. ArkTS 类型与精度

- 不使用 `any`；外部 JSON 先定义 `interface`/`class`，字段逐项校验后再使用。
- 不使用结构化类型；对象形状用显式 `interface`/`class`，不要把对象字面量赋给
  不相关的类型。
- 不使用索引签名 / `obj[key]` 动态访问；键值集合用 `Map<string, T>` 或显式字段。
- 不使用 `eval`、`Function`、`arguments`、原型改写、`delete`。
- 不用 `as` 掩盖类型错误；跨边界（JSON、Native、JS 互操作）才用断言，
  并在断言前校验；禁止 `as unknown as T`。
- 可空值用 `?` / `| null` 显式表达；使用前收窄；非空断言 `!` 只在有注释的
  不变量下使用。
- **大整数精度（强制）**：ArkTS/JS 的 `number` 只有 53 位安全整数。后端
  Long / 雪花 ID / 时间戳必须以 `string` 传输；前端类型声明为 `string`，
  禁止 `Number(id)`、`parseInt(id)` 后再比较/拼接。
- 固定集合用 `enum` 或 union type；协议字段不要用裸字符串魔法值。

## 7. 状态与 UI（ArkTS）

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

JSX 同理：

```jsx
<Component
  title={item.title}
  onClick={() => handleClick(item)}
/>
```

- 不在模板/JSX 里写复杂三元表达式和多层函数；抽成变量或辅助函数。
- 不留行尾空格；闭合标签/括号与起始对齐。

## 9. 常量、单位与样式

- 魔法字符串/数字抽成 `UPPER_SNAKE_CASE` 常量；共享常量放
  `entry/src/main/ets/common/` 或 `web/src/constants.js`。
- ArkTS 长度用 `vp`，字体用 `fp`，相对布局用 `%`；禁止新代码使用 `px`。
  需要 px 转换时集中封装，不在业务代码散落 `px2vp()`。
- Web/CSS 新代码用 `rem` / `%` / `vw` 或 CSS 变量；静态布局不写死 `px`。
  存量样式逐步迁移，不为此批量重排。
- ArkTS：简单颜色/透明度可以内联；长样式链抽到 `@Styles`/`@Extend` 或样式常量，
  避免同一串修饰符复制多处。
- Web：静态样式放 CSS/class；内联 `style` 只用于动态值（颜色、transform），
  不写带单位的静态布局。

## 10. 网络与 API

- 所有 HTTP/WebSocket 走统一 client/service；组件里不直接 `fetch` /
  `new WebSocket`。
- 请求/响应有显式类型；错误、超时、空响应分别处理；不把裸 JSON 直接塞进 UI。
- 事件流/长连接按事件类型过滤（`event.type` / `method`），不要一个 handler
  吞掉所有事件；Web 侧如用 SSE，统一走封装的 `fetchEventSource` 客户端，
  禁止在组件里裸 `new EventSource`。
- 大整数 ID 按字符串处理（见第 6 节）。
- 重试要有上限和退避；不要无限重连。

## 11. 测试

- Node 测试用 `node:test` + `assert/strict`，放在 `tests/` 或包的 `test/`。
- 测试名描述行为；Arrange/Act/Assert 清晰；不依赖真实网络/设备。
- BLE/存储等外部依赖用 mock/fake；测试结束清理定时器和 socket。
- 提交前跑 `pnpm test`。

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
- 私有辅助方法、复杂分支、平台 workaround 用 `//` 说明“为什么”。
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

## 14. 修改边界与提交前检查

- vendored `packages/scratch-*` 保持上游风格；只改必要行，不整文件格式化。
- `packages/scratch-link/scratch-link-ohos`、`napi`、`src`、`test` 是本仓自有代码；
  `scratch-link-common`、`scratch-link-win`、`scratch-link-mac`、
  `scratch-link-win-msix`、`ohos-net/runtime` 保持上游/外部原样。
- 不提交生成物：`rawfile/`、`build/`、`dist/`、`oh_modules/`、`*.hap`、
  `packages/scratch-link/ohos-net/runtime/`、
  `packages/scratch-link/scratch-link-ohos/bin/`、
  `packages/scratch-link/scratch-link-ohos/obj/`、
  `packages/scratch-link/napi/*.so`。
- 不提交密钥/令牌；用 `.env` / 环境变量。
- C# 改动至少 `dotnet build packages/scratch-link/scratch-link-ohos/scratch-link-ohos.csproj`
  （本机有 .NET 9 时）；发布前以 `pnpm build:link:csharp` + CI 完整构建为准。
- C#/NAPI 的符号、参数、返回码改动必须两侧同步，并跑一次完整
  `pnpm build:link:csharp`。
- 提交前：`pnpm test` 通过、`git status` 无意外文件、注释/类型/ArkTS 限制自查。

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
