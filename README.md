# Tesslo · 拼格工坊

> Pieces that become programs. 把想法拼成程序。

Tesslo 是一个面向 **HarmonyOS 7** 的图形化编程编辑器，兼容 **Scratch 3 项目（.sb3）** 与 **Scratch Link 硬件协议**。

它不是“鸿蒙套壳”：项目以 Scratch 官方桌面版 **scratch-desktop** 为上游，复用其编辑器、虚拟机、渲染与素材体系，只把平台相关的部分——Electron 鸿蒙运行时、文件与权限、Scratch Link 硬件桥、HAP 打包——做成薄薄的一层。

> **Tesslo 是非官方项目**，与 Scratch Foundation / MIT 无隶属或背书关系。  
> “Scratch”仅用于描述兼容性；Scratch 是 Scratch Foundation 的商标。

## 目标

- 与 Scratch Desktop（Windows / macOS）保持一致的编辑体验
- 直接打开 / 保存 `.sb3`，兼容现有作品与素材
- 支持 Scratch Link 协议，连接 micro:bit、LEGO WeDo 2.0 等硬件
- 跟随上游 `scratch-desktop` / `scratch-gui` / Scratch Link 协议更新
- 离线优先，不依赖 scratch.mit.edu 或海外 CDN

## 它是什么，不是什么

**是：**

- HarmonyOS 7 平板 / 2in1 上的 Scratch 兼容编辑器
- 以 `scratch-desktop` 为上游的 Electron 40 应用
- `.sb3` 兼容的离线创作工具
- 实现 Scratch Link 协议的硬件桥
- AGPL-3.0 的开源项目

**不是：**

- 不是 Scratch 官方产品，也不代表 Scratch Foundation
- 不是从零重写的 Blockly / VM / 渲染引擎
- 不是在线社区 / 账号 / 云变量平台
- v1 不覆盖手机（Electron 路线受 JIT ACL 限制）
- 不是“换个皮肤”的 WebView 套壳

## 技术路线

```text
HarmonyOS 7 HAP
└── Electron 40 on HarmonyOS
    ├── Main Process（scratch-desktop 壳 + 薄补丁）
    │   ├── 文件 / 对话框 / 权限 / 下载
    │   └── Scratch Link Server（ws://127.0.0.1:20111）
    ├── Renderer（scratch-gui 13.7.4-svg 预构建 bundle）
    │   └── scratch-vm / render / paint / blocks / audio
    └── ArkTS BLE/BT Bridge
        └── HarmonyOS Connectivity Kit
```

- 编辑器：`scratch-desktop` + `@scratch/scratch-gui`
- 硬件：按 Scratch Link protocol 1.3 重写（JSON-RPC 2.0 over WebSocket）
- 平台：Electron 40 鸿蒙运行时 + HAP 打包
- 维护：单仓 + 上游锁定 + 补丁序列，v1 不改 GUI 内部

## 上游基线

| 组件 | 版本 |
|---|---|
| `scratch-desktop` | 3.32.0 |
| `@scratch/scratch-gui` | 13.7.4-svg |
| Electron on HarmonyOS | 40 |
| Scratch Link protocol | 1.3 |
| HarmonyOS SDK | 26（HarmonyOS 7，`minAPIVersion=260000026`，不装 6.x） |

> Tesslo 跟的是 **Scratch Desktop 的发布线**，不是 `scratch-editor` monorepo 的最新 15.x。

## 当前状态

**源码级 monorepo 已跑通**：Scratch 编辑器源码已进仓，`pnpm build` 从仓库内源码构建 GUI 与桌面 `dist`；`apps/ohos` 最小 HAP 宿主已在真机跑通。C# 版 Link server 已完成主机协议测试和 OHOS arm64 交叉编译，下一步接 NAPI。

- [x] 源码进仓：GUI / VM / render / svg-renderer / paint / storage / audio / blocks / l10n / fonts / parser / sb1 / task-herder
- [x] pnpm workspace + 源码构建 GUI / desktop dist
- [x] Scratch Link OHOS 协议服务（9 个测试通过）
- [x] ArkTS BLE 桥（权限、扫描、连接、GATT 读写、通知）
- [x] 最小 HAP 宿主 `apps/ohos` + unsigned HAP
- [x] C# Link server：主机 `getVersion`/`discover` 通过，OHOS arm64 交叉编译通过
- [x] C# Link NAPI 桥接入 HAP；真机 20111 `getVersion`/`discover` 通过，Electron 主进程跳过 TS Link
- [x] C# → ArkTS BLE TCP 桥：真机扫描到 43–75 个 BLE 设备
- [x] GATT 桥代码：connect/getServices/read/write/start-stopNotifications
- [ ] micro:bit/WeDo 真机 GATT 回归
- [ ] BT Classic（EV3）+ 协议状态机 parity
- [ ] CI + AppGallery / AGPL / 素材合规
- [ ] Scratch Link 真机 BLE
- [ ] 文件打开/保存真机完整验证
- [x] 离线素材库（1328 资源，2679 库项可解析；作为外部资产维护）
- [x] WebGL/舞台真机可用（apps/ohos 最小宿主，HAD-W32）

### WebGL：真机已通过，模拟器不支持

`canvas.getContext('webgl')` / `getContext('webgl2')` 返回 `null`，阻塞舞台、画笔与渲染。已在 HarmonyOS 7.0（API 26）的平板与 2in1 模拟器上验证：

- Electron（ANGLE GL、SwiftShader/Vulkan 等后端）均为 `null`；ANGLE GL 能正常合成界面。
- 同一 HAP 壳内的 ArkWeb 探针同样为 `null`，说明该模拟器镜像本身没有 WebGL。
- Scratch UI 在 ANGLE GL 下完整渲染并显示“浏览器不支持 WebGL”弹窗，确认壳、资源与本地化链路正常。

下一步需要在真实 HarmonyOS 7 设备（平板 / 2in1）上复验 WebGL；模拟器无法完成这一步。

真机取证：`scripts/verify-hap.sh <hdc-target>` 会自动安装、启动并收集主进程日志与截图到 `build/verify/`，判断标准是日志中的 `webgl probe {"webgl":true...}`。

详细记录见 `docs/status.md`；真机签名、安装、WebGL/BLE/文件验证步骤见 `docs/device-testing.md`。

## 源码与版本

- 编辑器源码已进仓：`packages/scratch-gui`、`scratch-vm`、`scratch-render`、`scratch-svg-renderer`、`scratch-paint`、`scratch-storage`、`scratch-audio`、`scratch-blocks`、`scratch-l10n`、`scratch-render-fonts`、`scratch-parser`、`scratch-sb1-converter`、`task-herder`。
- 桌面壳源码在 `apps/desktop`；Scratch Link 的 C# 上游参考在 `vendor/scratch-link-csharp`。
- 每个包的来源、tag、commit 记录在 `vendor/upstream.lock.json`。**构建期不 clone、不访问上游 Git。**
- 产品版本由根 `package.json` 和 `apps/desktop` 维护；内部包保留上游版本，以保证 workspace 依赖能精确链接。
- 基线版本是 Scratch 官方桌面版 3.32.0 锁定的 `@scratch/scratch-gui@13.7.4-svg`。`-svg` 是上游发布标签的一部分，不是笔误，也不是另一条版本线。

## 仓库结构

```text
tesslo/
├── apps/
│   ├── desktop/      # scratch-desktop 源码（Electron 壳）
│   └── ohos/         # 最小 HAP 宿主（厂商 runtime sample + Tesslo web_engine）
├── packages/         # 进仓的 Scratch 源码 + link + protocol-tests
├── vendor/
│   ├── upstream.lock.json
│   ├── electron-ohos.lock.json   # .so 只记录版本/校验和/下载地址，不进 git
│   ├── scratch-link-csharp/      # C# 只读参考
│   ├── ohos-net.lock.json        # OHOS NativeAOT 工具链/runtime 锁
│   ├── ohos-net/                 # C#/NativeAOT runtime + toolchain + hello
│   └── cache/                    # 本地运行库缓存（gitignore）
├── media/            # 素材缓存（marker: media/fetched，1328 文件；gitignore）
├── docs/             # 架构、状态、真机、上游矩阵、ADR、C# 调研
└── scripts/          # Node 入口：build-hap / dev-ohos / build-link-csharp / vendor / ohos-common
```

## 快速开始

```bash
pnpm install
pnpm build          # 从仓库内源码构建 GUI + 桌面 dist
pnpm build:link:csharp  # .NET 9 + OHOS SDK，构建 C# Link + NAPI 桥并部署到 apps/ohos
pnpm build:hap     # 未签名 HAP（需要先 build:link:csharp）
pnpm test           # Scratch Link 协议测试
```

单步构建：

```bash
pnpm build:gui
pnpm build:desktop
pnpm build:link
```

HAP：

```bash
pnpm build:hap                     # 未签名 HAP -> build/ohos 输出目录
pnpm build:hap -- --signed         # 带本机签名材料
pnpm dev:ohos -- --device <serial> # 签名、装机、启动，并抓主进程日志/截图
```

`.so` 只从本地 runtime 缓存读取，不提交 git。`dev:ohos` 会调用 `hdc install` 和
`aa start`，证据写到 `build/verify/`。

## 参与

- 硬件测试：micro:bit / WeDo 2.0 / EV3
- HarmonyOS 7 平板 / 2in1 真机
- 协议一致性测试
- 上游同步与补丁维护

## License & Trademark

- 代码：**AGPL-3.0-only**
- 上游版权归 Scratch Foundation 及其贡献者
- Tesslo 是非官方项目，不使用 Scratch 名称、Logo、Scratch Cat 等商标
- “Scratch”仅用于描述兼容性，不表示隶属或背书
