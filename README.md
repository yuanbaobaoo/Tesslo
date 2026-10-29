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

**Early / PoC**。桌面链路已跑通；HAP 能在 HarmonyOS 7 上构建、签名、安装、启动并加载 Scratch 界面，模拟器没有 WebGL，舞台/画笔仍需真机验证。

- [x] 架构与上游依赖梳理
- [x] 仓库骨架 / 上游锁定 / 补丁序列（0001-0008 从干净上游重放并编译、冒烟通过）
- [x] Scratch Link OHOS 协议服务原型（fake BLE + 5 个协议测试通过）
- [x] Scratch Link 内置 HAP 主进程，设备内 `127.0.0.1:20111` 全协议链路已验证
- [x] ArkTS BLE 桥（权限、扫描、连接、GATT 读写、通知）接入 Scratch Link
- [ ] Scratch Link 真机 BLE（模拟器无蓝牙硬件，需 micro:bit/WeDo 实测）
- [x] 离线素材库（1328 个资源，2679 个库项全部可解析）
- [x] Electron 40 + `scratch-desktop` 桌面构建与冒烟（中文界面、积木区、舞台 canvas）
- [x] HarmonyOS 7 HAP 构建、签名、安装、启动（API 26 模拟器，380MB，已去除 zcode 残留与 source map）
- [x] Scratch GUI 在 HAP 内完整渲染（7.0 平板与 2in1，ANGLE GL）
- [x] 设备内 VM 项目加载/导出（loadProject + saveProjectSb3）
- [x] WebGL/舞台在真机（HAD-W32，HarmonyOS 7.0）上可用；模拟器自动切 ANGLE 显示 UI
- [ ] Scratch Link 真机 BLE
- [ ] 离线素材库
- [x] 文件保存对话框在 7.0 上拉起（系统选择器需真人确认落盘）
- [ ] 文件打开/保存真机完整验证

### WebGL：真机已通过，模拟器不支持

`canvas.getContext('webgl')` / `getContext('webgl2')` 返回 `null`，阻塞舞台、画笔与渲染。已在 HarmonyOS 7.0（API 26）的平板与 2in1 模拟器上验证：

- Electron（ANGLE GL、SwiftShader/Vulkan 等后端）均为 `null`；ANGLE GL 能正常合成界面。
- 同一 HAP 壳内的 ArkWeb 探针同样为 `null`，说明该模拟器镜像本身没有 WebGL。
- Scratch UI 在 ANGLE GL 下完整渲染并显示“浏览器不支持 WebGL”弹窗，确认壳、资源与本地化链路正常。

下一步需要在真实 HarmonyOS 7 设备（平板 / 2in1）上复验 WebGL；模拟器无法完成这一步。

真机取证：`scripts/verify-hap.sh <hdc-target>` 会自动安装、启动并收集主进程日志与截图到 `build/verify/`，判断标准是日志中的 `webgl probe {"webgl":true...}`。

详细记录见 `docs/status.md`；真机签名、安装、WebGL/BLE/文件验证步骤见 `docs/device-testing.md`。

## 仓库结构

```text
tesslo-ohos/
├── upstream/          # 上游源码（sync 脚本拉取，不提交）
├── patches/           # 平台补丁序列
├── packages/          # scratch-link-ohos / protocol-tests / shared
├── ohos/              # HAP 模板 / BLE 桥 / 签名模板
├── media/             # 素材镜像清单与抓取脚本
├── tests/             # .sb3 金标准 / e2e
├── docs/              # 架构、上游矩阵、ADR
└── ci/                # sync / build / test / release
```

## 快速开始

```bash
make sync      # 按 upstream.lock.json 拉取上游
make patch     # 应用 patches/series
make build     # 构建 desktop
make test      # Scratch Link 协议测试
```

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
