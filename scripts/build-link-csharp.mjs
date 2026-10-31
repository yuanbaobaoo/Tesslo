import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

import {hapRoot, repoRoot} from './ohos-common.mjs';

// 构建 C# Scratch Link（NativeAOT -> ScratchLinkOhos.so）与 NAPI 桥
// （tesslo_link_napi.cpp -> libtesslolink.so），并部署进 HAP 的 entry/libs。
// 改 C#/NAPI 的符号、参数或返回码后必须完整跑一次本脚本。

// dotnet 宿主位置；默认 ~/.dotnet，可用 DOTNET_ROOT 覆盖
const dotnetRoot = process.env.DOTNET_ROOT || path.join(process.env.HOME ?? '', '.dotnet');
const dotnet = path.join(dotnetRoot, 'dotnet');
if (!fs.existsSync(dotnet)) {
  console.error(`[link:csharp] dotnet not found at ${dotnet}; install .NET 9.0.104 first`);
  process.exit(1);
}

const sdkCandidates = [
  process.env.OHOS_SDK_ROOT,
  // 本机固定版本回退路径；仅作兜底，优先用 OHOS_SDK_ROOT 覆盖
  '/Users/Shared/local/ohos/command-line-tools_26.0.0_Beta1/sdk/default',
  process.env.HOME && path.join(process.env.HOME, 'Library/Huawei/Sdk'),
  '/Applications/DevEco-Studio.app/Contents/sdk/default'
].filter(Boolean);
const sdkRoot = sdkCandidates.find(candidate =>
  fs.existsSync(path.join(candidate, 'openharmony/native/oh-uni-package.json')) ||
  fs.existsSync(path.join(candidate, 'native/oh-uni-package.json'))
);
if (!sdkRoot) {
  console.error('[link:csharp] OHOS Native SDK not found; set OHOS_SDK_ROOT');
  process.exit(1);
}

// Native SDK 定位：openharmony/native 目录下含 sysroot 与 llvm 交叉工具链
const env = {
  ...process.env,
  DOTNET_ROOT: dotnetRoot,
  // msbuild 用 DOTNET_HOST_PATH 定位宿主 dotnet；不设会解析到系统里
  // 其他版本（如 10.x），导致 ohos-net 的 SDK resolver 启动失败（exit 150）
  DOTNET_HOST_PATH: dotnet,
  PATH: `${dotnetRoot}${path.delimiter}${process.env.PATH}`
};
/**
 * dotnet publish：NativeAOT 交叉编译到 linux-musl-arm64（OHOS ABI）。
 */
const publish = project => {
  const result = spawnSync(
    dotnet,
    [
      'publish',
      project,
      '-c',
      'Release',
      '-r',
      'linux-musl-arm64',
      '-p:OpenHarmonyApiLevel=26',
      '-p:OpenHarmonyAbi=arm64-v8a',
      `-p:OpenHarmonySdkRoot=${sdkRoot}`
    ],
    {cwd: repoRoot, stdio: 'inherit', env}
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
};

// scratch-link-ohos：基于上游 scratch-link-common 的 OHOS 平台实现，
// 产物 ScratchLinkOhos.so（含 NAPI 宿主导出 TessloLinkStart/Stop/Version）
const ohosProject = path.join(repoRoot, 'packages/scratch-link/scratch-link-ohos/scratch-link-ohos.csproj');
publish(ohosProject);

// SDK 新旧布局兼容：native 可能在 openharmony/ 下或直接在根下
const nativeRoot = fs.existsSync(path.join(sdkRoot, 'openharmony/native'))
  ? path.join(sdkRoot, 'openharmony/native')
  : path.join(sdkRoot, 'native');
// NAPI 桥：把 C# 的 [UnmanagedCallersOnly] 导出包装成 Node-API 模块
const clang = path.join(nativeRoot, 'llvm/bin/clang++');
const shimSource = path.join(repoRoot, 'packages/scratch-link/napi/tesslo_link_napi.cpp');
const shimOutput = path.join(repoRoot, 'packages/scratch-link/napi/libtesslolink.so');
const shim = spawnSync(
  clang,
  [
    '--target=aarch64-linux-ohos',
    `--sysroot=${path.join(nativeRoot, 'sysroot')}`,
    '-fPIC',
    '-shared',
    '-O2',
    `-I${path.join(nativeRoot, 'sysroot/usr/include')}`,
    '-o',
    shimOutput,
    shimSource,
    `-L${path.join(nativeRoot, 'sysroot/usr/lib/aarch64-linux-ohos')}`,
    '-lace_napi.z',
    '-ldl'
  ],
  {stdio: 'inherit'}
);
if (shim.status !== 0) process.exit(shim.status ?? 1);

// 部署：两个 .so 进 HAP 的 arm64 libs；顺带清掉历史命名的遗留产物
const deployDir = path.join(hapRoot, 'entry/libs/arm64-v8a');
fs.mkdirSync(deployDir, {recursive: true});
const nativeOutput = path.join(
  repoRoot,
  'packages/scratch-link/scratch-link-ohos/bin/Release/net9.0/linux-musl-arm64/publish/ScratchLinkOhos.so'
);
if (!fs.existsSync(nativeOutput)) {
  console.error(`[link:csharp] expected artifact not found: ${nativeOutput}`);
  process.exit(1);
}
fs.rmSync(path.join(deployDir, 'TessloLinkNative.so'), {force: true});
fs.copyFileSync(nativeOutput, path.join(deployDir, 'ScratchLinkOhos.so'));
fs.copyFileSync(shimOutput, path.join(deployDir, 'libtesslolink.so'));

// OHOS 需要 libc++_shared.so 随包分发（C# AOT 运行时依赖）
const libcxx = path.join(nativeRoot, 'llvm/lib/aarch64-linux-ohos/libc++_shared.so');
if (fs.existsSync(libcxx)) fs.copyFileSync(libcxx, path.join(deployDir, 'libc++_shared.so'));

console.log(`[link:csharp] deployed C# link + NAPI bridge to ${path.relative(repoRoot, deployDir)}`);
