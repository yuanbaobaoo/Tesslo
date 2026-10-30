# ArkWeb 宿主

Tesslo 的 HAP 不再使用 Electron。宿主是一个 UIAbility 加一个 ArkWeb 页面，编辑器
作为 Web 资源运行。

## 页面

`entry/src/main/ets/pages/Index.ets`：

```ts
Web({src: $rawfile('index.html'), controller: this.controller})
  .javaScriptAccess(true)
  .domStorageAccess(true)
  .fileAccess(true)
  .imageAccess(true)
  .mixedMode(MixedMode.All)
```

`index.html`、`main.js`、GUI 静态资源、离线素材都在
`entry/src/main/resources/rawfile`。其中 Web bundle 由 `scripts/ohos-common.mjs`
在 HAP 构建时写入，`rawfile` 本身不进入 git；离线素材的源文件在
`apps/tesslo/assets/fetched`（已入库），构建时以硬链接铺进 rawfile。

页面加载完成后执行 WebGL 探测并把结果写入 `tesslo-main.log`，便于真机验证。

## 能力边界

| 能力 | 提供方 |
| --- | --- |
| 窗口、全屏 | ArkTS `UIAbility` / `WindowStage` |
| 编辑器、VM、渲染 | ArkWeb 中的 scratch-gui |
| 文件保存/打开 | ArkWeb 下载与文件选择器 |
| 蓝牙 | ArkTS `BleTcpBridge` + `@ohos.bluetooth.ble` |
| 外设协议 | C# Scratch Link |
| 离线素材 | ArkTS HTTP 素材服务 |

下载由 `WebDownloadDelegate` 接管，当前写入应用沙箱的 `files/Download`；后续可以
接入系统 `DocumentViewPicker` 改为用户选择目录。

## 素材服务

ArkWeb 对 `resource://rawfile` 的 `fetch` 不可用，因此 `AssetServer.ets` 在
`127.0.0.1:20114` 提供只读 HTTP：

- 响应 `/static/fetched/<file>` 和 GUI 素材库使用的
  `/internalapi/asset/<md5ext>/get/`；
- 从 rawfile 读取文件，按扩展名返回 MIME；
- 带 `Access-Control-Allow-Origin: *`，供 `resource://rawfile` 页面跨源读取；
- 路径拒绝 `..`，只绑定回环地址。

Web 端 `WebStorageHelper` 使用 `http://127.0.0.1:20114` 加载默认素材。GUI 自身
的静态资源仍由 ArkWeb 从 rawfile 相对路径加载。

## 权限

`entry/src/main/module.json5` 只保留实际需要的能力：网络、蓝牙、相机、麦克风、
剪贴板、用户文件与下载/文档目录。Electron 的
`ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY` 已删除。

设备类型为 `2in1` 与 `tablet`。
