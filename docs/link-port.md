# Scratch Link 移植

## 为什么用 C#

Scratch Link 是 Scratch 编辑器访问外设的本地 WebSocket 服务。HarmonyOS 上已有
C# NativeAOT 运行案例，因此 Tesslo 用 C# 实现协议与服务器，ArkTS 只负责系统
蓝牙 API。这样协议状态机和上游 Scratch Link 保持一致，平台差异被压缩到一层
TCP 命令桥。

## 组成

`packages/scratch-link` 通过 subtree merge 完整引入上游仓库
（scratchfoundation/scratch-link），平台实现与上游目录平级：

```text
packages/scratch-link
  scratch-link-common/   上游共享层：Session/JSON-RPC/Fleck WebSocket（零改动，
                         以共享源码方式编译进 scratch-link-ohos）
  scratch-link-win/      上游 Windows 实现（保留不构建，供对照）
  scratch-link-mac/      上游 macOS 实现（保留不构建，供对照）
  scratch-link-ohos/     OHOS 平台实现：SessionManager/GattHelpers/BLE 会话与
                         endpoint、NAPI 宿主导出（TessloLinkStart/Stop/Version）
  napi/                  NAPI 桥，加载 ScratchLinkOhos.so 并导出 start/stop/version
  ohos-net/              OHOS NativeAOT 运行时与工具链
  src/                   Node 版协议服务器：一致性测试与主机调试
```

构建产物：

```text
ScratchLinkOhos.so    NativeAOT 共享库（linux-musl-arm64，含上游 common）
libtesslolink.so      NAPI 模块，被 ArkTS import
```

两者与 `libc++_shared.so` 一起部署到
`apps/tesslo/entry/libs/arm64-v8a/`。

同步上游：`git fetch scratch-link && git merge -Xsubtree=packages/scratch-link scratch-link/main`。

## 协议

协议层全部来自上游 `scratch-link-common`（Session/SessionManager/JsonRpc/
WebSocketListener/Fleck），OHOS 侧只实现平台接缝。协议版本随上游
（`getVersion` 由上游 Session 返回）。

- WebSocket 端点：`/scratch/ble`（`/scratch/bt` 暂落到基础 Session，见边界）。
- 端口 `20111`（上游 ScratchLinkApp 固定）。
- 过滤、GATT 黑名单、编码语义、错误码均由上游实现，随上游演进。

## 线程模型

- Fleck 负责监听与每连接 IO；上游 Session 以 async/await 处理请求。
- OHOS 侧 `OhosBleClient` 全异步：命令走短 TCP 连接，订阅走常驻连接 +
  后台读循环；会话内用信号量串行化对桥的访问。

## BLE 命令桥

ArkTS 侧 `BleTcpBridge.ets` 监听 `127.0.0.1:20113`，C# 侧
`scratch-link-ohos/BLE/OhosBleClient.cs` 是客户端。命令为逐行 JSON：

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

## TypeScript 实现

`packages/scratch-link/src` 保留 Node 版协议服务器，用于一致性测试
（`tests/conformance.test.js`）和主机调试；HarmonyOS HAP 只使用 C# 库。

## 边界

- BT Classic（`/scratch/bt`）尚未接入：连接会落到上游基础 Session，
  任何方法都返回"method not found"；EV3 等依赖 BT Classic 的扩展需要
  单独的 ArkTS 适配后再开放。
- 上游 `ScratchLinkApp` 硬编码监听 `0.0.0.0:20111`；如需限定回环地址或
  可配置端口，需要对上游提 patch。
- NativeAOT 依赖反射根（`rd.xml`，DI 构造与 System.Text.Json 反射路径），
  当前 `Dynamic="Required All"` 保正确性，库体积 ~36MB，待真机验证后
  可换精确清单收窄。
