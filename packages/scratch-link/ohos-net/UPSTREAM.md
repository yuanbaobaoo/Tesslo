# UPSTREAM — 上游出处、锁定版本与第三方许可

本仓不是从零写的运行时：runtime pack、Avalonia 后端、NDK 绑定、交叉编译 targets 各有上游。下面逐条给出**取用方式、本仓锁定的 revision、许可证**，以及本仓自研的部分。

## 1. 上游仓库与本仓锁定 revision

| 组件（本仓路径） | 上游 | 锁定 commit | 日期 | 许可证 |
|---|---|---|---|---|
| `src/Avalonia.OpenHarmony` | `github.com/WCKYWCKF/OpenHarmony.Avalonia` | `bd3b938fdd68ef173b87fb1eba3a06067709a4c6` | 2025-03-09 | MIT（Avalonia 生态） |
| `src/openharmony-ndk-bindings` | `github.com/FlameskyDexive/OpenHarmony.NDK.Bindings` | `fbcadb442a2038a53deb4c3a343eeaf047a28d03` | 2025-08-04 | 上游仓库**未附** LICENSE 文件（见第 4 节） |
| `runtime/`、`src/Entry` 依赖的 runtime pack 源仓 | `github.com/FlameskyDexive/OpenHarmony.NET.Runtime` | `6140ff536d00bfa550e169b054e5bde0c82be81a` | 2026-08-04 | 上游仓库**未附** LICENSE 文件（见第 4 节） |
| `toolchain/openharmony-publish-aot-cross` | `github.com/OpenHarmony-NET/PublishAotCross` | `421096729d546a8c8564ce2f79054ef328789281` | 2026-08-02 | MIT（`LICENSE.TXT`，Copyright (c) Michal Strehovsky） |

复现取用：

```bash
git clone https://github.com/OpenHarmony-NET/PublishAotCross && cd PublishAotCross
git checkout 421096729d546a8c8564ce2f79054ef328789281
```

## 2. 已发布的 NuGet 包（runtime pack 的官方分发通道）

`runtime/` 里的两份 pack 解自公开 NuGet 包，不是本仓自造的二进制：

| 包 | 版本 | 体积 | SHA-256 |
|---|---|---|---|
| `OpenHarmony.NET.Runtime` | `0.0.0-alpha.19` | 46,914,211 B | `4e8dfd6eafdd3c3058a89bfba1d6c03398e654f753730091ec3edc2f39a90154` |
| `OpenHarmony.NET.PublishAotCross` | `0.0.0-alpha.7` | 569,178 B | 未随仓保留（仅取 targets 参考，本仓用 `toolchain/host-portable/`） |

解包后取 `build/runtime.linux-musl-arm64.microsoft.dotnet.ilcompiler/` 与 `build/runtime.linux-musl-x64.microsoft.dotnet.ilcompiler/` 两目录即本仓 `runtime/` 内容。校验：

```bash
sha256sum openharmony.net.runtime.0.0.0-alpha.19.nupkg
# 期望 4e8dfd6eafdd3c3058a89bfba1d6c03398e654f753730091ec3edc2f39a90154
```

包内 `sdk/System.Private.CoreLib.dll` 的 informational version 为 9.0.x，故本仓示例统一用 net9.0 + .NET 9 SDK。上游仓库的 `release/10.0.10-ohos.1`、`release/10.0.10-ohos.2-preview.1` 只有 `manifest.json`/`sbom.spdx.json`/`SHA256SUMS` 元数据（schemaVersion 2、`runtimeBaselineApi=13`、`minimumApi=13`，API 25 明确排除），二进制 payload 需上游 RuntimePackager 按 API13 基线构建后产出——**本仓不提供 10.x 基线的 pack**，需要时按上游 `tools/RuntimePackager` 自建。

## 3. 本仓自研内容

| 路径 | 内容 | 为什么 |
|---|---|---|
| `toolchain/host-portable/OpenHarmonyCross.targets` | 主机可移植的 SDK 解析、clang/lld 选择、OHOS 链接参数 | 上游 targets 把路径写成 `\` 连接并硬编码 `.exe` 后缀，只在 Windows 主机正确；macOS/Linux 主机在 `ValidateOpenHarmonyResolvedSdk` 就会失败 |
| `toolchain/host-portable/OpenHarmonyRuntimePack.targets` | 用 OHOS pack 覆盖 `IlcSdkPath` / `IlcFrameworkNativePath`，并把 `native/*` 随 publish 拷出 | 让 `-p:OpenHarmonyTarget` 之外的路径也能吃到 OHOS CoreLib |
| `toolchain/OpenHarmonySdkResolver` | 上游 resolver 源码（未改动） | 按 `apiVersion` 匹配 Native SDK 子目录 |
| `samples/hello`、`samples/avalonia-ohos` | 两个可编译闸门；Avalonia 示例为纯代码 UI | 上游 Example 依赖 `Irihi.Ursa`/`Semi.Avalonia*` 主题包，离线或精简环境还原不到；纯代码示例保证 `dotnet publish` 一步过 |
| `README.md`、`docs/*` | 文档 | — |

## 4. 第三方许可证与义务

- **MIT**：Avalonia 11.2.2、SkiaSharp、HarfBuzzSharp、Silk.NET.OpenGLES、CommunityToolkit.Mvvm、PublishAotCross。
- **无 LICENSE 文件**：`OpenHarmony.NDK.Bindings`、`OpenHarmony.NET.Runtime` 两个上游仓库在其锁定 commit 上未附许可证文件。本仓按“上游公开仓库 + 已发布的公开 NuGet 包”事实再分发；**若你计划商用分发，请先向上游作者确认授权口径**（这是诚实提醒，不是法律意见）。
- **NativeAOT 产物运行时依赖的 OpenSSL/ICU**：`runtime/runtime.linux-musl-arm64…/native/` 随包只给 `libssl.so.3` + `libicu{uc,i18n}.so.72`，**不含 `libcrypto.so`**；`runtime.linux-musl-x64…/native/` 给 `libicu*` + `libgcc_s.so.1` + `libstdc++.so.6`。若你的应用走 `System.Security.Cryptography`，需自行随 HAP 分发一份 musl 版 `libcrypto.so`，否则 `InitializeOpenSSLShim` 的 dlsym 失败会以 SIGSYS+SIGABRT 形式在启动时炸掉且几乎没有日志。
- **`prebuilt/native/`**：Skia（BSD-3）、HarfBuzz（MIT/Old-style）、freetype（FTL 或 GPLv2）、fontconfig（MIT）、libpng（libpng License）、brotli（MIT）、bzip2（BSD-4-clause-lite）、expat（MIT）、zlib（zlib License）。这些 so 由上游打包提供，逐库原文以你的重新构建来源为准。

## 5. 本仓自有代码许可

`toolchain/host-portable/`、`samples/`、`docs/`、`README.md` 为 MIT（见 `LICENSE`）。
