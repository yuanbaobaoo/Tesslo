import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const appRoot = path.join(repoRoot, 'apps/tesslo');
export const hapRoot = appRoot;
export const webRoot = path.join(appRoot, 'web');
export const webDist = path.join(webRoot, 'dist');
export const rawfileRoot = path.join(appRoot, 'entry/src/main/resources/rawfile');
export const mediaFetched = path.join(repoRoot, 'media/fetched');
export const bundleName = 'io.github.yuanbaobaoo.tesslo';
export const abilityName = 'EntryAbility';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

export function run(command, args, options = {}) {
    const result = spawnSync(command, args, {stdio: 'inherit', ...options});
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
    }
    return result;
}

export function capture(command, args, options = {}) {
    const result = spawnSync(command, args, {encoding: 'utf8', ...options});
    return result.status === 0 ? result.stdout.trim() : '';
}

export function runPnpm(args, options = {}) {
    return run(pnpm, args, {cwd: repoRoot, ...options});
}

function commandLineToolCandidates() {
    const candidates = [];
    if (process.env.OHOS_COMMAND_LINE_TOOLS_ROOT) {
        candidates.push(process.env.OHOS_COMMAND_LINE_TOOLS_ROOT);
    }
    if (process.env.HOME) {
        candidates.push(path.join(process.env.HOME, 'command-line-tools'));
    }
    const sharedRoot = '/Users/Shared/local/ohos';
    if (fs.existsSync(sharedRoot)) {
        const shared = fs
            .readdirSync(sharedRoot)
            .filter(name => name.startsWith('command-line-tools'))
            .sort()
            .reverse()
            .map(name => path.join(sharedRoot, name));
        candidates.push(...shared);
    }
    const hvigorw = capture('sh', ['-c', 'command -v hvigorw']);
    if (hvigorw) candidates.push(path.resolve(path.dirname(hvigorw), '..'));
    return candidates;
}

export function resolveToolchain() {
    const root = commandLineToolCandidates().find(candidate =>
        fs.existsSync(path.join(candidate, 'bin/hvigorw'))
    );
    if (!root) {
        throw new Error(
            'OHOS command-line-tools not found. Set OHOS_COMMAND_LINE_TOOLS_ROOT, ' +
                'install under ~/command-line-tools, or put hvigorw on PATH.'
        );
    }
    const hdc = path.join(root, 'sdk/default/openharmony/toolchains/hdc');
    if (!fs.existsSync(hdc)) throw new Error(`hdc not found at ${hdc}`);
    const javaCandidates = [
        process.env.JAVA_HOME,
        process.env.HOME && path.join(process.env.HOME, '.sdkman/candidates/java/21.0.11-tem'),
        process.env.HOME && path.join(process.env.HOME, '.sdkman/candidates/java/current')
    ].filter(Boolean);
    const javaHome = javaCandidates.find(candidate => fs.existsSync(path.join(candidate, 'bin/java')));
    const env = {
        ...process.env,
        DEVECO_SDK_HOME: path.join(root, 'sdk'),
        PATH: [
            javaHome && path.join(javaHome, 'bin'),
            path.join(root, 'bin'),
            path.join(root, 'sdk/default/openharmony/toolchains'),
            process.env.PATH
        ]
            .filter(Boolean)
            .join(path.delimiter)
    };
    if (javaHome) env.JAVA_HOME = javaHome;
    return {root, hdc, hvigorw: path.join(root, 'bin/hvigorw'), javaHome, env};
}

export function listDevices(hdc) {
    const output = capture(hdc, ['list', 'targets']);
    return output
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('[') && !/^empty$/i.test(line));
}

function copyDir(source, target) {
    fs.cpSync(source, target, {recursive: true});
}

function removeMaps(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) removeMaps(full);
        else if (entry.isFile() && entry.name.endsWith('.map')) fs.rmSync(full);
    }
}

export function ensureEditorBuild({build = false} = {}) {
    if (build || !fs.existsSync(path.join(webDist, 'index.html'))) {
        runPnpm(['build']);
    }
    if (!fs.existsSync(path.join(webDist, 'index.html'))) {
        throw new Error('web editor bundle is missing; run pnpm build:web');
    }
}

export function stageWebPayload() {
    fs.rmSync(rawfileRoot, {recursive: true, force: true});
    fs.mkdirSync(rawfileRoot, {recursive: true});
    copyDir(webDist, rawfileRoot);
    fs.mkdirSync(path.join(rawfileRoot, 'static'), {recursive: true});
    if (fs.existsSync(mediaFetched)) {
        fs.cpSync(mediaFetched, path.join(rawfileRoot, 'static/fetched'), {recursive: true});
    } else {
        console.warn('[ohos] media/fetched is missing; the offline library will be empty');
    }
    removeMaps(rawfileRoot);
}

export function ensureLink() {
    const dir = path.join(hapRoot, 'entry/libs/arm64-v8a');
    for (const name of ['libtesslolink.so', 'TessloLinkNative.so']) {
        if (!fs.existsSync(path.join(dir, name))) {
            throw new Error(`${name} is missing; run pnpm build:link:csharp first.`);
        }
    }
}

export function ensureProfile() {
    const profile = path.join(hapRoot, 'build-profile.json5');
    if (fs.existsSync(profile)) return;
    const template = path.join(hapRoot, 'build-profile.template.json5');
    if (!fs.existsSync(template)) {
        throw new Error('build-profile.template.json5 is missing');
    }
    fs.copyFileSync(template, profile);
}

export function ensureSigning() {
    const profile = path.join(hapRoot, 'build-profile.json5');
    ensureProfile();
    const text = fs.readFileSync(profile, 'utf8');
    if (!text.includes('signingConfigs')) {
        console.log('[ohos] no signing config; generating debug signing material with devecocli');
        const toolchain = resolveToolchain();
        run('devecocli', ['signature', 'generate', '--product', 'default'], {
            cwd: hapRoot,
            env: {...toolchain.env, DEVECO_CLI_CLT_PATH: toolchain.root}
        });
    }
}

export function findHap({signed = true} = {}) {
    const outputDir = path.join(hapRoot, 'entry/build/default/outputs/default');
    if (!fs.existsSync(outputDir)) return null;
    const haps = fs
        .readdirSync(outputDir)
        .filter(name => name.endsWith('.hap'))
        .map(name => path.join(outputDir, name));
    const signedHap = haps.find(file => file.endsWith('-signed.hap'));
    const unsignedHap = haps.find(file => file.endsWith('-unsigned.hap'));
    return (signed ? signedHap : unsignedHap) || haps[0] || null;
}

export function buildHap({build = false, signed = true} = {}) {
    const toolchain = resolveToolchain();
    ensureEditorBuild({build});
    ensureLink();
    stageWebPayload();
    ensureProfile();
    const profilePath = path.join(hapRoot, 'build-profile.json5');
    const templatePath = path.join(hapRoot, 'build-profile.template.json5');
    let backup = null;
    if (!signed) {
        if (fs.existsSync(profilePath)) {
            backup = `${profilePath}.local`;
            fs.renameSync(profilePath, backup);
        }
        fs.copyFileSync(templatePath, profilePath);
    } else {
        ensureSigning();
    }
    for (const dir of ['.hvigor', 'entry/build']) {
        fs.rmSync(path.join(hapRoot, dir), {recursive: true, force: true});
    }
    console.log('[ohos] hvigor assembleHap');
    try {
        run(
            toolchain.hvigorw,
            ['assembleHap', '--mode', 'module', '-p', 'product=default', '-p', 'buildMode=debug', '--no-daemon'],
            {cwd: hapRoot, env: toolchain.env}
        );
    } finally {
        if (backup) {
            fs.rmSync(profilePath, {force: true});
            fs.renameSync(backup, profilePath);
        }
    }
    const hap = findHap({signed});
    if (!hap) throw new Error('HAP was not produced');
    console.log(`[ohos] HAP: ${hap}`);
    return {hap, toolchain};
}
