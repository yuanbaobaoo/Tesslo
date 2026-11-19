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

`web` 构建到 `web/dist`，HAP 构建再把它和 `assets/fetched` 一起放进
`entry/src/main/resources/rawfile`（素材用硬链接，不产生第二份数据），
由 ArkWeb 以 `$rawfile('index.html')` 加载。

# harmony 壳对等清单（回归参照）

> D9 v6：harmony 壳 = `apps/host/ohos/entry`（永久主线，**不再迁移**）。
> 本清单保留作回归参照——Android/iOS 壳实现时对照本清单确认桥协议
> 各项在目标平台的等价物。

## 迁移项

| # | 来源（entry/src/main/ets/） | 目标 | 对等验收 | 状态 |
| --- | --- | --- | --- | --- |
| H1 | common/Ports.ets | common/（平台无关） | 端口表一致（20111/20113/20114/20117） | ☐ |
| H2 | common/MiniHttp.ets | common/ | 信封格式 / 成对启停 / 仅回环 | ☐ |
| H3 | common/AppLog.ets、FileName.ts | common/ | 日志与文件名清洗行为一致 | ☐ |
| H4 | common/DownloadSaver.ets、ExternalLink.ets、WebPermissionHandler.ets、AudioRecovery.ets | harmony/（ArkWeb 专属） | 下载 / 外链 / 权限 / 音频恢复冒烟 | ☐ |
| H5 | assets/AssetServer.ets | 改走 MiniHttp（或保留专用二进制路径） | 素材加载全绿 | ☐ |
| H6 | works/ProjectServer.ets | common/（逻辑）+ harmony/（picker/fileShare 注入） | P1 验收全过 | ☐ |
| H7 | ble/BleTcpBridge.ets | harmony/ | micro:bit 扫描/连接/收发 | ☐ |
| H8 | pages/Index.ets、entryability/EntryAbility.ets | harmony/ | 冷启动 / 服务成对启停 / 全屏布局 | ☐ |
| H9 | module.json5、resources、libs（libtesslolink.so） | harmony/ | 权限清单 / rawfile / NAPI 加载 | ☐ |

## 构建链适配（U11）

- [ ] `scripts/build-hap.ts` 的工程根 / rawfile 拷贝路径指向 host/harmony；
- [ ] hvigor 工程描述（build-profile / hvigorfile）在 ArkUI-X 工程内重建；
- [ ] 签名链（release-keygen / signing-encrypt）不变，仅路径适配；
- [ ] 迁移完成后 `apps/host/ohos/entry` 归档删除，`build:hap` 单一出口指向 host。

