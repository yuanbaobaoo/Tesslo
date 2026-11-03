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
| 文件保存/打开 | 系统保存/选择器 + ArkWeb 下载委托 |
| 蓝牙 | ArkTS `BleTcpBridge` + `@ohos.bluetooth.ble` |
| 外设协议 | C# Scratch Link |
| 离线素材 | ArkTS HTTP 素材服务 |

下载由 `WebDownloadDelegate` 接管：先写到应用 `cache` 临时目录，再通过
`DocumentViewPicker.save()` 让用户选择保存位置并复制过去。加载仍走 ArkWeb 默认
文件选择器。Picker 返回的 URI 自带临时读写授权，不需要文件读写权限。

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

`entry/src/main/module.json5` 只保留有实际代码路径的能力：网络（回环素材
服务与 BLE 桥）、蓝牙（外设连接）、麦克风（录音与响度侦测）、相机（视频
侦测）。剪贴板读取与公共目录直读没有对应实现，已随权限审计移除；下载改走
Picker 临时授权，不需要目录权限。Electron 时代的
`ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY` 也已删除。页面音视频
请求由 `WebPermissionHandler` 在 `onPermissionRequest` 中申请系统权限后再
放行。

审计明细、内核权限结论与 API26 bin 授权变更的影响见[权限](permissions.md)。

设备类型为 `2in1` 与 `tablet`。
