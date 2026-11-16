# 真机验证

## 准备

- HarmonyOS 7 设备，开启开发者模式与 USB 调试。
- `hdc list targets` 能看到设备序列号。
- 命令行工具 26、JDK 21、.NET 9.0.104 就绪。
- 已构建 Web 编辑器、C# Link。

```sh
pnpm build:hap
pnpm dev:ohos -- --device <serial>
```

`dev:ohos` 会签名、安装、启动，等待权限弹窗后收集日志与截图。它部署的是 dev 身份
（包名 `io.github.yuanbaobaooo.tesslo.dev`、桌面名 `Tesslo-dev`），与设备上的正式版
共存、互不覆盖；首次运行会用 devecocli 生成 dev 调试签名，需要已登录华为账号
（`devecocli auth login`）。签名失效或新设备装不上时加 `--resign` 重签，详见
[构建与打包](build.md)的"dev 身份"与"签名"两节。

### 首次运行（零干预）

新机器 `pnpm install` 后直接 `pnpm dev:ohos` 即可：

- **未登录**：提示按回车，`devecocli auth login` 拉起浏览器完成登录（等待回调最长
  10 分钟）；
- **无设备**：自动启动第一个已停止的模拟器实例；没有实例则交互选择设备类型
  （`2in1` / `tablet`）与系统版本（缺镜像先下载，可能耗时数十分钟），创建并启动
  后轮询 `hdc list targets`（最长 180s）；
- 模拟器协议未接受时提示执行 `devecocli emulator license`（脚本不代签）；模拟器
  能力不可用（Linux、未装 DevEco Studio）时按"无设备"给出真机接入指引。

脚本化场景用参数跳过菜单（仅在无设备时生效）：

| 参数 | 作用 |
| --- | --- |
| `--emulator <name>` | 直接启动指定实例 |
| `--emulator-device-type <t>` + `--emulator-os-version "<v>"` | 非交互创建新实例（两者必须成对） |
| `--no-emulator` | 禁止自动启动/创建，无设备直接报错 |

设计与交互决策见 [dev:ohos 首次运行体验](dev-ohos-onboarding.md)。

```text
build/verify/<serial>-tesslo-main.log
build/verify/<serial>-tesslo.jpeg
```

首次录音或使用响度侦测时会申请麦克风权限；首次在编辑器中启用视频侦测
摄像头时会申请相机权限；蓝牙权限不在启动时申请，首次在编辑器中扫描或连接
蓝牙设备（micro:bit / WeDo）时才会弹出。
权限清单与回归重点见[权限](permissions.md)。

## 编辑器界面

- 左上角显示 Scratch 字标，菜单栏右上角有帮助按钮。
- 打开角色库、造型库或背景库时，缩略图应从本地素材服务加载，不访问外网。
- `文件 → 保存到电脑` 应弹出系统保存选择器，默认文件名 `Scratch作品.sb3`；
  保存后文件出现在用户选择的目录。
- 添加「视频侦测」扩展并启用摄像头时应弹出相机授权，授权后舞台显示摄像头
  画面，动作/方向值随画面变化。
- 授权麦克风后，声音库录音与舞台响度侦测应可用。
- 默认项目应显示 Scratch Cat，舞台可以运行。

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
| `/data/app/el2/100/base/io.github.yuanbaobaoo.tesslo.dev/files/tesslo-link.log` | C# Link 监听、客户端、扫描结果（dev:ohos 部署的 dev 版；正式版去掉 `.dev`） |
| `build/verify/<serial>-tesslo-main.log` | ArkWeb 启动、页面加载、WebGL 探测 |

WebGL 检查行：

```text
webgl probe {"webgl":true,"webgl2":true,...}
```

若为 `false`，记录 `const.product.model`、`const.ohos.apiversion` 和崩溃日志。

## 文件保存与打开

1. `文件 → 保存到电脑`，确认弹出系统保存选择器且默认文件名为 `Scratch作品.sb3`。
2. 选择任意用户可见目录并手动点保存（系统弹窗不接受合成点击）；保存完成后应有
   轻提示。
3. 再点一次保存，确认再次弹出选择器，不会因为同名文件静默失败。
4. 用 `文件 → 从电脑中上传` 打开刚保存的 `.sb3`。

## 模拟器限制

- 模拟器没有 WebGL，ArkWeb 报告 `webgl=false`：界面可用，舞台不渲染。
- 模拟器没有蓝牙硬件，只能使用 `--ble-sim`。
- 系统权限与文件选择器需要真人点击。
