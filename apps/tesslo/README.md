# Tesslo app

Tesslo 是纯 ArkWeb 的 HarmonyOS 应用：Scratch 编辑器作为 Web 资源运行在 ArkWeb 中，
不再包含 Electron 运行时。

```text
web/              Scratch 编辑器的 Web 构建
  src/index.jsx   挂载 scratch-gui，注入离线素材加载器
  webpack.config.js
entry/            HAP entry 模块（ArkTS）
  src/main/ets/pages/Index.ets        ArkWeb 页面
  src/main/ets/entryability          EntryAbility：启动 Link、BLE、素材服务
  src/main/ets/ble                   BLE TCP 桥
  src/main/ets/assets                本地素材 HTTP 服务
  libs/arm64-v8a                     C# Link 的 NAPI 库
AppScope/         HAP 应用配置
```

构建：

```sh
pnpm build:web
pnpm build:hap
pnpm dev:ohos -- --device <serial>
```

`web` 构建到 `web/dist`，HAP 构建再把它和 `media/fetched` 一起放进
`entry/src/main/resources/rawfile`，由 ArkWeb 以 `$rawfile('index.html')` 加载。
