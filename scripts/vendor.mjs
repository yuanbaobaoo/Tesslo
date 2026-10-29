import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

import {hapRoot, repoRoot} from './ohos-common.mjs';

const force = process.argv.includes('--force');
const lockPath = path.join(repoRoot, 'vendor/electron-ohos.lock.json');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const cacheDir = path.join(repoRoot, lock.cacheDir);
const archivePath = path.join(cacheDir, lock.archive);
const extractDir = path.join(cacheDir, 'extracted');
const targetLibs = path.join(hapRoot, 'electron/libs');
const targetResfile = path.join(hapRoot, 'web_engine/src/main/resources/resfile');

const runtimePresent =
    fs.existsSync(path.join(targetLibs, 'arm64-v8a/libelectron.so')) &&
    fs.existsSync(path.join(targetResfile, 'icudtl.dat'));

if (runtimePresent && !force) {
    console.log('[vendor] Electron OHOS runtime already present');
    process.exit(0);
}

if (!lock.url) {
    console.error(
        '[vendor] vendor/electron-ohos.lock.json has no url. ' +
            'Set it to the Tesslo release asset URL, or place ' +
            `${path.relative(repoRoot, archivePath)} in the cache before building.`
    );
    process.exit(1);
}

fs.mkdirSync(cacheDir, {recursive: true});

if (!fs.existsSync(archivePath)) {
    console.log(`[vendor] downloading ${lock.url}`);
    const result = spawnSync('curl', ['-L', '--fail', '--retry', '3', '-o', archivePath, lock.url], {
        stdio: 'inherit'
    });
    if (result.status !== 0) {
        console.error('[vendor] download failed');
        process.exit(1);
    }
}

const hash = crypto.createHash('sha256');
hash.update(fs.readFileSync(archivePath));
const actual = hash.digest('hex');
if (actual !== lock.sha256) {
    console.error(`[vendor] sha256 mismatch: expected ${lock.sha256}, got ${actual}`);
    process.exit(1);
}
console.log(`[vendor] verified ${lock.archive}`);

fs.rmSync(extractDir, {recursive: true, force: true});
fs.mkdirSync(extractDir, {recursive: true});

const innerTar = path.join(cacheDir, 'libelectron.tar.gz');
const innerFd = fs.openSync(innerTar, 'w');
const unzip = spawnSync('unzip', ['-p', archivePath, 'libelectron_144.tar.gz'], {
    stdio: ['ignore', innerFd, 'inherit']
});
fs.closeSync(innerFd);
if (unzip.status !== 0) {
    console.error('[vendor] failed to extract libelectron archive');
    process.exit(1);
}

const tar = spawnSync(
    'tar',
    [
        '-xzf',
        innerTar,
        '-C',
        extractDir,
        'libelectron/ohos_hap/electron/libs',
        'libelectron/ohos_hap/web_engine/src/main/resources/resfile'
    ],
    {stdio: 'inherit'}
);
if (tar.status !== 0) {
    console.error('[vendor] failed to extract runtime files');
    process.exit(1);
}

const extracted = path.join(extractDir, 'libelectron/ohos_hap');
fs.rmSync(targetLibs, {recursive: true, force: true});
fs.cpSync(path.join(extracted, 'electron/libs'), targetLibs, {recursive: true});

fs.mkdirSync(targetResfile, {recursive: true});
const extractedResfile = path.join(extracted, 'web_engine/src/main/resources/resfile');
for (const entry of fs.readdirSync(extractedResfile)) {
    if (entry === 'resources') continue;
    fs.cpSync(path.join(extractedResfile, entry), path.join(targetResfile, entry), {
        recursive: true,
        force: true
    });
}

console.log(`[vendor] runtime ${lock.runtimeVersion} staged at ${path.relative(repoRoot, targetLibs)}`);
