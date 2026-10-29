# Tesslo app

Tesslo 的 Electron 应用与 HarmonyOS HAP 工程，二者在同一目录，共用一套构建入口。

```text
desktop/          Electron 应用源码
  src/main        主进程：窗口、文件、Scratch Link 启动
  src/renderer    渲染进程：挂载 scratch-gui
  src/common      共享辅助模块
  webpack.*       编译配置
entry/            HAP entry 模块（ArkTS + 原生库）
web_engine/       Electron-on-OHOS 适配层与 BLE 桥
AppScope/         HAP 应用配置
hvigor/           hvigor 配置
runtime.lock.json Electron OHOS 运行时版本
```

构建：

```sh
pnpm build:desktop
pnpm build:hap
pnpm dev:ohos -- --device <serial>
```

`desktop` 编译到 `desktop/dist`，HAP 构建再把它复制到
`web_engine/src/main/resources/resfile/resources/app`。
