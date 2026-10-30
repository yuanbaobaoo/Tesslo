import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// 从 Scratch 公开 CDN 拉取全部离线素材（角色/造型/背景/声音），写入 media/fetched。
// 资产按内容寻址：文件名即内容的 MD5，因此可以直接用文件名校验下载结果。
// 生成结果与 media/manifest.json 的 1328 个文件一一对应。

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const libraryRoot = path.join(repoRoot, 'packages/scratch-gui/src/lib/libraries');
const outputRoot = path.join(repoRoot, 'media/fetched');
const assetHost = 'https://cdn.assets.scratch.mit.edu';
const concurrency = Math.max(1, Number(process.env.MEDIA_FETCH_CONCURRENCY) || 8);
const maxAttempts = 4;

const readLibrary = name => JSON.parse(fs.readFileSync(path.join(libraryRoot, name), 'utf8'));
const collect = (items, set) => {
    for (const item of items) {
        if (item?.md5ext) set.add(item.md5ext);
    }
};

const assets = new Set();
collect(readLibrary('backdrops.json'), assets);
collect(readLibrary('costumes.json'), assets);
collect(readLibrary('sounds.json'), assets);
for (const sprite of readLibrary('sprites.json')) {
    collect(sprite.costumes ?? [], assets);
    collect(sprite.sounds ?? [], assets);
}

const expectedMd5 = name => {
    const dot = name.lastIndexOf('.');
    return dot === -1 ? name : name.slice(0, dot);
};

const fileMd5 = file =>
    new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        const stream = fs.createReadStream(file);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchOne(name) {
    const dest = path.join(outputRoot, name);
    if (fs.existsSync(dest)) {
        if ((await fileMd5(dest)) === expectedMd5(name)) return 'cached';
        fs.rmSync(dest, {force: true});
    }
    const url = `${assetHost}/internalapi/asset/${name}/get/`;
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; ++attempt) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const bytes = Buffer.from(await response.arrayBuffer());
            const digest = crypto.createHash('md5').update(bytes).digest('hex');
            if (digest !== expectedMd5(name)) {
                throw new Error(`MD5 mismatch: expected ${expectedMd5(name)}, got ${digest}`);
            }
            const temp = `${dest}.tmp`;
            fs.writeFileSync(temp, bytes);
            fs.renameSync(temp, dest);
            return 'downloaded';
        } catch (error) {
            lastError = error;
            if (attempt < maxAttempts) await sleep(500 * attempt);
        }
    }
    throw new Error(`${name}: ${lastError.message}`);
}

fs.mkdirSync(outputRoot, {recursive: true});
const names = [...assets].sort();
const counts = {downloaded: 0, cached: 0};
const failures = [];
let next = 0;

const worker = async () => {
    while (next < names.length) {
        const name = names[next++];
        try {
            ++counts[await fetchOne(name)];
        } catch (error) {
            failures.push(error.message);
        }
    }
};

await Promise.all(Array.from({length: concurrency}, worker));

// 只保留当前素材库引用的文件；中断遗留的 .tmp 也在这里清掉。
for (const entry of fs.readdirSync(outputRoot, {withFileTypes: true})) {
    if (!assets.has(entry.name)) {
        fs.rmSync(path.join(outputRoot, entry.name), {recursive: true, force: true});
    }
}

console.log(
    `[media] ${names.length} assets: ${counts.downloaded} downloaded, ` +
        `${counts.cached} cached, ${failures.length} failed`
);
if (failures.length > 0) {
    for (const failure of failures.slice(0, 10)) console.error(`[media] ${failure}`);
    process.exit(1);
}
