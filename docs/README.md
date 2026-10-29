# Tesslo 技术文档

Tesslo 把 Scratch 桌面编辑器移植到 HarmonyOS。文档按移植对象拆分：

| 文档 | 内容 |
| --- | --- |
| [架构](architecture.md) | 分层、进程、端口与启动链路 |
| [编辑器移植](editor-port.md) | Scratch 源码内嵌、构建顺序、离线素材 |
| [桌面壳移植](desktop-port.md) | Electron 主进程/渲染进程与 HarmonyOS 宿主 |
| [Scratch Link 移植](link-port.md) | C# Link、NativeAOT、NAPI、BLE 桥 |
| [构建与打包](build.md) | pnpm 脚本、HAP 结构、签名与离线构建 |
| [真机验证](device-testing.md) | 安装、日志、Link 与模拟外设验证 |

建议先读架构，再按移植对象阅读对应章节。
