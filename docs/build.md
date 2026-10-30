# 构建与打包

## 前置条件

| 工具 | 用途 |
| --- | --- |
| Node.js + pnpm 11 | workspace 与脚本 |
| HarmonyOS Command Line Tools 26 | hvigor、hdc、Native SDK |
| JDK 21 | hvigor 与 devecocli 签名 |
| .NET SDK 9.0.104 | C# Link 与 NativeAOT |
| `apps/tesslo/assets/fetched/` | 离线素材库（已入库，无需联网） |

`scripts/ohos-common.mjs` 自动探测命令行工具：`OHOS_COMMAND_LINE_TOOLS_ROOT`、
`~/command-line-tools`、`/Users/Shared/local/ohos/command-line-tools*`，最后是
PATH 上的 `hvigorw`。Java 从 `JAVA_HOME` 或 sdkman 的 JDK 21 解析。

## 命令

```sh
pnpm install                  # workspace 依赖
pnpm build                    # build:editor + build:web
pnpm build:link:csharp        # C# Link + NAPI + 运行库部署
pnpm build:hap                # 未签名 HAP
pnpm build:hap -- --signed    # 签名 HAP
pnpm test                     # TypeScript Link 协议测试
```

单独构建：

```sh
pnpm build:editor             # 全部 Scratch 编辑器包
pnpm build:web                # scratch-gui + Web 入口
pnpm build:storage            # 只重建素材加载与请求队列（debug）
```

`pnpm build:link:csharp` 需要 `DOTNET_ROOT`（默认 `~/.dotnet`）和 OHOS Native SDK
（`OHOS_SDK_ROOT`，或命令行工具自带路径）。它发布 `linux-musl-arm64` 的
NativeAOT 库，用 OHOS clang 编译 NAPI 桥，然后把产物复制到 HAP 工程的
`entry/libs/arm64-v8a/`。

修改 `packages/scratch-gui` 后必须重新执行 `pnpm build:gui`，再执行
`pnpm build:web` 和 `pnpm build:hap`；只重建 web 入口不会更新 GUI bundle。

## HAP 内容

`pnpm build:hap` 按以下顺序组装：

1. 确认 `web/dist/index.html`；缺失时先运行 `pnpm build`。
2. 确认 `libtesslolink.so` 和 `TessloLinkNative.so`。
3. 复制 `web/dist` 到 `entry/src/main/resources/rawfile`。
4. 把 `apps/tesslo/assets/fetched` 以硬链接铺到 `rawfile/static/fetched`
   （不支持硬链接的文件系统回退为复制）。
5. 运行 hvigor `assembleHap`。

输出：

```text
apps/tesslo/entry/build/default/outputs/default/
  entry-default-unsigned.hap
  entry-default-signed.hap
```

HAP 内包含：

- ArkTS 宿主与 ArkWeb 页面；
- `rawfile/index.html`、`main.js`、GUI 静态资源和离线素材；
- `libs/arm64-v8a/` 下的 `libtesslolink.so`、`TessloLinkNative.so`、
  `libc++_shared.so`。

不再包含 Electron 运行时。

## 二进制策略

- HAP、`.so`、`oh_modules`、`build/`、`rawfile` 都不进入 git。
- C# Link 的运行库由 `build:link:csharp` 生成，不提交。
- 仓库不保存二进制缓存，也不使用 Git LFS。

## 签名

`build:hap` 默认产出未签名包，供本地检查或自行签名。

`dev:ohos` 需要签名包。若 `build-profile.json5` 没有 `signingConfigs`，
脚本会调用 devecocli 生成调试签名材料：

```text
devecocli signature generate --product default
```

调用时脚本注入命令行工具路径与 JDK 环境，因此不要求安装 DevEco Studio。

签名材料位于 `~/.ohos/config/`，并与 bundleName、华为账号和设备绑定：

- 修改 `AppScope/app.json5` 的 `bundleName` 后必须重新生成。
- 删除本地 `build-profile.json5` 可强制重新生成。
- `build-profile.json5` 与 `*.local` 文件都不提交。

## 离线构建

源码与依赖都在仓库或本地包存储中：

```sh
pnpm install --offline --store-dir <local-store>
pnpm build
pnpm build:link:csharp
pnpm build:hap
```

构建过程不访问任何素材 CDN 或上游 GitHub 仓库；`apps/tesslo/assets/fetched`
的 1328 个素材已随仓库提交，checkout 后即可离线构建。
