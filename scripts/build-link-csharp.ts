import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

import {hapRoot, repoRoot, resolveOhosNativeSdk} from './ohos-common.ts';

// 构建 C# Scratch Link（NativeAOT -> ScratchLinkOhos.so）与 NAPI 桥
// （tesslo_link_napi.cpp -> libtesslolink.so），并部署进 HAP 的 entry/libs。
// 改 C#/NAPI 的符号、参数或返回码后必须完整跑一次本脚本。

// dotnet 宿主位置：DOTNET_ROOT（含 env.mjs 生成的 .env.toolchain）→ 仓库内自愈安装
// → ~/.dotnet。.NET 版本随 ohos-net.lock.json 锁定 9.0.104，10.x 会因 SDK resolver 不兼容失败
const dotnetCandidates = [
  process.env.DOTNET_ROOT,
  path.join(repoRoot, '.toolchain/dotnet'),
  process.env.HOME && path.join(process.env.HOME, '.dotnet')
].filter((candidate): candidate is string => Boolean(candidate));
const dotnetRoot = dotnetCandidates.find(root => fs.existsSync(path.join(root, 'dotnet')));
if (!dotnetRoot) {
  console.error('[link:csharp] dotnet not found; run `pnpm env:install dotnet` or set DOTNET_ROOT');
  process.exit(1);
}
const dotnet = path.join(dotnetRoot, 'dotnet');

// Native SDK 位置统一走环境变量解析（OHOS_SDK_ROOT → CLT 根推导），见 ohos-common.ts；
// 不做任何机器路径猜测
const sdk = resolveOhosNativeSdk();
if (!sdk) {
  console.error(
    '[link:csharp] OHOS Native SDK not found; set OHOS_SDK_ROOT (or ' +
      'DEVECO_CLI_CLT_PATH) in .env / environment, or put hvigorw/hdc on PATH'
  );
  process.exit(1);
}
const sdkRoot = sdk.root;

// Native SDK 定位：openharmony/native 目录下含 sysroot 与 llvm 交叉工具链
const env = {
  ...process.env,
  DOTNET_ROOT: dotnetRoot,
  // msbuild 用 DOTNET_HOST_PATH 定位宿主 dotnet；不设会解析到系统里
  // 其他版本（如 10.x），导致 ohos-net 的 SDK resolver 启动失败（exit 150）
  DOTNET_HOST_PATH: dotnet,
  // 让 MSBuild 侧（OpenHarmonyCross.targets）与脚本解析到同一份 SDK
  OHOS_SDK_ROOT: sdkRoot,
  PATH: `${dotnetRoot}${path.delimiter}${process.env.PATH}`
};

/**
 * dotnet publish：NativeAOT 交叉编译到 linux-musl-arm64（OHOS ABI）。
 *
 * @param project - csproj 路径
 */
function publish(project: string): void {
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
}

// scratch-link-ohos：基于上游 scratch-link-common 的 OHOS 平台实现，
// 产物 ScratchLinkOhos.so（含 NAPI 宿主导出 TessloLinkStart/Stop/Version）
const ohosProject = path.join(repoRoot, 'packages/scratch-link/scratch-link-ohos/scratch-link-ohos.csproj');
publish(ohosProject);

// native 布局（openharmony/ 下或根下）已由 resolveOhosNativeSdk 判定
const nativeRoot = sdk.nativeRoot;
// NAPI 桥：把 C# 的 [UnmanagedCallersOnly] 导出包装成 Node-API 模块
const clang = path.join(nativeRoot, 'llvm/bin/clang++');
// 兼容层是 C 源码，必须用 clang（而非 clang++）编译，避免符号被 C++ mangle
const clangC = path.join(nativeRoot, 'llvm/bin/clang');
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

// Fleck WebSocket 握手的 SHA1 依赖 OpenSSL shim，运行时 dlopen libssl.so.3；
// runtime pack 的精简 libssl 缺 OCSP_basic_verify / PKCS7_sign，不能直接作为
// libssl.so.3 暴露。真实库改名随包，再由 openssl_compat.c 生成同名兼容层。
const opensslOutput = path.join(path.dirname(nativeOutput), 'libssl.so.3');
if (!fs.existsSync(opensslOutput)) {
  console.error(`[link:csharp] expected OpenSSL runtime not found: ${opensslOutput}`);
  process.exit(1);
}
fs.copyFileSync(opensslOutput, path.join(deployDir, 'libssl_ohos.so'));
const opensslCompatSource = path.join(repoRoot, 'packages/scratch-link/napi/openssl_compat.c');
const opensslCompat = spawnSync(
  clangC,
  [
    '--target=aarch64-linux-ohos',
    `--sysroot=${path.join(nativeRoot, 'sysroot')}`,
    '-fPIC',
    '-shared',
    '-O2',
    '-o',
    path.join(deployDir, 'libssl.so.3'),
    opensslCompatSource,
    '-L',
    deployDir,
    '-Wl,--no-as-needed',
    '-l:libssl_ohos.so'
  ],
  {stdio: 'inherit'}
);
if (opensslCompat.status !== 0) process.exit(opensslCompat.status ?? 1);

fs.copyFileSync(shimOutput, path.join(deployDir, 'libtesslolink.so'));

// OHOS 需要 libc++_shared.so 随包分发（C# AOT 运行时依赖）
const libcxx = path.join(nativeRoot, 'llvm/lib/aarch64-linux-ohos/libc++_shared.so');
if (fs.existsSync(libcxx)) fs.copyFileSync(libcxx, path.join(deployDir, 'libc++_shared.so'));

console.log(`[link:csharp] deployed C# link + NAPI bridge to ${path.relative(repoRoot, deployDir)}`);
