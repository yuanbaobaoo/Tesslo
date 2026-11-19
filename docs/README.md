# Tesslo 技术文档

Tesslo 把 Scratch 桌面编辑器移植到 HarmonyOS。文档按移植对象拆分：

| 文档 | 内容 |
| --- | --- |
| [架构](architecture.md) | 分层、进程、端口与启动链路 |
| [IDE 架构演进](ide-architecture.md) | 双平面架构、语言/框架选型、目录规划、跨平台策略 |
| [编辑器移植](editor-port.md) | Scratch 源码内嵌、构建顺序、离线素材 |
| [ArkWeb 宿主](arkweb-host.md) | ArkWeb 页面、能力边界与离线素材服务 |
| [Scratch Link 移植](link-port.md) | C# Link、NativeAOT、NAPI、BLE 桥 |
| [构建与打包](build.md) | pnpm 脚本、HAP 结构、签名与离线构建 |
| [dev:ohos 首次运行体验](dev-ohos-onboarding.md) | 新机器三步跑通：自动登录、自动起模拟器（方案） |
| [权限](permissions.md) | 权限审计、内核权限结论与 API26 bin 授权变更 |
| [真机验证](device-testing.md) | 安装、日志、Link 与模拟外设验证 |
| [迭代路线图](roadmap.md) | 差异化定位、迭代总览与执行优先级（P1–P6） |
| [迭代方案](plans/README.md) | 6 个独立执行方案（P1–P6）：任务拆解与验收标准 |
| [引擎重写登记册](engine-rewrite.md) | 绞杀者模式（D7）：引擎删除/替换记录与前置条件 |

建议先读架构，再按移植对象阅读对应章节。
