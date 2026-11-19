# apps/host —— 三原生壳规划（D9 v6）

> 决策（2026-11-18）：**放弃 ArkUI-X**，宿主层改为三原生壳。
> 原因与选型对比（Capacitor/CPF-Ionic、RNOH 尽调）见
> [IDE 架构](../../docs/ide-architecture.md) §17 D9 决策记录。

## 为什么是三原生壳

Tesslo 的应用主体在 Web 平面（React 编辑器，跑在 WebView），
原生层只是"WebView 容器 + 回环桥"，每壳约千行：

- 宿主层小 → 框架统一的收益 < 引入第三方壳框架的风险
  （ArkUI-X 版本跟随节奏慢、仓库迁移 GitCode；CPF-Ionic 靠社区组织；
  RNOH 叠 React 运行时）；
- 桥协议已冻结（信封格式 + 端口表 + MiniHttp 语义），
  三壳按同一规格各自原生实现，互不依赖；
- harmony 壳（ArkTS+ArkWeb）已随 v1.0 发版并被 P1 全链验证——
  它就是永久主线，**无需任何迁移**。

## 目录职责

```text
apps/host/
├─ ohos/      # HarmonyOS 壳（原 apps/tesslo 整体迁入）：ArkTS+ArkWeb HAP 工程
│             # + web/（双 webpack 入口装配层）；entry/ = 永久发布主线；
│             # README 附 H1–H9 回归对等清单
├─ common/    # 桥协议规格对照文档（三壳实现的共同规格；无共享代码）
├─ android/   # Android 壳（Kotlin + WebView + ServerSocket 回环）
└─ ios/       # iOS 壳（Swift + WKWebView + NWListener 回环）
```

## Android / iOS 壳启动清单（M4 前，按需）

1. 按 `common/` 规格实现：回环 HTTP 服务（信封 + 端口表 + `..` 拦截 +
   CORS 预检 204）、ProjectServer 文件 IO（原子写/快照/savedOnce 缺失态）、
   picker、下载、WebView 容器（加载同一 web dist）；
2. 首个冒烟时逐项登记 README 中的 U10 差异表；
3. 达标矩阵（架构 §14）全绿后发版。

## 后置备选（仅在原生壳路线遇阻时重启评估）

- Capacitor + CPF-Ionic（鸿蒙社区适配，ArkWeb 承载）
- React Native for OpenHarmony（RNOH，华为官方，跟进 RN 0.77）

重启任一备选前必须重新尽调其维护活跃度——与本次放弃 ArkUI-X 同标准。
