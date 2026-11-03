# 权限

应用权限的审计结论、内核权限调研与 AGC 对齐要求。`module.json5` 是唯一
声明入口：`apps/tesslo/entry/src/main/module.json5`。

## 现状

只声明四个权限，每一个都有实际代码路径：

| 权限 | 授权方式 | 用途 | 代码路径 |
| --- | --- | --- | --- |
| `ohos.permission.INTERNET` | system_grant | 回环 TCP 服务（素材服务 20114、BLE 桥 20113）与在线图片 | `AssetServer.ets`、`BleTcpBridge.ets`、`Index.ets` 的 `onlineImageAccess` |
| `ohos.permission.ACCESS_BLUETOOTH` | user_grant | BLE 外设扫描与 GATT 连接 | `BleTcpBridge.ets` 运行时 `requestPermissionsFromUser`，结果缓存 |
| `ohos.permission.MICROPHONE` | user_grant | 录音与响度侦测 | Web 侧 scratch-gui `audio-recorder` / `Loudness` 的 `getUserMedia({audio})`，由 `WebPermissionHandler.ets` 在 `onPermissionRequest` 中申请并放行 |
| `ohos.permission.CAMERA` | user_grant | 视频侦测 | Web 侧 `video-provider` / `camera.js` 的 `getUserMedia({audio: false, video})`，由 `WebPermissionHandler.ets` 申请并放行 |

> 文件保存/打开走系统 Picker，Picker 返回的 URI 自带临时读写授权，不需要
> `READ_WRITE_USER_FILE` / `READ_WRITE_DOWNLOAD_DIRECTORY` /
> `READ_WRITE_DOCUMENTS_DIRECTORY`。下载先写应用 cache，再复制到 Picker 返回的
> 用户 URI；这些权限只在应用直接访问公共目录（如 3D 目录预授权）时才需要。

## 2026-11 权限审计

背景：现有权限列表是 `6e9ea93` 从 Electron 工程整体搬来的，从未按 ArkWeb
架构复核（理由文案甚至还写着 "zsh environment"）。逐项排查代码后移除
6 个无使用证据的权限：

| 移除的权限 | 排查结论 |
| --- | --- |
| `GET_NETWORK_INFO` | 无 `@ohos.net.connection` 引用，无网络状态查询；联网只需 INTERNET |
| `READ_PASTEBOARD` | ArkTS 无 `pasteboard` API；GUI 复制/粘贴全走内部 redux 剪贴板（`copy-paste-hoc`），无 `navigator.clipboard` |
| `READ_WRITE_USER_FILE` | 旧实现无用户文件 API；新下载链路通过 Picker 临时授权访问用户文件，仍不需要该权限 |
| `READ_WRITE_DOCUMENTS_DIRECTORY` | 同上 |
| `READ_WRITE_DOWNLOAD_DIRECTORY` | 旧实现下载写应用沙箱 `files/Download`；新链路走 Picker 临时授权，仍不需要目录权限 |
| `FILE_ACCESS_PERSIST` | 无持久化 URI 授权，没有可持久化的对象 |

相机在复核后保留：`facingMode` 出现 0 次不代表没有摄像头采集。GUI 的
`video-provider` 使用 `getUserMedia({audio: false, video: {width, height}})`，
视频侦测扩展仍会调用；移除 `CAMERA` 会让该扩展静默失败。

同时清理了三份 `string.json` 中失去引用的理由文案（含早已无权限引用的
`desktop_dir`）；视频侦测需要的 `camera_reason` 保留。

真机回归重点：录音/响度、视频侦测（相机授权与画面）、图片粘贴进画板。若粘贴
行为受影响，单独加回 `READ_PASTEBOARD` 即可。

## Web 音视频授权

ArkWeb 不会因为应用声明了权限就自动放行 `getUserMedia`：页面权限请求通过 Web
组件的 `onPermissionRequest` 上报，应用必须完成应用侧授权。

- `TYPE_AUDIO_CAPTURE` → `ohos.permission.MICROPHONE`
- `TYPE_VIDEO_CAPTURE` → `ohos.permission.CAMERA`
- `TYPE_SENSOR` / `TYPE_MIDI_SYSEX` 等未使用资源直接 `deny()`

实现见 `apps/tesslo/entry/src/main/ets/common/WebPermissionHandler.ets`，由
`Index.ets` 的 `onPermissionRequest` 调用；系统权限全部授予后才 `grant`，
用户拒绝或处理异常时 `deny`。

## 内核权限 ALLOW_WRITABLE_CODE_MEMORY

历史：Electron 宿主（自带 Chromium，V8 JIT 需要应用进程内的可写代码内存）
时期申请并声明于 `requestPermissions` 与 `definePermissions` 双处，
`1f05355` 迁移 ArkWeb 时随 Electron 一起删除。

当前架构不需要该权限：

- ArkWeb 的 JS/WASM JIT 运行在系统 Web 引擎进程，不占用应用进程的 W^X 内存；
- `ScratchLinkOhos.so` 是 NativeAOT 纯 AOT 产物，无运行时代码生成；
- 全仓库无 `PROT_EXEC` / `mprotect` / `MAP_JIT` 用法。

AGC 侧的权限申请仍挂着，需要撤回或回复华为说明已完成 ArkWeb 迁移、应用
进程不再需要 W^X 内存，保持申请记录与 `module.json5` 一致。

华为邮件（2026-11）给出的约束，将来若重新申请必须全部满足：

- 敏感权限，不得用于热补丁等危害系统的行为，违者可能下架；
- 仅 PC/2in1 应用可申请（设备形态定义见
  [AGC FAQ](https://developer.huawei.com/consumer/cn/doc/app/agc-help-device-faq-0000002363662585)），
  本应用 `deviceTypes` 含 `tablet`，tablet 上天然不可用；
- 需适配坚盾模式：权限不可用的场景下不得闪退，须走非 W^X 降级路径
  （与 tablet 共用同一降级逻辑）。

## API26：bin 不再自动继承 kernelpermission

[不兼容变更](https://developer.huawei.com/consumer/cn/doc/harmonyos-releases/changelogs-for-all-apps-7001#ch2026031760265)
（7.0 / API26 起，应用升级到 API26 后生效，本项目 `compatibleSdkVersion`
已是 26）：应用进程执行 bin 时，bin 不再自动继承应用的 kernelpermission，
需为 bin 主动声明权限并签名。

对本项目的影响：**无**。scratch-link 是共享库（`ScratchLinkOhos.so`），经
NAPI（`libtesslolink.so`）加载进应用自身进程，不是独立 bin 进程；项目
也没有 HNP 包。

将来引入独立 bin 或 HNP 包时（例如把 Link 拆成 HNP 常驻服务）：

1. 新建权限策略 JSON：`requestPermissions` 数组列出 bin 需要的全部权限
   （kernel 权限与普通权限都要），或直接声明
   `ohos.permission.INHERIT_PARENT_PERMISSION` 继承父进程可继承权限；
2. HNP 包：HNP 配置 `"independentSign": true`（API 23 起），用
   `llvm-objcopy --add-section .permission=<策略.json> <bin> <bin_out>`
   给 bin 加权限段后重新打包；llvm-objcopy 在 OHOS Native SDK 内，
   见 `packages/scratch-link/ohos-net/BUILD.md`；
3. 非 HNP 的独立 bin：用
   [binary-sign-tool](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/binary-sign-tool)
   签名，`-moduleFile` 指向权限策略 JSON。

## 维护规则

- 新增权限必须给出实际代码路径或明确的待接线功能，避免"声明了没人用"；
  敏感权限申请了不使用同样是审核风险；
- AGC 后台申请列表与 `module.json5` 保持一致：申请了不声明、声明了没批，
  都会卡上架审核；
- user_grant 权限必须配 `reason` 文案，`base` / `zh_CN` / `en_US` 三份
  `string.json` 同步维护，移除权限时同步清理失去引用的文案。
