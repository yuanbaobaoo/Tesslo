# 构建与打包

## 全新机器链路

```sh
git clone <repo> && cd tesslo
pnpm install      # 装依赖 + 环境检测；缺失的 CLT/.NET/runtime pack 会询问是否下载（y/N）
pnpm build:hap    # 全链构建：编辑器 → web → C# Link → 未签名 HAP（--signed 出 dev 身份的调试签名包）
pnpm build:app    # 全链 → release 模式 + 上架签名的 App 包（见"签名"）
pnpm dev:ohos     # 装进模拟器/真机：未登录引导登录华为账号，无设备自动启动/创建模拟器
```

前置硬依赖只有两个：**Node ≥ 22.18 + pnpm**（脚本为 TypeScript，用 Node 原生类型擦除直接运行）、**JDK 17+**（与 Node 同级，只探测、绝不自动下载；
hvigor 的打包 `app_packing_tool.jar` 与签名 `hap-sign-tool.jar` 都是 Java 实现）。JDK 缺失时
`pnpm env:status` 会给出指引，建议 Temurin：<https://adoptium.net/>。

支持的平台：**mac（Apple silicon）/ linux-x64 / windows-x64**。Intel mac 不支持自动安装
（无 CLT 资产）。Windows 的脚本链路已按跨平台方式适配（可执行文件候选探测、批处理
不经 shell 的 node 直调、CLT 的 windows-x64 自动安装资产已启用），**端到端行为待
Windows 真机验证**；两点已知限制：.NET SDK 在 Windows 不自动安装（本机已有或手动装，
`DOTNET_ROOT` 声明即可），C# Link 的 runtime pack 自动解压需要 zstd（Windows 暂不支持，
可解压后用 `OHOS_NET_RUNTIME_PACK` 指向目录；NativeAOT 交叉编译在 Windows 主机的
可用性待验证）。

## 前置条件

| 工具 | 来源 | 用途 |
| --- | --- | --- |
| Node.js + pnpm | Node ≥ 22.18（原生跑 .ts 脚本）；pnpm 11.21.0 | workspace 与脚本（前置硬依赖） |
| JDK 17+ | 本机安装（Temurin 等） | hvigor 打包/签名（前置硬依赖，不自动下载） |
| HarmonyOS Command Line Tools | `pnpm install` 自愈下载（Release `tools`），或本机已有 | hvigor、hdc、Native SDK |
| .NET SDK 9.0.104 | `pnpm install` 自愈下载（微软官方 CDN），或本机已有 | C# Link 与 NativeAOT |
| ohos-net runtime pack | `pnpm install` 自愈下载（Release `tools`） | NativeAOT 目标运行库 |
| devecocli | workspace devDependency，随 pnpm install | dev 身份调试签名材料生成 |
| `apps/tesslo/assets/fetched/` | 已入库 | 离线素材库（无需联网） |

CLT 分卷托管在 GitCode [`ohos-tools` v26.0](https://gitcode.com/yuanbaobaoo/ohos-tools/releases/v26.0)
（国内 CDN 直连），runtime pack 托管在本仓 GitHub Release
[`tools`](https://github.com/yuanbaobaoo/Tesslo/releases/tag/tools)；版本与 SHA-256
锁定在 `scripts/toolchain.lock.json`（linux 分卷哈希取自 GitCode 资产摘要，整包哈希
与 CI 锁定值一致）。.NET 走微软官方 CDN 并在安装后用 `dotnet --version` 校验。
CI 的 Linux CLT 仍从 GitHub Release 拉取（851 同源同哈希），暂未切换到 GitCode。

## 环境检测与自愈（scripts/env.ts）

每次 `pnpm install`（postinstall）与 `build:link:csharp` / `build:hap` / `build:app` /
`dev:ohos`（前置 ensure）都会走同一套决策矩阵：

1. **显式声明**（`.env` 里有该 key，或 shell / CI 导出的真实环境变量有值）→ 只校验、
   绝不下载；路径无效直接报错指出问题行。
2. **探测**（候选链见 `.env.example`；`.toolchain/` 是自愈安装的约定落点）→ 找到即用。
   CLT 位置优先认 devecocli 标准变量 `DEVECO_CLI_CLT_PATH`（构建脚本与 devecocli
   共用，在 shell 配置里 export 即可，无需 `.env`）；未声明时从 PATH 上的 SDK 工具
   （hvigorw/hdc）反推根路径，脚本不探测任何机器路径。
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
pnpm build:hap                # 全链：编辑器 + web + C# Link → 未签名 HAP；--signed 出 dev 身份调试签名包
pnpm build:app                # 全链 → release 模式 + 上架签名的 App 包（上传 AGC）
pnpm dev:ohos                 # 部署到设备：签名 → 安装 → 启动 → 日志/截图（自动处理登录与模拟器）
pnpm build:link:csharp        # C# Link + NAPI + 运行库部署
pnpm test                     # TypeScript Link 协议测试
```

`pnpm dev:ohos` 是唯一做首次运行引导的入口（`build:hap` / `build:app` 保持纯构建，
不触发登录或模拟器逻辑）：

- **未登录**：提示按回车，由 `devecocli auth login` 打开浏览器完成登录；无终端可
  交互时报错并给出手动登录指引。登录判断只在调试签名确实需要生成时发生，材料有效
  则跳过、保持离线。
- **无设备**（`hdc list targets` 为空）：自动启动第一个已停止的模拟器实例；没有
  实例则交互选择设备类型（`module.json5` 的 `deviceTypes`）与系统版本（缺镜像先
  下载），创建并启动后自行轮询 `hdc list targets`（最长 180s）。
- **模拟器协议未接受**：提示 `devecocli emulator license`，不代替用户接受。
- 模拟器能力依赖 DevEco Studio（仅 macOS/Windows）；Linux 上按"无设备"给出真机
  接入指引。

模拟器参数：`--emulator <name>`（启动指定实例）、`--emulator-device-type <t>` +
`--emulator-os-version "<v>"`（非交互创建，两者必须成对）、`--no-emulator`
（禁止自动启动/创建，无设备直接报错）。设计与交互决策见
[dev:ohos 首次运行体验](dev-ohos-onboarding.md)。

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

`pnpm build:hap` / `build:app` 均自带全链（编辑器 → web → C# Link），再按以下顺序组装：

1. 构建 `web/dist`（`build:editor` + `build:web`；直接调脚本且产物已存在时跳过）。
2. 部署 `entry/libs/arm64-v8a/` 的 C# Link `.so`（`build:link:csharp`；直接调脚本
   且 `.so` 已存在时跳过）。
3. 复制 `web/dist` 到 `entry/src/main/resources/rawfile`。
4. 把 `apps/tesslo/assets/fetched` 以硬链接铺到 `rawfile/static/fetched`
   （不支持硬链接的文件系统回退为复制）。
5. 运行 hvigor `assembleHap`（HAP）或 `assembleApp`（App 包）。

输出：

```text
apps/tesslo/entry/build/default/outputs/default/
  entry-default-unsigned.hap（正式包名，未签名）
apps/tesslo/entry/build/dev/outputs/dev/
  entry-dev-signed.hap（dev 身份，build:hap --signed / dev:ohos）
apps/tesslo/build/outputs/<product>/
  entry-default-unsigned.app（default，CI）/ entry-*-signed.app（release，上架）
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

## dev 身份（与正式版共存）

`pnpm dev:ohos` 与 `pnpm build:hap --signed` 构建 dev 身份（product `dev`），可与
正式版装在同一台设备上，互不覆盖、数据互不影响：

| | 正式版（product default / release） | dev 版（product dev） |
| --- | --- | --- |
| 包名 | `io.github.yuanbaobaoo.tesslo` | `io.github.yuanbaobaoo.tesslo.dev` |
| 桌面名 | Tesslo | Tesslo-dev |
| 签名 | 未签名（CI）/ release 上架签名 | 调试签名（devecocli 自动生成） |

包名不能带 `-`（鸿蒙只允许字母、数字、下划线和点），所以用 `.dev` 段。身份差异
全部用 hvigor 多目标定制声明，构建期间不改任何源文件：

- 包名、应用名：`build-profile.template.json5` 中 dev product 的 `bundleName` / `label`；
- 桌面名：`entry/build-profile.json5` 中 dev target 的 `source.abilities` 覆盖
  EntryAbility 的 label；
- 快捷方式：wants 写死了包名，而 hvigor 只替换模块级 metadata 里快捷方式的包名，
  所以 dev target 把 `src/main/resources_dev` 排在资源目录最前，用其中同名的
  `shortcuts_config.json` 覆盖。**改 `resources/base/profile/shortcuts_config.json`
  时要同步改 `resources_dev` 下的副本**（两份只有包名不同，`pnpm test` 会校验）。

本机 `build-profile.json5` 生成得比 dev product 早时，脚本会自动从模板补齐 dev
product 与 dev target。

## 签名

原理、材料角色与完整流程详见[发布签名详解](release-signing.md)。

`build:hap` 默认产出未签名包（`--signed` 出 dev 身份的调试签名包）；`build:app` 固定
release 模式 + 上架签名，用 `-p product=release` 选择上架 product（hvigor
没有选择签名配置的命令行参数，签名随 product 声明；构建全程不改写
build-profile.json5）。签名材料在 `build-profile.json5` 的 signingConfigs
（本机文件，不入 git）：

- `dev`：调试签名，只服务 dev 身份。签名构建前脚本检查本机材料，缺失、profile
  包名不是 dev、已过期，或有已连接设备没注册时，调用 devecocli（workspace
  devDependency，经 `pnpm exec` 调用）重新生成：

  ```text
  devecocli signature generate --product dev
  ```

  材料可用时只读本地文件与设备，不访问 AGC。首次生成需要登录华为账号
  （`devecocli auth login`）并连接设备（生成时注册设备 UDID）。devecocli 只认
  `AppScope/app.json5` 里的包名，脚本在生成期间临时把它切到 dev 包名、结束即还原
  （被强杀留下的残留会在下次打包前自动修复）。

  **不要直接运行 `devecocli signature generate`**：它会按正式包名签出 profile，
  dev 包随即装不上。需要重签时用 `pnpm dev:ohos -- --resign`（或
  `pnpm build:hap --signed --resign`）。

  devecocli 每次生成都会删除并重建华为账号下共用的 `auto_debug` 调试证书，同一
  时刻只有一套自动签名材料有效，所以正式包名不再使用调试签名。曾用旧脚本生成过
  `default` 调试签名的机器，那份配置连同 `default` product 上的
  `signingConfig: 'default'` 引用都应删掉（材料已随证书轮换作废，留着还可能被
  DevEco Studio 选中、签出正式包名的调试包）。同一账号的其它工程做自动签名也会
  轮换这张证书；dev 包装机报签名错误时用 `--resign` 重签。

- `release`：上架签名（AGC 发布证书 + 发布 Profile），**由用户手工维护**——
  材料路径、keyAlias、密码都填在 `build-profile.json5` 的 release signingConfig
  里；`pnpm build:app` 只校验它存在并在构建期间临时切换，不生成、不改写：

  1. `pnpm signing:keygen`：交互式输入证书名称、密码（不回显，输两遍），在
     当前目录 `.certs/` 下生成 `<名称>.p12`（0600）与 `<名称>.csr`（申请证书
     用的中间产物，构建不用）。`.certs/` 含私钥，已入 `.gitignore`。同名重跑
     需 `--force` 并确认（会作废用旧密钥签发的证书）。
  2. AGC 签发（证书/Profile 只能由 AGC 签发，devecocli 的 `signature generate`
     仅覆盖调试签名）：「证书管理」上传 CSR 申请**发布证书**下载 `.cer`，
     「Profile 管理」申请**发布** Profile（选该证书与本应用）下载 `.p7b`。
  3. 手工维护 `build-profile.json5`（模板已内置上架 product 与 applyToProducts）：
     signingConfigs 加 release 条目填材料路径、keyAlias、密码（七个字段含义见
     [发布签名详解](release-signing.md)；`certpath` 必须是单证书文件，证书链需
     自行拆出叶子；**密码必须是 `pnpm signing:encrypt` 生成的密文**（keygen
     也会直接输出），明文不可用）；再给 release product 加
     `signingConfig: 'release',` 一行。
  4. `pnpm build:app`：开头校验 product 已声明（缺失立刻报错，不进长构建）
     → 全链构建 → hvigor 以 `-p product=release -p buildMode=release` 打包
     （不改写任何文件）；产物 `apps/tesslo/build/outputs/release/*-signed.app`
     直接上传 AGC。

`pnpm build:app` 默认 release 模式 + 上架签名：构建期间临时把 product 指向
`release` 签名配置、结束后还原；产物 `apps/tesslo/build/outputs/default/*-signed.app`
直接上传 AGC。`pnpm build:hap --signed` 与 `pnpm dev:ohos` 用 dev 身份的调试签名装真机
调试，不覆盖设备上的正式版。
`build-profile.json5` 与 `*.local` 文件都不提交。

## 离线构建

源码与依赖都在仓库或本地包存储中：

```sh
pnpm install --offline --store-dir <local-store>
pnpm build:hap
```

构建过程不访问任何素材 CDN 或上游 GitHub 仓库；`apps/tesslo/assets/fetched`
的 1328 个素材已随仓库提交，checkout 后即可离线构建。工具链自愈下载需要网络；
完全离线时用 `.env` 显式声明各组件路径（声明后不联网），或
`TESSLO_BOOTSTRAP=off` 跳过检测。
