# host/ios 原生壳（D9 v6，按需启动）

> 目标：WKWebView 承载同一 web dist。iOS 侧 ArkUI-X 成熟度最低
> （架构 §18 风险），M1 只做骨架构建 + 冒烟，发版按 §14 达标矩阵（M4）。

## U10 差异登记表（骨架构建后逐项补齐）

| # | 能力 | 验收口径 | 结果 |
| --- | --- | --- | --- |
| I1 | WKWebView 加载本地 dist | IDE 首屏（Launcher）出现 | ☐ |
| I2 | WebGL（scratch-render） | 画布出现，绿旗可跑 | ☐ |
| I3 | WebAudio / WebSocket / 多 Worker | 可用性登记（ATS 例外清单） | ☐ |
| I4 | 文件下载 / picker（UIDocumentPicker） | .tess 落盘 + 目录选择 | ☐ |
| I5 | 回环 HTTP（NSAllowsLocalNetworking） | ProjectServer/AssetServer 可达 | ☐ |
| I6 | BLE（P4 后） | —（M4） | ☐ |
| I7 | 麦克风 / 摄像头（P4 后） | —（M4） | ☐ |
| I8 | 内存峰值 | 基线登记 | ☐ |

WKWebView 与 ArkWeb 的行为差异随骨架冒烟逐条记录到本表下方。
