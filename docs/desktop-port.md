# 桌面壳

Tesslo 的 Electron 壳不是上游 `scratch-desktop` 的发布配置，而是只面向
HarmonyOS 的重写版本。它只保留主进程/渲染进程和编辑器挂载逻辑。

## 应用源码

应用源码并入 HAP 工程，位于 `apps/tesslo/desktop`：

| 路径 | 内容 |
| --- | --- |
| `src/main` | 应用生命周期、窗口、文件对话框、Scratch Link 启动 |
| `src/renderer` | GUI 挂载、桌面 HOC、样式与本地化 |
| `src/common` | 主进程与渲染进程共享的存储、协议辅助 |
| `webpack.main.js` | 主进程打包为 `commonjs2` |
| `webpack.renderer.js` | 渲染进程打包，并固定 React/Redux 单例 |

产物是 `desktop/dist/main` 和 `dist/renderer`。HAP 构建把两者复制到应用
负载，并按 Electron 的 `appPath` 规则生成 `package.json`。

## HarmonyOS 工程

`apps/tesslo` 是最小 HAP 工程：

```text
AppScope/app.json5           bundleName、版本、图标、多实例配置
desktop/                     Electron 应用源码与 webpack 配置
entry/                       entry 模块
  src/main/ets/entryability  EntryAbility：启动 BLE 桥与 C# Link
  src/main/ets/pages         Electron 窗口承载页面
  src/main/resources         权限声明、字符串、窗口配置
web_engine/                  Electron-on-OHOS 平台适配
  src/main/ets/ability       UIAbility + XComponent 窗口生命周期
  src/main/ets/adapter       窗口、显示、权限、主题等适配
  src/main/ets/ble           BleTcpBridge（真实蓝牙 + 模拟外设）
  src/main/resources/resfile Electron 运行时数据与应用负载
```

`web_engine` 来自 Electron-on-OHOS 的宿主实现：ArkUI 的 `XComponent` 承载
Electron 窗口，`libelectron.so` 与 `libadapter.so` 负责浏览器与系统窗口之间的
桥接。Tesslo 只保留桌面应用需要的部分，并加入自己的 BLE 桥与 Link 启动。

## 应用负载

`pnpm build` 产出 `desktop/dist` 后，`scripts/ohos-common.mjs` 负责组装：

```text
web_engine/src/main/resources/resfile/resources/app
  main/          Electron 主进程
  renderer/      编辑器渲染进程
  static/        fetched/ 离线素材
  link.cjs       TypeScript Scratch Link 回退
  package.json
```

`EntryAbility` 把 `appPath` 传给 Electron。运行时数据（ICU、v8 snapshot 等）来自
HAP 模板中的 `resfile/`，由 Electron OHOS 运行时提供。

## 运行时二进制

Electron OHOS 运行时不进入 git：

- `apps/tesslo/runtime.lock.json` 记录版本、SHA-256、大小和需要的文件列表。
- 解压后的运行库放在 `entry/libs/arm64-v8a/` 与 `resfile/`，
  两者都在 `.gitignore` 中。
- `pnpm build:hap` 在缺少 `libelectron.so` 或 `icudtl.dat` 时直接失败并提示补齐。

## 权限

`entry/src/main/module.json5` 声明编辑器需要的能力：网络、蓝牙、相机、麦克风、
剪贴板、用户文件与下载/文档目录。HarmonyOS 的可写代码内存权限
`ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY` 用于 Electron 的 JIT；
缺少该权限时签名配置会申请受限 ACL。

设备类型限定为 `2in1` 与 `tablet`，不面向手机布局。
