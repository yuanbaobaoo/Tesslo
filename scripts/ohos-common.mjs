import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// 仓库与产物路径约定（rawfile、dist 均为构建生成物，不入库）
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 加载仓库根目录的 .env（可选）。已存在的环境变量优先，不会被 .env 覆盖。
// 支持的变量见 .env.example：
//   OHOS_COMMAND_LINE_TOOLS_ROOT / OHOS_SDK_ROOT / DOTNET_ROOT / JAVA_HOME
function loadDotEnv() {
  const envPath = path.join(repoRoot, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
};
loadDotEnv();

// HAP 工程根（hvigor 工作目录）
export const appRoot = path.join(repoRoot, 'apps/tesslo');
export const hapRoot = appRoot;
// 离线编辑器源码与 webpack 产物
export const webRoot = path.join(appRoot, 'web');
export const webDist = path.join(webRoot, 'dist');
// HAP 内置资源目录（构建时生成，不入库）
export const rawfileRoot = path.join(appRoot, 'entry/src/main/resources/rawfile');
// 已入库的离线媒体库源目录（硬链接进 rawfile）
export const mediaFetched = path.join(appRoot, 'assets/fetched');
// 设备上应用包名与入口 Ability（hdc 启动/卸载用）
export const bundleName = 'io.github.yuanbaobaoo.tesslo';
export const abilityName = 'EntryAbility';

// Windows 下 pnpm 是 .cmd，spawnSync 需要显式带后缀
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

/**
 * 同步执行命令并继承输出；非零退出码直接抛错中止构建。
 */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {stdio: 'inherit', ...options});
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
  return result;
}

/**
 * 同步执行并捕获 stdout；失败返回空串（用于探测类命令）。
 */
export function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {encoding: 'utf8', ...options});
  return result.status === 0 ? result.stdout.trim() : '';
}

/**
 * 在仓库根目录执行 pnpm 子命令。
 */
export function runPnpm(args, options = {}) {
  return run(pnpm, args, {cwd: repoRoot, ...options});
}

// 常见安装位置依次探测，找到带 bin/hvigorw 的第一个为止
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

/**
 * 定位 OHOS 命令行工具链与 JDK，返回 hvigorw/hdc 路径和注入好的构建环境变量。
 */
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

/**
 * 解析 hdc list targets 输出，过滤表头与 empty 占位，返回设备序列号列表。
 */
export function listDevices(hdc) {
  const output = capture(hdc, ['list', 'targets']);
  return output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('[') && !/^empty$/i.test(line));
}

// 整目录复制（web/dist -> rawfile 等生成物场景）
function copyDir(source, target) {
  fs.cpSync(source, target, {recursive: true});
}

// 硬链接失败（跨文件系统、Windows 权限、文件系统不支持）时回退为真实复制
function linkOrCopy(source, target) {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  try {
    fs.linkSync(source, target);
  } catch (error) {
    // 跨文件系统、Windows 权限或文件系统不支持硬链接时回退为真实复制。
    fs.copyFileSync(source, target);
  }
}

// 把离线素材以硬链接方式铺进 rawfile：不产生第二份数据。
// rawfile 在 hvigor 打包期间只读；不要在 rawfile 内原地修改素材，
// 否则硬链接会同时改到 apps/tesslo/assets/fetched 的源文件。
function linkDir(source, target) {
  fs.mkdirSync(target, {recursive: true});
  for (const entry of fs.readdirSync(source, {withFileTypes: true})) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) linkDir(from, to);
    else if (entry.isFile()) linkOrCopy(from, to);
    else fs.cpSync(from, to, {recursive: true});
  }
}

// 删除目录树下所有 .map：rawfile 随 HAP 发布，不需要 sourcemap
function removeMaps(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) removeMaps(full);
    else if (entry.isFile() && entry.name.endsWith('.map')) fs.rmSync(full);
  }
}

/**
 * 确保 dist 里有编辑器产物；缺产物或强制 build 时先跑 pnpm build。
 */
export function ensureEditorBuild({build = false} = {}) {
  if (build || !fs.existsSync(path.join(webDist, 'index.html'))) {
    runPnpm(['build']);
  }
  if (!fs.existsSync(path.join(webDist, 'index.html'))) {
    throw new Error('web editor bundle is missing; run pnpm build:web');
  }
}

/**
 * 重建 rawfile：dist 全量拷入 + 离线媒体硬链接铺入 + 清 sourcemap。
 */
export function stageWebPayload() {
  fs.rmSync(rawfileRoot, {recursive: true, force: true});
  fs.mkdirSync(rawfileRoot, {recursive: true});
  copyDir(webDist, rawfileRoot);
  fs.mkdirSync(path.join(rawfileRoot, 'static'), {recursive: true});
  if (fs.existsSync(mediaFetched)) {
    linkDir(mediaFetched, path.join(rawfileRoot, 'static/fetched'));
  } else {
    console.warn('[ohos] apps/tesslo/assets/fetched is missing; the offline library will be empty');
  }
  removeMaps(rawfileRoot);
}

/**
 * 校验 C# Link 两个 .so 已部署到 entry/libs；缺失时提示先跑 build:link:csharp。
 */
export function ensureLink() {
  const dir = path.join(hapRoot, 'entry/libs/arm64-v8a');
  for (const name of ['libtesslolink.so', 'ScratchLinkOhos.so']) {
    if (!fs.existsSync(path.join(dir, name))) {
      throw new Error(`${name} is missing; run pnpm build:link:csharp first.`);
    }
  }
}

/**
 * 保证 build-profile.json5 存在：没有本地配置时从模板复制。
 */
export function ensureProfile() {
  const profile = path.join(hapRoot, 'build-profile.json5');
  if (fs.existsSync(profile)) return;
  const template = path.join(hapRoot, 'build-profile.template.json5');
  if (!fs.existsSync(template)) {
    throw new Error('build-profile.template.json5 is missing');
  }
  fs.copyFileSync(template, profile);
}

/**
 * 签名构建前置：没有签名配置时用 devecocli 生成本地调试签名材料。
 */
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

/**
 * 在产物目录里找 HAP；signed=true 时缺签名包返回 null，绝不回退未签名包。
 */
export function findHap({signed = true} = {}) {
  const outputDir = path.join(hapRoot, 'entry/build/default/outputs/default');
  if (!fs.existsSync(outputDir)) return null;
  const haps = fs
    .readdirSync(outputDir)
    .filter(name => name.endsWith('.hap'))
    .map(name => path.join(outputDir, name));
  const signedHap = haps.find(file => file.endsWith('-signed.hap'));
  const unsignedHap = haps.find(file => file.endsWith('-unsigned.hap'));
  if (signed) {
    // 签名包缺失时不能静默回退到未签名包，否则真机安装会失败且难以定位
    return signedHap || null;
  }
  return unsignedHap || haps[0] || null;
}

/**
 * 完整 HAP 构建：编辑器产物 -> Link .so 校验 -> rawfile 装载 -> hvigor assembleHap。
 * @param {object} opts - build: 是否强制重建编辑器；signed: true 走签名流程，
 *   false 用模板 profile（无签名配置）并在结束后还原本地 profile。
 * @returns {{hap: string, toolchain: object}} 产物路径与工具链信息
 */
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
