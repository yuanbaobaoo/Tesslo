# 架构

## 目标

在 HarmonyOS 上提供与 Scratch Desktop 一致的编辑器体验，同时遵守两个约束：

1. 所有 Scratch 源码在仓库内，构建不拉取上游仓库。
2. 宿主只产出 HarmonyOS HAP；系统能力由 ArkTS 提供，Scratch 协议由 C# 实现。

## 分层

```text
packages/scratch-gui / scratch-vm / scratch-render / ...   Scratch 编辑器源码
apps/tesslo                                               Tesslo 应用与 HAP 工程
  desktop/                                                Electron 主进程与渲染进程源码
  entry/                                                  HAP entry：Ability、窗口、Link 启动
  web_engine/                                             Electron-on-OHOS 适配层、BLE TCP 桥
packages/scratch-link                                     Scratch Link
  src/                                                    TypeScript 协议实现（桌面回退）
  dotnet/                                                 C# 协议服务器、NativeAOT、NAPI
```

`apps/tesslo` 是唯一的应用入口，`ohos` 是它唯一的打包目标。仓库不再保留其他平台的打包配置。

## 进程与数据流

```text
UIAbility (ArkTS)
  └─ XComponent 窗口
       └─ libelectron.so + libadapter.so
            ├─ Electron main (Node.js)
            │    └─ BrowserWindow ── renderer (scratch-gui)
            └─ C# Scratch Link (NativeAOT, 进程内)
                 └─ TCP 127.0.0.1:20113 ── ArkTS BleTcpBridge
                                                └─ @ohos.bluetooth.ble
```

- Electron 负责窗口、菜单、文件对话框和渲染进程；Scratch GUI 原样运行在渲染进程中。
- C# Scratch Link 由 NAPI 桥 `libtesslolink.so` 加载，直接监听 `127.0.0.1:20111`。
- 渲染进程按 Scratch Link 协议连接 `ws://127.0.0.1:20111/scratch/ble`。
- BLE/GATT 的 ArkTS API 不能从 C# 直接调用，因此 ArkTS 侧另起 TCP 服务
  `127.0.0.1:20113`，C# 作为客户端发送扫描、连接、读写、订阅命令。
- 通知方向相反：ArkTS 收到 `characteristicDidChange` 后通过同一 TCP 连接推回 C#，
  C# 再转成 Scratch Link 的 `characteristicDidChange`。

## 端口

| 端口 | 监听方 | 用途 |
| --- | --- | --- |
| 20111 | C# Link | Scratch Link WebSocket（`/scratch/ble`、`/scratch/bt`） |
| 20113 | ArkTS `BleTcpBridge` | C# 与系统蓝牙之间的内部命令通道 |

两个端口都只绑定回环地址。

## 启动顺序

1. `EntryAbility.onCreate` 启动 ArkTS BLE 桥。
   `--ps tessloBleSim true` 或模拟器镜像会打开模拟外设。
2. 同一入口通过 `libtesslolink.so` 调用 `tesslolink.start(20111)`。
3. Electron main 就绪。若 `libtesslolink.so` 存在，跳过 TypeScript Link；
   否则加载打包进应用的 `link.cjs` 作为回退。
4. 渲染进程加载 `scratch-gui`，用户从扩展库选择 micro:bit / WeDo 后开始扫描。

## 路线选择

采用 Electron-on-OHOS + 最小 ArkTS 宿主，而不是用 ArkWeb 重写桌面壳：

- 直接复用 Scratch 编辑器源码与 Electron 的进程模型，平台差异集中在 `apps/tesslo`。
- 编辑器依赖与上游 Scratch Desktop 保持一致，升级时只需同步 `packages/`。
- 系统能力（窗口、权限、蓝牙、文件选择器）留在 ArkTS 适配层，避免把平台逻辑
  写进 Scratch 业务代码。
- 代价是 HAP 需要打包 Electron 运行时，并且依赖设备的可写代码内存权限。
