import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

import {hapRoot, repoRoot} from './ohos-common.mjs';

const dotnetRoot = process.env.DOTNET_ROOT || path.join(process.env.HOME ?? '', '.dotnet');
const dotnet = path.join(dotnetRoot, 'dotnet');
if (!fs.existsSync(dotnet)) {
    console.error(`[link:csharp] dotnet not found at ${dotnet}; install .NET 9.0.104 first`);
    process.exit(1);
}

const sdkCandidates = [
    process.env.OHOS_SDK_ROOT,
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

const env = {
    ...process.env,
    DOTNET_ROOT: dotnetRoot,
    PATH: `${dotnetRoot}${path.delimiter}${process.env.PATH}`
};
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

const serverProject = path.join(repoRoot, 'packages/scratch-link-ohos/dotnet/Tesslo.Link.Server/Tesslo.Link.Server.csproj');
const nativeProject = path.join(repoRoot, 'packages/scratch-link-ohos/dotnet/Tesslo.Link.Native/Tesslo.Link.Native.csproj');
publish(serverProject);
publish(nativeProject);

const nativeRoot = fs.existsSync(path.join(sdkRoot, 'openharmony/native'))
    ? path.join(sdkRoot, 'openharmony/native')
    : path.join(sdkRoot, 'native');
const clang = path.join(nativeRoot, 'llvm/bin/clang++');
const shimSource = path.join(repoRoot, 'packages/scratch-link-ohos/dotnet/napi/tesslo_link_napi.cpp');
const shimOutput = path.join(repoRoot, 'packages/scratch-link-ohos/dotnet/napi/libtesslolink.so');
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

const deployDir = path.join(hapRoot, 'entry/libs/arm64-v8a');
fs.mkdirSync(deployDir, {recursive: true});
const nativeOutput = path.join(
    repoRoot,
    'packages/scratch-link-ohos/dotnet/Tesslo.Link.Native/bin/Release/net9.0/linux-musl-arm64/publish/TessloLinkNative.so'
);
if (!fs.existsSync(nativeOutput)) {
    console.error(`[link:csharp] expected artifact not found: ${nativeOutput}`);
    process.exit(1);
}
fs.copyFileSync(nativeOutput, path.join(deployDir, 'TessloLinkNative.so'));
fs.copyFileSync(shimOutput, path.join(deployDir, 'libtesslolink.so'));

const libcxx = path.join(nativeRoot, 'llvm/lib/aarch64-linux-ohos/libc++_shared.so');
if (fs.existsSync(libcxx)) fs.copyFileSync(libcxx, path.join(deployDir, 'libc++_shared.so'));

console.log(`[link:csharp] deployed C# link + NAPI bridge to ${path.relative(repoRoot, deployDir)}`);
