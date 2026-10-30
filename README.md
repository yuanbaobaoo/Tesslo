<p align="center">
  <img src="docs/images/tesslo-logo.png" alt="Tesslo" width="380">
</p>

<h3 align="center">Scratch 兼容的积木式编程编辑器 · 运行在 HarmonyOS 上</h3>

**Tesslo**（/ˈtes.loʊ/）是一个非官方的、与 Scratch 兼容的积木式编程编辑器，
为 HarmonyOS 平台重新移植与打包：Scratch 编辑器以 Web 应用运行在系统 ArkWeb 中，
平台能力（窗口、文件、蓝牙、素材服务）由 ArkTS 提供，最终产物是一个 HAP。
编辑体验与 Scratch Desktop 保持一致，并内置设备端 Scratch Link，可直连
micro:bit、LEGO WeDo 2.0 等蓝牙外设。

名称一句话由来：Tesslo 的词干取自拉丁语 *tessera*（镶嵌工艺中的方形小拼块），
取“小拼块拼合成完整作品”之意；词尾 *-lo* 为品牌构词后缀，不承载独立语义。

## 特性

- **Scratch 兼容编辑器**：`scratch-gui`、`scratch-vm`、`scratch-blocks` 等
  完整源码内嵌于仓库，编辑器行为与 Scratch 一致，支持角色、造型、声音与扩展。
- **纯 ArkWeb 宿主**：不包含 Electron 运行时，Web 内容运行在系统 ArkWeb 中，
  包体与启动链路更小。
- **离线素材库**：角色/造型/背景/声音库由设备端 HTTP 服务提供，无外网依赖。
- **设备端 Scratch Link**：C# Scratch Link 以 NativeAOT 运行于 HAP 内，
  配合 ArkTS 蓝牙桥连接 micro:bit、WeDo 2.0 等外设；蓝牙权限仅在真正
  扫描/连接时向用户申请。
- **完整可复现构建**：从编辑器源码到签名 HAP 全流程脚本化。

## 环境要求

| 项目 | 版本 / 要求 | 用途 |
| --- | --- | --- |
| 目标系统 | HarmonyOS 7（API 26，`compatibleSdkVersion 26.0.0`） | HAP 运行环境 |
| 构建主机 | macOS 14+（Apple Silicon 实测）或 Linux x64 | Windows 未验证 |
| Node.js | ≥ 20（CI 使用 22） | workspace 与构建脚本 |
| pnpm | 11.21.0 | 包管理与脚本入口 |
| HarmonyOS Command Line Tools | 26.0.0.851 | hvigor、hdc、Native SDK |
| JDK | 21 | hvigor、devecocli 签名 |
| .NET SDK | 9.0.104 | C# Scratch Link / NativeAOT |
| ohos-net runtime pack | [Release `tools`](https://github.com/yuanbaobaoo/Tesslo/releases/tag/tools) | NativeAOT 目标运行库 |
| 设备调试 | HarmonyOS 设备 + hdc | `pnpm dev:ohos` 安装与启动 |

不需要安装 DevEco Studio：构建脚本直接调用 command-line-tools。CI 从
GitHub Release `tools` 下载 Linux 分卷；本地使用本机安装的 CLT 26。
ohos-net runtime pack 由本地/CI 共用，也从 `tools` 下载并校验 SHA-256。

## 仓库结构

```text
packages/
├── scratch-gui/ scratch-vm/ scratch-blocks/ scratch-render/ ...
└── scratch-link/              Scratch Link（common + OHOS 平台实现 + ohos-net 工具链）
apps/tesslo/
├── assets/fetched/            离线素材（1328 个文件，已入库）
├── web/                       Scratch 编辑器 Web 入口与 webpack 打包
├── entry/                     HAP entry 模块（ArkTS：ArkWeb、BLE 桥、素材服务）
└── AppScope/                  HAP 应用配置
scripts/                       构建、HAP、C# Link、设备脚本
tests/                         Link 协议一致性测试
docs/                          架构、移植、构建与真机验证文档
.github/workflows/             Test 与 OHOS HAP CI
```

构建产物与外部依赖不提交：

- `apps/tesslo/entry/src/main/resources/rawfile/`：由 `pnpm build:hap` 生成，
  包含 Web bundle 和硬链接进来的离线素材；
- `packages/scratch-link/ohos-net/runtime/`：NativeAOT runtime pack，从
  Release `tools` 下载；
- `apps/tesslo/entry/libs/`、`*.hap`、`node_modules/`、`oh_modules/` 等。

## 快速开始

前置条件见上方「环境要求」。离线素材已随仓库提交；本地构建需要先安装
CLT 26 与 .NET SDK 9.0.104，并把 `tools` Release 里的 runtime pack 解压到
`packages/scratch-link/ohos-net/runtime/`。

```sh
pnpm install               # workspace 依赖
pnpm build                 # 构建编辑器与 Web 产物
pnpm build:link:csharp     # C# Link + NAPI 运行库
pnpm build:hap             # 组装 HAP（--signed 输出签名包）
pnpm dev:ohos -- --device <serial>   # 安装到设备并启动
```

修改 `packages/scratch-gui` 源码后需重新执行 `pnpm build:gui`，再
`pnpm build:web` 与 `pnpm build:hap`。

## 文档

| 文档 | 内容 |
| --- | --- |
| [架构](docs/architecture.md) | 分层、进程、端口与启动链路 |
| [编辑器移植](docs/editor-port.md) | Scratch 源码内嵌、构建顺序、离线素材 |
| [ArkWeb 宿主](docs/arkweb-host.md) | ArkWeb 页面、能力边界与离线素材服务 |
| [Scratch Link 移植](docs/link-port.md) | C# Link、NativeAOT、NAPI、BLE 桥 |
| [构建与打包](docs/build.md) | pnpm 脚本、HAP 结构、签名与离线构建 |
| [真机验证](docs/device-testing.md) | 安装、日志、Link 与模拟外设验证 |

## 许可

Tesslo 基于 Scratch（[scratch-gui](https://github.com/scratchfoundation/scratch-gui)
等）衍生，以 **AGPL-3.0-only** 协议开源。

- 仓库：<https://github.com/yuanbaobaoo/Tesslo>
- Powered by Scratch

Tesslo 是社区项目，与 Scratch Foundation 及 HarmonyOS 官方无隶属关系；
Scratch 是 Scratch Foundation 的商标。
