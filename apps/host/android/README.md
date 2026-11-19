# host/android 原生壳（D9 v6，按需启动）

> 目标：系统 WebView 承载同一 web dist（IDE bundle），
> 回环服务以 Android 侧等价实现（loopback ServerSocket）复用 common 逻辑。

## U10 差异登记表（骨架构建后逐项补齐）

| # | 能力 | 验收口径 | 结果 |
| --- | --- | --- | --- |
| A1 | WebView 加载本地 dist | IDE 首屏（Launcher）出现 | ☐ |
| A2 | WebGL（scratch-render） | 画布出现，绿旗可跑 | ☐ |
| A3 | WebAudio / WebSocket / 多 Worker | 可用性登记 | ☐ |
| A4 | 文件下载 / picker（SAF） | .tess 落盘 + 目录选择 | ☐ |
| A5 | 回环 HTTP（127.0.0.1:2011x） | ProjectServer/AssetServer 可达 | ☐ |
| A6 | BLE（P4 后） | —（M4） | ☐ |
| A7 | 麦克风 / 摄像头（P4 后） | —（M4） | ☐ |
| A8 | 内存峰值 | 基线登记 | ☐ |

Android WebView 与 ArkWeb 的行为差异（UA / file URL 限制 / autoplay 策略）
随骨架冒烟逐条记录到本表下方。
