# Tesslo

Tesslo 是运行在 HarmonyOS 上的 Scratch 桌面编辑器，编辑体验与 Scratch Desktop 保持一致。

仓库包含从编辑器到外设连接的完整源码：

- Scratch 编辑器：`scratch-gui`、`scratch-vm`、`scratch-render` 等；
- Tesslo 应用：`apps/tesslo`（ArkWeb + HarmonyOS HAP）；
- 外设连接：C# Scratch Link 与 ArkTS 蓝牙桥。

构建入口为 `pnpm build:hap`，架构、移植方法和打包流程见 [docs](docs/README.md)。
