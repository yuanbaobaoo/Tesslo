# 构建与打包

## 全新机器链路

```sh
git clone <repo> && cd tesslo
pnpm install      # 装依赖 + 环境检测；缺失的 CLT/.NET/runtime pack 会询问是否下载（y/N）
pnpm build        # 全链构建：编辑器 → web → C# Link → 未签名 HAP + App 包
pnpm build:signed # 同上，但产出签名包（需要 JDK 与华为账号调试签名，见"签名"）
```

前置硬依赖只有两个：**Node ≥ 20 + pnpm**、**JDK 17+**（与 Node 同级，只探测、绝不自动下载；
hvigor 的打包 `app_packing_tool.jar` 与签名 `hap-sign-tool.jar` 都是 Java 实现）。JDK 缺失时
`pnpm env:status` 会给出指引，建议 Temurin：<https://adoptium.net/>。

支持的平台：**mac（Apple silicon）/ linux-x64**。Intel mac 与 Windows 不支持自动安装
（不提供 CLT 资产，`env.mjs` 会直接报"平台不支持"），Windows 的构建脚本链路也未适配。

## 前置条件

| 工具 | 来源 | 用途 |
| --- | --- | --- |
| Node.js + pnpm | Node ≥ 20；pnpm 11.21.0 | workspace 与脚本（前置硬依赖） |
| JDK 17+ | 本机安装（Temurin 等） | hvigor 打包/签名（前置硬依赖，不自动下载） |
| HarmonyOS Command Line Tools | `pnpm install` 自愈下载（Release `tools`），或本机已有 | hvigor、hdc、Native SDK |
| .NET SDK 9.0.104 | `pnpm install` 自愈下载（微软官方 CDN），或本机已有 | C# Link 与 NativeAOT |
| ohos-net runtime pack | `pnpm install` 自愈下载（Release `tools`） | NativeAOT 目标运行库 |
| devecocli | workspace devDependency，随 pnpm install | 调试签名材料生成 |
| `apps/tesslo/assets/fetched/` | 已入库 | 离线素材库（无需联网） |

CLT 分卷托管在 GitCode [`ohos-tools` v26.0](https://gitcode.com/yuanbaobaoo/ohos-tools/releases/v26.0)
（国内 CDN 直连），runtime pack 托管在本仓 GitHub Release
[`tools`](https://github.com/yuanbaobaoo/Tesslo/releases/tag/tools)；版本与 SHA-256
锁定在 `scripts/toolchain.lock.json`（linux 分卷哈希取自 GitCode 资产摘要，整包哈希
与 CI 锁定值一致）。.NET 走微软官方 CDN 并在安装后用 `dotnet --version` 校验。
CI 的 Linux CLT 仍从 GitHub Release 拉取（851 同源同哈希），暂未切换到 GitCode。

## 环境检测与自愈（scripts/env.mjs）

每次 `pnpm install`（postinstall）与 `build:link:csharp` / `build:hap` / `build:app` /
`dev:ohos`（前置 ensure）都会走同一套决策矩阵：

1. **显式声明**（`.env` 里有该 key，或真实环境变量有值）→ 只校验、绝不下载；
   路径无效直接报错指出问题行。
2. **探测**（候选链见 `.env.example`；`.toolchain/` 是自愈安装的约定落点）→ 找到即用。
3. **缺失** → 列表询问 `y/N`（大小写不敏感）：确认后下载到 `.toolchain/` 并生成
   `.env.toolchain`（加载优先级低于 `.env`）；拒绝则跳过，构建阶段会给出
   `pnpm env:install <组件>` 的提示。

可用组件名：`clt`、`dotnet`、`runtime-pack`。

```sh
pnpm env:status                  # 体检表：每个组件的状态与来源
pnpm env:install [组件] [--force] # 手动/强制安装（不询问）
```

- 非 TTY（CI、管道）默认按 `n` 跳过；CI 的工具链由 workflow 自行安装，互不干扰。
- `TESSLO_BOOTSTRAP=off`：完全跳过检测（离线装依赖、只改 web 时用）。
- `TESSLO_TOOLS_BASE_URL`：覆盖 Release 基址（国内镜像）。
- `OHOS_NET_RUNTIME_PACK`：声明本地 runtime pack 目录/压缩包后不再联网。
- 全新 mac 的 runtime pack 解压需要 zstd 支持（较新 macOS 的 tar 自带；否则 `brew install zstd`）。

## 命令

```sh
pnpm install                  # workspace 依赖 + 环境检测自愈
pnpm build                    # 全链：编辑器 + web + C# Link + 未签名 HAP + App 包
pnpm build:signed             # 全链 + 签名 HAP 与 App 包
pnpm build:hap                # 只出 HAP（--signed 可选，默认未签名）
pnpm build:app                # 只出 App 包（assembleApp，--signed 可选）
pnpm build:link:csharp        # C# Link + NAPI + 运行库部署
pnpm test                     # TypeScript Link 协议测试
```

单独构建：

```sh
pnpm build:editor             # 全部 Scratch 编辑器包
pnpm build:web                # scratch-gui + Web 入口
pnpm build:storage            # 只重建素材加载与请求队列（debug）
```

`pnpm build:hap` / `build:app` 在 `entry/libs/arm64-v8a/*.so` 缺失时会自动先跑
`build:link:csharp`（.so 不入库，新克隆必然缺失）。`pnpm build:link:csharp` 需要
OHOS Native SDK（`OHOS_SDK_ROOT`，或 CLT 根推导）。

修改 `packages/scratch-gui` 后必须重新执行 `pnpm build:gui`，再执行
`pnpm build:web` 和 `pnpm build:hap`；只重建 web 入口不会更新 GUI bundle。

## HAP / App 内容

`pnpm build[:hap|:app]` 按以下顺序组装：

1. 确认 `web/dist/index.html`；缺失时先运行 `pnpm build`。
2. `entry/libs/arm64-v8a/` 缺 `.so` 时自动补跑 `build:link:csharp`。
3. 复制 `web/dist` 到 `entry/src/main/resources/rawfile`。
4. 把 `apps/tesslo/assets/fetched` 以硬链接铺到 `rawfile/static/fetched`
   （不支持硬链接的文件系统回退为复制）。
5. 运行 hvigor `assembleHap`（HAP）或 `assembleApp`（App 包）。

输出：

```text
apps/tesslo/entry/build/default/outputs/default/
  entry-default-unsigned.hap / entry-default-signed.hap
apps/tesslo/build/outputs/default/
  entry-default-unsigned.app / entry-default-signed.app
```

包内包含：

- ArkTS 宿主与 ArkWeb 页面；
- `rawfile/index.html`、`main.js`、GUI 静态资源和离线素材；
- `libs/arm64-v8a/` 下的 `ScratchLinkOhos.so`、`libtesslolink.so`、
  `libc++_shared.so`。

不再包含 Electron 运行时。

## 二进制策略

- HAP/App、`.so`、`oh_modules`、`build/`、`rawfile` 都不进入 git。
- `.toolchain/` 与 `.env.toolchain` 由 env.mjs 生成，不进入 git。
- C# Link 的运行库由 `build:link:csharp` 生成，不提交。
- 仓库不保存二进制缓存，也不使用 Git LFS。

## 签名

默认产出未签名包，供本地检查或自行签名。加 `--signed`（或 `pnpm build:signed`）
走签名流程。若 `build-profile.json5` 没有 `signingConfigs`，脚本会调用 devecocli
（workspace devDependency，经 `pnpm exec` 调用）生成调试签名材料：

```text
devecocli signature generate --product default
```

首次生成需要登录华为账号。签名材料位于 `~/.ohos/config/`，并与 bundleName、华为
账号和设备绑定：

- 修改 `AppScope/app.json5` 的 `bundleName` 后必须重新生成。
- 删除本地 `build-profile.json5` 可强制重新生成。
- `build-profile.json5` 与 `*.local` 文件都不提交。

## 离线构建

源码与依赖都在仓库或本地包存储中：

```sh
pnpm install --offline --store-dir <local-store>
pnpm build
```

构建过程不访问任何素材 CDN 或上游 GitHub 仓库；`apps/tesslo/assets/fetched`
的 1328 个素材已随仓库提交，checkout 后即可离线构建。工具链自愈下载需要网络；
完全离线时用 `.env` 显式声明各组件路径（声明后不联网），或
`TESSLO_BOOTSTRAP=off` 跳过检测。
