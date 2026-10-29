# Scratch Link 移植

## 为什么用 C#

Scratch Link 是 Scratch 编辑器访问外设的本地 WebSocket 服务。HarmonyOS 上已有
C# NativeAOT 运行案例，因此 Tesslo 用 C# 实现协议与服务器，ArkTS 只负责系统
蓝牙 API。这样协议状态机和上游 Scratch Link 保持一致，平台差异被压缩到一层
TCP 命令桥。

## 组成

```text
packages/scratch-link
  src/                     TypeScript Link：Node 环境回退
  dotnet/Tesslo.Link       协议、WebSocket、BLE 命令客户端
  dotnet/Tesslo.Link.Native C 导出（TessloLinkStart/Stop/Version）
  dotnet/Tesslo.Link.Server 主机运行入口（开发调试）
  dotnet/napi              NAPI 桥，加载 C# 库并导出 start/stop/version
  dotnet/ohos-net          OHOS NativeAOT 运行时与工具链
```

构建产物：

```text
TessloLinkNative.so   NativeAOT 共享库（linux-musl-arm64）
libtesslolink.so      NAPI 模块，被 ArkTS import
```

两者与 `libc++_shared.so` 一起部署到
`apps/tesslo/entry/libs/arm64-v8a/`。

## 协议

- WebSocket 端点：`/scratch/ble` 与 `/scratch/bt`，默认端口 `20111`。
- 协议版本：`1.3`。
- 帧格式：标准 WebSocket 文本帧，每条消息一个 JSON-RPC 对象。
- 已实现方法：`getVersion`、`discover`、`connect`、`getServices`、`read`、
  `write`、`startNotifications`、`stopNotifications`。
- `discover` 要求至少一个 filter，支持 `name`、`namePrefix`、`services`；
  扫描结果以 `didDiscoverPeripheral` 通知逐条返回。
- 通知以 `characteristicDidChange` 返回，值使用 base64。

握手、帧编解码和 SHA-1 都在 C# 内实现。OHOS 运行时不提供 `libcrypto.so`，
因此 SHA-1 采用托管实现（`Sha1.cs`），不依赖 OpenSSL。

## 线程模型

服务器使用阻塞 socket：

- 主线程 `Accept`，每个客户端一个后台线程。
- 请求解析与响应在同一线程完成，避免异步回调在 NativeAOT 下丢失。
- `startNotifications` 单独建立一条长连接读取通知；其余命令使用短连接。

## BLE 命令桥

ArkTS 侧 `BleTcpBridge.ets` 监听 `127.0.0.1:20113`，C# 侧
`OhosBleBridge.cs` 是客户端。命令为逐行 JSON：

| op | 作用 |
| --- | --- |
| `scan` | 开始扫描，回 `scan` 事件与 `scanEnd` |
| `stopScan` | 停止扫描 |
| `connect` / `disconnect` | 建立/断开 GATT |
| `getServices` | 返回 `serviceList`（含 characteristic） |
| `read` | 读特征值 |
| `write` | 写特征值，可带响应 |
| `subscribe` / `unsubscribe` | 订阅/取消通知 |

通知由 ArkTS 主动推送：

```json
{"event":"notification","serviceId":"...","characteristicId":"...","value":"<base64>"}
```

ArkTS 负责 `@ohos.bluetooth.ble` 的权限、扫描、GATT 连接和特征操作；C# 只维护
Scratch Link 的会话状态。

## 模拟外设

没有硬件时，BLE 桥可以启动为模拟模式。`EntryAbility` 在以下任一条件成立时开启：

- 设备型号为 `emulator`；
- 启动参数带 `--ps tessloBleSim true`。

模拟器提供两台虚拟外设：

| 名称 | Service | 行为 |
| --- | --- | --- |
| `BBC micro:bit [tesslo]` | `0000f005-0000-1000-8000-00805f9b34fb` | RX 写入、TX 订阅后返回通知 |
| `LEGO WeDo 2.0 [tesslo]` | `00001523-...`、`00004f0e-...` | 电池读取、ATTACHED_IO 通知、LED 写入 |

模拟状态保存在桥进程内，因此跨多个 TCP 命令仍保持“已连接”和订阅关系，行为
与真实 GATT 一致。

## TypeScript 回退

`packages/scratch-link/src` 保留 TypeScript 实现，打包为 `link.cjs` 放进应用负载。
Electron main 在找不到 `libtesslolink.so` 时加载它，便于桌面环境调试。HarmonyOS
HAP 正常路径始终使用 C# 库。

## 边界

当前 `/scratch/bt` 与 `/scratch/ble` 共用同一处理逻辑，BT Classic 传输尚未接入；
EV3 等依赖 BT Classic 的扩展仍需要单独的 ArkTS 适配。
