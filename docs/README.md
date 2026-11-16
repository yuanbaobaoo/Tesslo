# Tesslo 技术文档

Tesslo 把 Scratch 桌面编辑器移植到 HarmonyOS。文档按移植对象拆分：

| 文档 | 内容 |
| --- | --- |
| [架构](architecture.md) | 分层、进程、端口与启动链路 |
| [编辑器移植](editor-port.md) | Scratch 源码内嵌、构建顺序、离线素材 |
| [ArkWeb 宿主](arkweb-host.md) | ArkWeb 页面、能力边界与离线素材服务 |
| [Scratch Link 移植](link-port.md) | C# Link、NativeAOT、NAPI、BLE 桥 |
| [构建与打包](build.md) | pnpm 脚本、HAP 结构、签名与离线构建 |
| [dev:ohos 首次运行体验](dev-ohos-onboarding.md) | 新机器三步跑通：自动登录、自动起模拟器（方案） |
| [权限](permissions.md) | 权限审计、内核权限结论与 API26 bin 授权变更 |
| [真机验证](device-testing.md) | 安装、日志、Link 与模拟外设验证 |

建议先读架构，再按移植对象阅读对应章节。
