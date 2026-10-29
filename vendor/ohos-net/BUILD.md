# BUILD — 可复现编译步骤

本仓所有命令均于 2026-10-14 在 macOS（Apple Silicon）实测通过，产物为 HarmonyOS ELF。Linux 主机同理；Windows 主机可用 `toolchain/openharmony-publish-aot-cross/` 的上游 targets（其路径拼接为 `\` 与 `.exe` 硬编码，仅 Windows 正确）。

## 1. 前置

| 组件 | 实测版本 | 说明 |
|---|---|---|
| .NET SDK | 9.0.104 | runtime pack 是 net9 基线；SDK 10 也能建 net9 项目（本仓示例已去掉硬编码 RID） |
| OHOS Native SDK | API 26（`native/oh-uni-package.json` 的 `apiVersion`） | 需含 `native/llvm/bin/{clang,clang++,ld.lld,llvm-objcopy}`、`native/sysroot`、`native/build/cmake/ohos.toolchain.cmake` |
| NuGet 源 | nuget.org | 还原 `Avalonia 11.2.2`、`SkiaSharp`、`Silk.NET.OpenGLES` 等 |

SDK 根目录传法：`-p:OpenHarmonySdkRoot=<dir>` 或环境变量 `OHOS_SDK_ROOT=<dir>`。`<dir>` 的**直接子目录**里要有 `native/oh-uni-package.json`，例如 DevEco 的 `…/Contents/sdk/default`（其下 `openharmony/native/…`）。`toolchain/OpenHarmonySdkResolver` 会按 `--api` 在这些子目录里匹配 `apiVersion`，并把解析结果写成 `obj/openharmony-sdk-<api>-<abi>.props`。

## 2. 闸门一：console（验证工具链与 runtime pack）

```bash
export DOTNET_ROOT=$HOME/.dotnet PATH="$DOTNET_ROOT:$PATH"
cd samples/hello
dotnet publish -c Release -r linux-musl-arm64 \
  -p:OpenHarmonyApiLevel=26 -p:OpenHarmonyAbi=arm64-v8a \
  -p:OpenHarmonySdkRoot=/path/to/sdk/default
file bin/Release/net9.0/linux-musl-arm64/publish/Hello
# 期望：ELF 64-bit LSB pie executable, ARM aarch64, interpreter /lib/ld-musl-aarch64.so.1
```

模拟器 ABI：`-r linux-musl-x64 -p:OpenHarmonyAbi=x86_64`，产物应为 `ELF … x86-64 … /lib/ld-musl-x86_64.so.1`。

## 3. 闸门二：Avalonia（产出 so）

```bash
cd samples/avalonia-ohos
dotnet publish -c Release -r linux-musl-arm64 \
  -p:OpenHarmonyApiLevel=26 -p:OpenHarmonyAbi=arm64-v8a \
  -p:OpenHarmonySdkRoot=/path/to/sdk/default
```

产物 `publish/libavalonia.so`（未 strip 约 37 MB，含 debug_info）+ 随行原生 so（Skia/HarfBuzz/freetype/fontconfig/png/brotli/bz2/expat/z）+ runtime pack 的 `native/`（libssl/libicu）。校验导出入口：

```bash
<SDK>/openharmony/native/llvm/bin/llvm-readelf --dyn-syms publish/libavalonia.so \
  | grep RegisterEntryModule
```

## 4. 关键开关（勿省）

| 开关 | 作用 | 漏掉的后果 |
|---|---|---|
| `-p:OpenHarmonyApiLevel` | 选择 Native SDK | 解析器不跑，链接用主机 clang |
| `-p:OpenHarmonyAbi` | 决定 target triple 与随行 so 目录 | 串错 ABI 时链接期报找不到 `-lc++_shared` |
| `-p:OpenHarmonySdkRoot` / `OHOS_SDK_ROOT` | SDK 根 | targets 直接报错退出 |
| `DisableUnsupportedError`（targets 内置） | 允许 macOS/Linux 主机关 `linux-musl-*` | SDK 拒绝 cross publish |
| `CompressSymbols=false`（targets 内置） | 关闭 ld 的符号压缩 | OHOS lld 版本不支持 `--compress-debug-sections` 类参数 |

`toolchain/host-portable/OpenHarmonyCross.targets` 还从链接项里移除 `System.Net.Security.Native`：OpenHarmony 无 GSS 后端，强行链接会得到一堆 `NetSecurityNative_*` 未定义符号。需要 TLS 时走 `runtime/*/native/libssl.so`（OpenSSL），或在你的工程里自备 gss 桩源码再挂回该库。

## 5. 构建纪律（本仓踩过/上游踩过）

- **改了 csproj 或条件编译后一律全量重建**：AOT 的 `obj` 缓存在一次编译错误后可能损坏，后续 publish 会 `exit 0` 但产物不更新。判据用**产物 mtime + 行为签名**，不要只看退出码。`rm -rf bin obj` 再编。
- **验证产物用 ELF/符号，不要用 `strings`**：AOT 产物里的 C# 字符串是 UTF-16，macOS `strings` 对大 so 的提取不可靠。要确认某段代码真被编进去了，查符号或用 `llvm-readelf --dyn-syms`。
- **多 RID 别写死在 csproj**：`RuntimeIdentifiers` 列多个 RID 会让子项目丢 RID，连带丢条件编译常量（本仓示例已改为命令行 `-r` 传入）。

## 6. 上机

宿主 HAP 工程按你的应用自建：把第 3 步 `publish/` 整目录拷进 `entry/libs/arm64-v8a/`，`napi_init.cpp` 里 `dlopen` `libavalonia.so` 并调 `RegisterEntryModule`；页面用 XComponent（SURFACE 型）。hvigor 构建与签名配置按你本地 DevEco 环境进行。

## 7. 两条 .NET 基线与各自的验证边界

| | 基线 A：仓内 vendored pack（默认） | 基线 B：stock pack（.NET 10） |
|---|---|---|
| console（arm64） | 通过 | 通过 |
| console（x86_64） | 通过 | 未复测 |
| `samples/avalonia-ohos` → `libavalonia.so` | 通过（导出 `RegisterEntryModule`） | **失败**，见下 |
| 真机运行 | 未验证 | 未验证 |
| 离线可复现 | 是 | 否（需 NuGet 还原 10.0.9 pack） |

基线 B 的用法：TFM 换 `net10.0`，去掉 csproj 里对 `host-portable/OpenHarmonyRuntimePack.targets` 的 import（改吃 stock pack），cross targets 不动，并加 `-p:RuntimeFrameworkVersion=10.0.9`。

基线 B 的 Avalonia 阻塞点（实测）：ilc 10.0.9 在生成原生码阶段报
`Expected method 'GetDynamicInterfaceImplementation' not found on type '[S.P.CoreLib]System.Runtime.InteropServices.IDynamicInterfaceCastable'`。
本仓平台后端与 Avalonia 程序集是 net8 目标（Avalonia 11.2.2），其 DIC 实现形状与 ilc 10 期望的 CoreLib 形状不一致；console 不涉及 DIC 故能过。**这不是调版本号能绕过的**：要在 .NET 10 上跑 Avalonia，平台后端得按 Avalonia 12 的接口形状重写（12 把一批平台接口成员改为 internal 并引入不可实现的毒丸方法，`ref` 程序集也不能直接拿来编译）。所以基线 B 现阶段只适合纯 .NET 10 原生负载；要 Avalonia UI 请用基线 A。

真机边界的实测记录：2in1（HarmonyOS / aarch64 / HongMeng Kernel 1.13.0）上以 shell 身份执行未签名 ELF 被系统策略拒绝（连 `-static` 链接的最小 C 探针也是 `Permission denied`，rc=126），因此这两条链的**运行验证只能走 HAP 沙箱内 `dlopen`**，本仓未完成该验证。另需注意：基线 A 的 vendored pack 是带 OHOS 系统调用劫持改动的构建，基线 B 用的是 stock 上游 pack、不含这些改动——按移植史记录，缺劫持桩在 OHOS 上有以 SIGSYS 失败的风险，此点未经本仓证伪，按风险对待。

