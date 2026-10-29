# 构建与打包

## 前置条件

| 工具 | 用途 |
| --- | --- |
| Node.js + pnpm 11 | workspace 与脚本 |
| HarmonyOS Command Line Tools 26 | hvigor、hdc、Native SDK |
| JDK 21 | hvigor 与 devecocli 签名 |
| .NET SDK 9.0.104 | C# Link 与 NativeAOT |
| Electron OHOS 运行时 | HAP 内的 `libelectron.so` 等 |
| `media/fetched/` | 离线素材库 |

`scripts/ohos-common.mjs` 自动探测命令行工具：`OHOS_COMMAND_LINE_TOOLS_ROOT`、
`~/command-line-tools`、`/Users/Shared/local/ohos/command-line-tools*`，最后是
PATH 上的 `hvigorw`。Java 从 `JAVA_HOME` 或 sdkman 的 JDK 21 解析。

## 命令

```sh
pnpm install                  # workspace 依赖
pnpm build                    # build:editor + build:desktop
pnpm build:link:csharp        # C# Link + NAPI + 运行库部署
pnpm build:hap                # 未签名 HAP
pnpm build:hap -- --signed    # 签名 HAP
pnpm test                     # TypeScript Link 协议测试
```

单独构建：

```sh
pnpm build:editor             # 全部 Scratch 编辑器包
pnpm build:desktop            # Electron main/renderer
pnpm build:storage            # 只重建素材加载与请求队列（debug）
```

`pnpm build:link:csharp` 需要 `DOTNET_ROOT`（默认 `~/.dotnet`）和 OHOS Native SDK
（`OHOS_SDK_ROOT`，或命令行工具自带路径）。它发布 `linux-musl-arm64` 的
NativeAOT 库，用 OHOS clang 编译 NAPI 桥，然后把产物复制到 HAP 工程的
`entry/libs/arm64-v8a/`。

## HAP 内容

`pnpm build:hap` 按以下顺序组装：

1. 确认 `dist/main`、`dist/renderer`；缺失时先运行 `pnpm build`。
2. 确认 Electron 运行库与 `libtesslolink.so`；缺失时给出补齐提示并失败。
3. 复制应用负载到 `web_engine/src/main/resources/resfile/resources/app`。
4. 复制 `media/fetched` 到负载的 `static/fetched`。
5. 运行 hvigor `assembleHap`。

输出：

```text
apps/tesslo/entry/build/default/outputs/default/
  entry-default-unsigned.hap
  entry-default-signed.hap
```

HAP 内包含：

- ArkTS 宿主与 Electron OHOS 运行库；
- `resources/app` 应用负载；
- `libs/arm64-v8a/` 下的 `libtesslolink.so`、`TessloLinkNative.so`、
  `libc++_shared.so`。

## 二进制策略

- Electron 运行库、HAP、`.so`、`oh_modules`、`build/` 都不进入 git。
- `runtime.lock.json` 记录运行时版本、SHA-256、大小和必需文件。
- 运行库从固定的发布资产解压到 `entry/libs/arm64-v8a/` 与 `resfile/`。
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

构建过程不访问上游 GitHub 仓库。唯一需要预先准备的是 Electron OHOS 运行库与
`media/fetched` 素材。
