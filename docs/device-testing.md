# 真机验证

## 准备

- HarmonyOS 7 设备，开启开发者模式与 USB 调试。
- `hdc list targets` 能看到设备序列号。
- 命令行工具 26、JDK 21、.NET 9.0.104 就绪。
- 已构建 Web 编辑器、C# Link。

```sh
pnpm build
pnpm build:link:csharp
pnpm dev:ohos -- --device <serial>
```

`dev:ohos` 会签名、安装、启动，等待权限弹窗后收集日志与截图：

```text
build/verify/<serial>-tesslo-main.log
build/verify/<serial>-tesslo.jpeg
```

首次启动需要在设备上允许蓝牙、相机、麦克风、文件等权限。

## 模拟外设

模拟器镜像自动启用；真机通过启动参数启用：

```sh
pnpm dev:ohos -- --ble-sim --device <serial>
```

在编辑器中加载 micro:bit 或 WeDo 2.0 扩展，连接名称带 `[tesslo]` 的设备：

- **micro:bit**：discover → connect → getServices → 订阅 TX → 写 RX
  （显示文字）→ 收到通知。
- **WeDo 2.0**：discover → connect → getServices → 读电池 → 订阅 ATTACHED_IO
  → 写 LED/电机命令。

模拟状态只存在于 ArkTS BLE 桥进程内。强制停止应用后重新开始，需要重新扫描。

## 直接检查 C# Link

将设备端口映射到主机：

```sh
hdc -t <serial> fport tcp:20111 tcp:20111
```

用任意 WebSocket 客户端连接 `ws://127.0.0.1:20111/scratch/ble`：

```json
{"jsonrpc":"2.0","id":1,"method":"getVersion"}
```

期望：

```json
{"jsonrpc":"2.0","id":1,"result":{"protocol":"1.3"}}
```

`discover` 需要 filters，例如：

```json
{"jsonrpc":"2.0","id":2,"method":"discover","params":{"filters":[{"namePrefix":"BBC"}]}}
```

结果先返回 `result: null`，随后收到 `didDiscoverPeripheral` 通知。

路径不是 `/scratch/ble` 或 `/scratch/bt` 时服务器返回 404，这是正常行为。

## 真实外设

不带 `--ble-sim` 启动，确认外设正在广播且未与其它主机保持连接，然后在编辑器中
选择扩展并连接。通过标准：

- 能扫描到设备；
- 能建立 GATT 连接并枚举服务；
- 读写与订阅返回成功，没有协议错误；
- micro:bit 能显示文字并上报按键/倾斜；WeDo 能上报 ATTACHED_IO、读取电量并
  控制 LED/电机。

## 日志

| 文件 | 内容 |
| --- | --- |
| `/data/app/el2/100/base/io.github.yuanbaobaoo.tesslo/files/tesslo-link.log` | C# Link 监听、客户端、扫描结果 |
| `build/verify/<serial>-tesslo-main.log` | ArkWeb 启动、页面加载、WebGL 探测 |

WebGL 检查行：

```text
webgl probe {"webgl":true,"webgl2":true,...}
```

若为 `false`，记录 `const.product.model`、`const.ohos.apiversion` 和崩溃日志。

## 文件保存与打开

1. `文件 → 保存到电脑`，确认默认文件名为 `Scratch作品.sb3`。
2. 在系统文件选择器中手动点保存（系统弹窗不接受合成点击）。
3. 再用 `文件 → 从电脑中上传` 重新打开。

## 模拟器限制

- 模拟器没有 WebGL，ArkWeb 报告 `webgl=false`：界面可用，舞台不渲染。
- 模拟器没有蓝牙硬件，只能使用 `--ble-sim`。
- 系统权限与文件选择器需要真人点击。
