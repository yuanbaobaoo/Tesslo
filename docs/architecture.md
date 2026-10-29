# 架构

## 目标

在 HarmonyOS 上运行 Scratch 编辑器，所有源码在仓库内，产物只有 HAP。宿主不包含
Electron；编辑器作为 Web 应用运行在系统 ArkWeb 中，平台能力由 ArkTS 提供。

## 分层

```text
packages/scratch-gui / scratch-vm / scratch-render / ...   Scratch 编辑器源码
apps/tesslo
  web/                                                     编辑器 Web 入口与打包
  entry/                                                   HAP entry 模块
    src/main/ets/pages/Index.ets                           ArkWeb 页面
    src/main/ets/entryability                              EntryAbility
    src/main/ets/ble                                       BLE TCP 桥
    src/main/ets/assets                                    离线素材 HTTP 服务
  AppScope/                                                HAP 应用配置
packages/scratch-link                                      C# Scratch Link（NAPI）
```

## 运行链路

```text
UIAbility (ArkTS)
  ├─ ArkWeb Web 组件 ── rawfile/index.html + main.js
  │     └─ scratch-gui + scratch-vm + scratch-render
  ├─ C# Scratch Link (NativeAOT) ── WebSocket 127.0.0.1:20111
  ├─ BLE TCP 桥 ── 127.0.0.1:20113 ── @ohos.bluetooth.ble
  └─ 素材服务 ── 127.0.0.1:20114 ── rawfile/static/fetched
```

- 编辑器通过 `ws://127.0.0.1:20111/scratch/ble` 连接 C# Scratch Link。
- Link 通过 20113 把扫描与 GATT 命令交给 ArkTS；ArkTS 负责系统蓝牙 API。
- 默认素材库不入 JS bundle。Web 端 `WebStorageHelper` 从 20114 读取
  `rawfile/static/fetched`，避免依赖 `resource://` 的 fetch 行为。
- 角色/造型/背景库的缩略图使用同一个 20114 服务；`/internalapi/asset/` 请求
  映射到 `rawfile/static/fetched`，因此离线时也能显示。

## 端口

| 端口 | 监听方 | 用途 |
| --- | --- | --- |
| 20111 | C# Link | Scratch Link WebSocket |
| 20113 | ArkTS BLE 桥 | C# 与系统蓝牙之间的命令通道 |
| 20114 | ArkTS 素材服务 | 离线素材 HTTP |

三个端口都只绑定回环地址。

## 启动顺序

1. `EntryAbility.onCreate` 启动 BLE 桥、素材服务和 C# Link。
2. `onWindowStageCreate` 加载 `pages/Index`，页面用 `$rawfile('index.html')` 打开编辑器。
3. Web 端创建 GUI、加载默认项目；素材从 20114 拉取。
4. 用户在编辑器中加载扩展时，Web 端连接 20111，Link 再通过 20113 操作蓝牙。

## 路线选择

使用 ArkWeb 而不是 Electron：

- HAP 不再包含 `libelectron.so`、GPU/ffmpeg 运行库和 Electron 可执行文件。
- 不再需要可写代码内存权限，包体和启动链路都更小。
- Scratch 编辑器本身是 Web 应用，ArkWeb 的进程模型足够承载。
- 代价是文件保存/打开依赖 ArkWeb 的下载与文件选择器，窗口和多窗口能力由
  ArkTS/系统提供，不再沿用 Electron 的 API。
