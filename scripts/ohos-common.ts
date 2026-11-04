import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {type SpawnSyncOptions, type SpawnSyncReturns, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

import JSON5 from 'json5';

// 仓库与产物路径约定（rawfile、dist 均为构建生成物，不入库）
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// OHOS Native SDK 解析结果：root 为 sdk 根，nativeRoot 已按新旧布局收敛
export interface OhosNativeSdk {
  root: string;
  nativeRoot: string;
}

// resolveToolchain 的返回：CLT 根、关键工具路径与注入好的 hvigor 构建环境
export interface Toolchain {
  root: string;
  // hvigor 调用形态：command + 前置参数。unix 是 [bin/hvigorw]；win32 优先
  // [node, hvigor/bin/hvigorw.js]（CLT 垫片 hvigorw.bat 的规范直调形态），
  // 布局缺失时回退 [bin/hvigorw.bat]（spawn 层自动经 cmd 启动）
  hvigorCommand: string[];
  hdc: string;
  javaHome: string | null;
  env: NodeJS.ProcessEnv;
}

// createPrompts 的返回：TTY/管道两用的行问答接口
export interface Prompts {
  line(prompt: string): Promise<string>;
  password(prompt: string): Promise<string>;
  close(): void;
}

// hvigor 打包模式：hap 产出可单装的 HAP，app 产出上架用 App 包
export type PackageMode = 'hap' | 'app';

// buildPackage 入参
export interface PackageOptions {
  build?: boolean;
  signed?: boolean;
  mode?: PackageMode;
  product?: string;
  // 仅 product=dev 的签名构建：强制重新生成调试签名（devecocli --force）
  resign?: boolean;
  // 签名确实需要生成时先引导登录华为账号（仅 dev:ohos 传入 true，其它入口不开启）
  allowLogin?: boolean;
}

// 打包产物与所用工具链
export interface PackageResult {
  artifact: string;
  toolchain: Toolchain;
}

// 加载仓库根目录的 .env 文件（可选）。已存在的环境变量优先，不会被覆盖。
// 加载顺序：真实环境变量 > .env（用户显式声明） > .env.toolchain（env.mjs 生成）。
// 支持的变量见 .env.example：
//   DEVECO_CLI_CLT_PATH / OHOS_SDK_ROOT / DOTNET_ROOT / JAVA_HOME
//   OHOS_NET_RUNTIME_PACK / TESSLO_TOOLS_BASE_URL
function loadDotEnv(fileName: string): void {
  const envPath = path.join(repoRoot, fileName);
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
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
}
loadDotEnv('.env');
loadDotEnv('.env.toolchain');

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
// 调试身份（dev product）的包名：独立于正式版，可同机共存。须与
// build-profile.template.json5 里 dev product 的 bundleName 一致（ensureDevProduct 校验）
export const devBundleName = 'io.github.yuanbaobaoo.tesslo.dev';
export const abilityName = 'EntryAbility';

// Windows 下 pnpm 是 .cmd，spawnSync 需要显式带后缀
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

/**
 * 统一的 spawn 目标：win32 下 .cmd/.bat 批处理只能经 cmd.exe 启动（Node 对
 * CVE-2024-27980 的修复禁用了直启，否则抛 EINVAL），此时合成单条命令行并开
 * shell；其余平台与普通可执行文件原样返回。批处理路径只用于参数固定的调用
 * （pnpm 脚本名等）；带空格/括号的参数（如 --os-version）一律走 node 直调
 * 入口，不经此分支。
 *
 * @param command - 可执行文件或批处理路径
 * @param args - 参数列表
 * @param platform - 平台标识（便于单测注入）
 * @returns spawnSync 的 command/args/shell 三元组
 */
export function prepareSpawn(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform
): {command: string; args: string[]; shell: boolean} {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(command)) {
    return {command, args, shell: false};
  }
  // cmd 元字符（空格、括号、& 等）需要引号包裹；本仓调用参数受控，无未受信输入
  const quote = (value: string): string => (/[\s&()^"%]/.test(value) ? `"${value}"` : value);
  return {
    command: [quote(command), ...args.map(quote)].join(' '),
    args: [],
    shell: true
  };
}

/**
 * 在目录下按候选顺序探测可执行文件（win32 需要 .exe/.bat 形态，unix 用原始名）。
 *
 * @param dir - 探测目录
 * @param names - 文件名候选（按优先级）
 * @returns 第一个存在的完整路径；都不存在返回 null
 */
export function firstExecutable(dir: string, names: string[]): string | null {
  for (const name of names) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

/**
 * 解析 workspace 内 devecocli 的 node 直调入口：读 @deveco/deveco-cli 的
 * package.json bin 字段（不假设包内布局），跨平台用 process.execPath 启动，
 * 完全绕开 pnpm/.cmd 垫片与 shell 引号问题。
 *
 * @param pkgDir - 包目录（默认 workspace 内的 @deveco/deveco-cli；参数化便于单测）
 * @returns {node, script} 直调入口；包缺失或布局不识别时返回 null（调用方回退 pnpm exec）
 */
export function resolveDevecoEntry(pkgDir = path.join(repoRoot, 'node_modules/@deveco/deveco-cli')): {
  node: string;
  script: string;
} | null {
  interface DevecoPackageJson {
    bin?: string | Record<string, string>;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as DevecoPackageJson;
    const entry = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.devecocli;
    if (typeof entry !== 'string') return null;
    const script = path.join(pkgDir, entry);
    return fs.existsSync(script) ? {node: process.execPath, script} : null;
  } catch {
    return null;
  }
}

/**
 * 同步执行命令并继承输出；非零退出码直接抛错中止构建。win32 下的批处理
 * （.cmd/.bat）经 prepareSpawn 自动转为 cmd.exe 启动。
 *
 * @param command - 可执行文件
 * @param args - 参数列表
 * @param options - spawnSync 透传选项
 * @returns spawnSync 结果（status/stderr 等）
 */
export function run(command: string, args: string[], options: SpawnSyncOptions = {}): SpawnSyncReturns<string | Buffer> {
  const target = prepareSpawn(command, args);
  const {shell} = target;
  const result = spawnSync(target.command, target.args, {stdio: 'inherit', shell, ...options});
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
  return result;
}

/**
 * 同步执行并捕获 stdout；失败返回空串（用于探测类命令）。
 *
 * @param command - 可执行文件
 * @param args - 参数列表
 * @returns 去除首尾空白后的 stdout；非零退出码返回空串
 */
export function capture(command: string, args: string[]): string {
  const target = prepareSpawn(command, args);
  const result = spawnSync(target.command, target.args, {encoding: 'utf-8', shell: target.shell});
  return result.status === 0 ? result.stdout.trim() : '';
}

/**
 * 在仓库根目录执行 pnpm 子命令。
 *
 * @param args - pnpm 参数列表
 * @param options - spawnSync 透传选项
 * @returns spawnSync 结果
 */
export function runPnpm(args: string[], options: SpawnSyncOptions = {}): SpawnSyncReturns<string | Buffer> {
  return run(pnpm, args, {cwd: repoRoot, ...options});
}

/**
 * 提取错误信息文本：catch 的 error 是 unknown，各入口脚本的统一出口格式。
 *
 * @param error - catch 捕获的对象
 * @returns Error.message 或字符串化结果
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// PATH 上的可执行文件定位：unix 用 command -v，win32 用系统内置 where（可能
// 多处命中，取第一行）；where 对无扩展名目标需按 PATHEXT 形态分别探测
function whichOnPath(name: string): string {
  if (process.platform === 'win32') {
    const hits = [name, `${name}.bat`, `${name}.cmd`, `${name}.exe`]
      .map(candidate => capture('where', [candidate]))
      .filter(output => output.length > 0);
    return hits[0]?.split(/\r?\n/)[0] ?? '';
  }
  return capture('sh', ['-c', `command -v ${name}`]);
}

// CLT 位置解析（与 env.mjs 同一套链，不做任何机器路径猜测）：
// 1. DEVECO_CLI_CLT_PATH（devecocli 标准变量；真实环境变量或 .env 显式声明）
// 2. PATH 反推：hvigorw 位于 <clt>/bin，hdc 位于 <clt>/sdk/default/openharmony/toolchains
// 3. .toolchain/command-line-tools（env.mjs 自愈安装的约定落点）
function commandLineToolCandidates(): string[] {
  const candidates: string[] = [];
  if (process.env.DEVECO_CLI_CLT_PATH) {
    candidates.push(process.env.DEVECO_CLI_CLT_PATH);
  }
  const hvigorw = whichOnPath('hvigorw');
  if (hvigorw) candidates.push(path.resolve(path.dirname(hvigorw), '..'));
  const hdc = whichOnPath('hdc');
  if (hdc) candidates.push(path.resolve(path.dirname(hdc), '../../../..'));
  candidates.push(path.join(repoRoot, '.toolchain/command-line-tools'));
  return candidates;
}

// Native SDK 锚点（新旧 SDK 布局两种位置）
function hasNativeSdkAnchor(root: string): boolean {
  return (
    fs.existsSync(path.join(root, 'openharmony/native/oh-uni-package.json')) ||
    fs.existsSync(path.join(root, 'native/oh-uni-package.json'))
  );
}

/**
 * 解析 OHOS Native SDK 根（openharmony 交叉工具链），供 build:link:csharp 使用。
 * 候选链：OHOS_SDK_ROOT 显式声明 → CLT 根推导（<clt>/sdk/default）。
 * 与 CLT 同理不做机器路径猜测。
 *
 * @returns SDK 根与 native 子目录；找不到返回 null，由调用方给出设置指引
 */
export function resolveOhosNativeSdk(): OhosNativeSdk | null {
  const candidates: string[] = [];
  if (process.env.OHOS_SDK_ROOT) candidates.push(process.env.OHOS_SDK_ROOT);
  for (const clt of commandLineToolCandidates()) {
    candidates.push(path.join(clt, 'sdk/default'));
  }
  const root = candidates.find(hasNativeSdkAnchor);
  if (!root) return null;
  return {
    root,
    // SDK 新旧布局兼容：native 可能在 openharmony/ 下或直接在根下
    nativeRoot: fs.existsSync(path.join(root, 'openharmony/native'))
      ? path.join(root, 'openharmony/native')
      : path.join(root, 'native')
  };
}

/**
 * 定位 OHOS 命令行工具链与 JDK，返回 hvigor/hdc 调用形态和注入好的构建环境变量。
 * 可执行文件按候选链探测（win32 带 .exe/.bat 形态），不依赖单机布局。
 *
 * @returns 工具链路径与构建环境；找不到时抛错并给出设置指引
 */
export function resolveToolchain(): Toolchain {
  // CLT 根锚点：bin/hvigorw（bash 垫片，两种平台的发行包都带）
  const root = commandLineToolCandidates().find(candidate =>
    fs.existsSync(path.join(candidate, 'bin/hvigorw'))
  );
  if (!root) {
    throw new Error(
      'OHOS command-line-tools not found. Set DEVECO_CLI_CLT_PATH ' +
        '(in .env or environment), run `pnpm env:install clt`, or put hvigorw on PATH.'
    );
  }
  const hdc = firstExecutable(path.join(root, 'sdk/default/openharmony/toolchains'), ['hdc', 'hdc.exe']);
  if (!hdc) throw new Error(`hdc not found under ${path.join(root, 'sdk/default/openharmony/toolchains')}`);
  // hvigor 启动形态：unix 用 bin/hvigorw 垫片（现行为）；win32 优先 node 直调
  // hvigor/bin/hvigorw.js（hvigorw.bat 的规范形态，参数不经 shell），垫片布局
  // 缺失时回退 bin/hvigorw.bat（spawn 层自动经 cmd 启动）
  const hvigorJs = path.join(root, 'hvigor/bin/hvigorw.js');
  const hvigorCommand =
    process.platform === 'win32'
      ? fs.existsSync(hvigorJs)
        ? [process.execPath, hvigorJs]
        : [path.join(root, 'bin/hvigorw.bat')]
      : [path.join(root, 'bin/hvigorw')];
  const javaCandidates = [
    process.env.JAVA_HOME,
    process.env.HOME && path.join(process.env.HOME, '.sdkman/candidates/java/21.0.11-tem'),
    process.env.HOME && path.join(process.env.HOME, '.sdkman/candidates/java/current')
  ].filter((candidate): candidate is string => Boolean(candidate));
  const javaHome =
    javaCandidates.find(candidate => firstExecutable(path.join(candidate, 'bin'), ['java', 'java.exe'])) ?? null;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DEVECO_SDK_HOME: path.join(root, 'sdk'),
    PATH: [
      javaHome && path.join(javaHome, 'bin'),
      path.join(root, 'bin'),
      path.join(root, 'sdk/default/openharmony/toolchains'),
      process.env.PATH
    ]
      .filter((entry): entry is string => Boolean(entry))
      .join(path.delimiter)
  };
  if (javaHome) env.JAVA_HOME = javaHome;
  return {root, hvigorCommand, hdc, javaHome, env};
}

/**
 * 解析 hdc list targets 输出，过滤表头与 empty 占位，返回设备序列号列表。
 *
 * @param hdc - hdc 可执行文件路径
 * @returns 设备序列号列表
 */
export function listDevices(hdc: string): string[] {
  const output = capture(hdc, ['list', 'targets']);
  return output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('[') && !/^empty$/i.test(line));
}

// 整目录复制（web/dist -> rawfile 等生成物场景）
function copyDir(source: string, target: string): void {
  fs.cpSync(source, target, {recursive: true});
}

// 硬链接失败（跨文件系统、Windows 权限、文件系统不支持）时回退为真实复制
function linkOrCopy(source: string, target: string): void {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  try {
    fs.linkSync(source, target);
  } catch {
    // 跨文件系统、Windows 权限或文件系统不支持硬链接时回退为真实复制。
    fs.copyFileSync(source, target);
  }
}

// 把离线素材以硬链接方式铺进 rawfile：不产生第二份数据。
// rawfile 在 hvigor 打包期间只读；不要在 rawfile 内原地修改素材，
// 否则硬链接会同时改到 apps/tesslo/assets/fetched 的源文件。
function linkDir(source: string, target: string): void {
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
function removeMaps(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) removeMaps(full);
    else if (entry.isFile() && entry.name.endsWith('.map')) fs.rmSync(full);
  }
}

/**
 * 确保 dist 里有编辑器产物；缺产物或强制 build 时先跑 build:editor + build:web。
 *
 * @param opts.build - true 时强制重建编辑器产物
 */
export function ensureEditorBuild({build = false}: {build?: boolean} = {}): void {
  if (build || !fs.existsSync(path.join(webDist, 'index.html'))) {
    runPnpm(['build:editor']);
    runPnpm(['build:web']);
  }
  if (!fs.existsSync(path.join(webDist, 'index.html'))) {
    throw new Error('web editor bundle is missing; run pnpm build:web');
  }
}

/**
 * 重建 rawfile：dist 全量拷入 + 离线媒体硬链接铺入 + 清 sourcemap。
 */
export function stageWebPayload(): void {
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
export function ensureLink(): void {
  const dir = path.join(hapRoot, 'entry/libs/arm64-v8a');
  for (const name of ['libtesslolink.so', 'ScratchLinkOhos.so']) {
    if (!fs.existsSync(path.join(dir, name))) {
      throw new Error(`${name} is missing; run pnpm build:link:csharp first.`);
    }
  }
}

/**
 * 自恢复版 ensureLink：.so 被 gitignore，新克隆必然缺失，此时自动补跑
 * build:link:csharp（其自身会先走 env.mjs ensure --for link 自愈工具链）。
 */
export function ensureLinkOrBuild(): void {
  const dir = path.join(hapRoot, 'entry/libs/arm64-v8a');
  const missing = ['libtesslolink.so', 'ScratchLinkOhos.so'].filter(
    name => !fs.existsSync(path.join(dir, name))
  );
  if (!missing.length) return;
  console.log(`[ohos] ${missing.join('、')} 缺失；自动执行 pnpm build:link:csharp`);
  runPnpm(['build:link:csharp']);
  ensureLink();
}

/**
 * 保证 build-profile.json5 存在：没有本地配置时从模板复制。
 */
export function ensureProfile(): void {
  const profile = path.join(hapRoot, 'build-profile.json5');
  if (fs.existsSync(profile)) return;
  const template = path.join(hapRoot, 'build-profile.template.json5');
  if (!fs.existsSync(template)) {
    throw new Error('build-profile.template.json5 is missing');
  }
  fs.copyFileSync(template, profile);
}

// build-profile.json5 中本脚本读写的结构；其余字段经 JSON5 往返原样保留
interface BuildProduct {
  name: string;
  bundleName?: string;
  signingConfig?: string;
  [key: string]: unknown;
}

interface BuildSigningConfig {
  name: string;
  material?: {certpath?: string; profile?: string; storeFile?: string; [key: string]: unknown};
  [key: string]: unknown;
}

interface BuildModuleTarget {
  name: string;
  [key: string]: unknown;
}

interface BuildProfile {
  app: {
    products?: BuildProduct[];
    signingConfigs?: BuildSigningConfig[];
    [key: string]: unknown;
  };
  modules?: Array<{name: string; targets?: BuildModuleTarget[]; [key: string]: unknown}>;
  [key: string]: unknown;
}

// p7b 内嵌 JSON 中与调试签名有效性相关的字段（JSON.parse 结果按此断言）
interface RawDebugProfile {
  'bundle-info'?: {'bundle-name'?: string};
  validity?: {'not-after'?: number};
  'debug-info'?: {'device-ids'?: string[]};
}

// 调试 profile 的有效性信息
interface DebugProfileInfo {
  bundleName: string | null;
  // 失效时间（秒级时间戳），缺失为 null
  notAfter: number | null;
  // 已授权设备的 UDID（统一大写）
  deviceIds: string[];
}

// 本机构建配置（gitignored）、其模板与 App 级配置
const buildProfilePath = path.join(hapRoot, 'build-profile.json5');
const buildProfileTemplatePath = path.join(hapRoot, 'build-profile.template.json5');
const appJsonPath = path.join(hapRoot, 'AppScope/app.json5');

// 解析 build-profile（本机文件或模板）
function readBuildProfile(file: string): BuildProfile {
  return JSON5.parse<BuildProfile>(fs.readFileSync(file, 'utf8'));
}

/**
 * 把模板里的 dev product 与 entry 的 dev target 补进构建配置（原地修改），并校验
 * dev product 的包名。已存在的条目保持原样（含 devecocli 回填的 signingConfig）。
 *
 * @param profile - 本机 build-profile 解析结果
 * @param template - build-profile 模板解析结果
 * @returns 补入的条目说明；已齐全时为空数组
 */
export function mergeDevProduct(profile: BuildProfile, template: BuildProfile): string[] {
  const devProduct = template.app.products?.find(item => item.name === 'dev');
  const devTarget = template.modules
    ?.find(item => item.name === 'entry')
    ?.targets?.find(item => item.name === 'dev');
  if (!devProduct || !devTarget) {
    throw new Error('build-profile.template.json5 缺少 dev product 或 entry 的 dev target');
  }
  const entry = profile.modules?.find(item => item.name === 'entry');
  if (!entry) throw new Error('build-profile.json5: modules 里没有 entry 模块');
  const products = (profile.app.products ??= []);
  const targets = (entry.targets ??= []);
  const added: string[] = [];
  if (!products.some(item => item.name === 'dev')) {
    products.push(devProduct);
    added.push('dev product');
  }
  if (!targets.some(item => item.name === 'dev')) {
    targets.push(devTarget);
    added.push('entry 的 dev target');
  }
  const devName = products.find(item => item.name === 'dev')?.bundleName;
  if (devName !== devBundleName) {
    throw new Error(`build-profile.json5 中 dev product 的包名是 ${devName}，应为 ${devBundleName}`);
  }
  return added;
}

/**
 * 本机 build-profile.json5 补齐 dev 定义。本机配置被 gitignore，早于模板改动生成的
 * 那份不会自动带上 dev product/target：缺失时从模板补入（JSON5 序列化，与 devecocli
 * 回写同一格式）；已齐全时不改文件。
 */
export function ensureDevProduct(): void {
  ensureProfile();
  const profile = readBuildProfile(buildProfilePath);
  const added = mergeDevProduct(profile, readBuildProfile(buildProfileTemplatePath));
  if (added.length) {
    fs.writeFileSync(buildProfilePath, JSON5.stringify(profile, null, 2));
    console.log(`[ohos] build-profile.json5 已从模板补齐：${added.join('、')}`);
  }
}

/**
 * 读取调试 profile（p7b）内嵌的 JSON：PKCS#7 的 content 是连续的 JSON 字节，
 * 从首个 `{"` 起按引号感知的括号配对截取（与 devecocli 的提取方式一致）。
 *
 * @param file - .p7b 路径
 * @returns 包名、失效时间与已授权设备；无法解析返回 null
 */
export function readDebugProfile(file: string): DebugProfileInfo | null {
  const raw = fs.readFileSync(file, 'latin1');
  const start = raw.indexOf('{"');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}' && --depth === 0) {
      try {
        const json = JSON.parse(raw.slice(start, i + 1)) as RawDebugProfile;
        return {
          bundleName: json['bundle-info']?.['bundle-name'] ?? null,
          notAfter: json.validity?.['not-after'] ?? null,
          deviceIds: (json['debug-info']?.['device-ids'] ?? []).map(id => id.toUpperCase())
        };
      } catch {
        return null;
      }
    }
  }
  return null;
}

// 设备 UDID（调试 profile 按 UDID 授权设备）；查询失败返回 null
function deviceUdid(hdc: string, serial: string): string | null {
  const output = capture(hdc, ['-t', serial, 'shell', 'bm', 'get', '--udid']);
  return output.match(/[0-9A-Fa-f]{64}/)?.[0].toUpperCase() ?? null;
}

/**
 * 检查本机 dev 调试签名是否可用。只读本地文件与已连接设备，不访问 AGC。
 *
 * @param hdc - hdc 路径（查询已连接设备的 UDID）
 * @returns 需要重新生成的原因；可用时返回 null
 */
function devSigningProblem(hdc: string): string | null {
  const profile = readBuildProfile(buildProfilePath);
  const config = profile.app.signingConfigs?.find(item => item.name === 'dev');
  const product = profile.app.products?.find(item => item.name === 'dev');
  if (!config || product?.signingConfig !== 'dev') return '尚未生成';
  const {certpath, storeFile, profile: profileFile} = config.material ?? {};
  if (!certpath || !storeFile || !profileFile || ![certpath, storeFile, profileFile].every(file => fs.existsSync(file))) {
    return '签名材料文件缺失';
  }
  const info = readDebugProfile(profileFile);
  if (!info) return 'profile 无法解析';
  if (info.bundleName !== devBundleName) return `profile 绑定的包名是 ${info.bundleName ?? '未知'}`;
  if (info.notAfter !== null && info.notAfter * 1000 <= Date.now()) return 'profile 已过期';
  const unregistered = listDevices(hdc).filter(serial => {
    const udid = deviceUdid(hdc, serial);
    return udid !== null && !info.deviceIds.includes(udid);
  });
  if (unregistered.length) return `设备 ${unregistered.join('、')} 未注册在 profile 中`;
  return null;
}

/**
 * 临时把 AppScope/app.json5 的包名换成 name，执行 action 后还原。只服务 devecocli
 * 签名生成：它只认这里的原始包名（不认 product 级 bundleName）；构建本身靠 product
 * 覆盖，不改源文件。期间接管 SIGINT/SIGTERM，使同步子进程被中断后 finally 仍能
 * 还原；被强杀的残留由 healAppBundleName 在下次打包前修复。
 */
function withAppBundleName(name: string, action: () => void): void {
  const original = fs.readFileSync(appJsonPath, 'utf8');
  const from = `"bundleName": "${bundleName}"`;
  if (!original.includes(from)) throw new Error(`AppScope/app.json5 中没有 ${from}`);
  const keepAlive = (): void => {};
  process.on('SIGINT', keepAlive);
  process.on('SIGTERM', keepAlive);
  fs.writeFileSync(appJsonPath, original.replace(from, `"bundleName": "${name}"`));
  try {
    action();
  } finally {
    fs.writeFileSync(appJsonPath, original);
    process.off('SIGINT', keepAlive);
    process.off('SIGTERM', keepAlive);
  }
}

/**
 * 修复中断残留：AppScope/app.json5 的包名停在 dev（签名生成被强杀）时改回正式
 * 包名。每次打包前调用，保证上架包与 CI 产物始终是正式包名。
 */
export function healAppBundleName(): void {
  const text = fs.readFileSync(appJsonPath, 'utf8');
  const stale = `"bundleName": "${devBundleName}"`;
  if (!text.includes(stale)) return;
  fs.writeFileSync(appJsonPath, text.replace(stale, `"bundleName": "${bundleName}"`));
  console.warn('[ohos] AppScope/app.json5 残留 dev 包名（上次签名生成被中断），已改回正式包名');
}

/**
 * dev product 的调试签名前置：缺失、失效（包名不符/过期/有已连接设备未注册）或
 * resign 时，用 devecocli 自动签名重新生成，signingConfig 'dev' 回填到本机
 * build-profile。签名可用时只读本地文件与设备，不访问 AGC。
 *
 * devecocli 每次生成都会删除并重建账号共用的 auto_debug 调试证书，同一时刻只有一套
 * 自动签名材料有效，所以只让 dev 使用自动签名（正式包名只走 release 手工签名）。
 * devecocli 是 workspace devDependency，经 pnpm exec 调用，不依赖全局安装。
 *
 * @param opts.toolchain - 已解析的工具链（hdc 与 devecocli 运行环境）
 * @param opts.resign - true 时强制重新生成（devecocli --force）
 * @param opts.allowLogin - true 时在生成前引导登录（ensureAuth）；仅 dev:ohos 开启
 */
export function ensureDevSigning({toolchain, resign = false, allowLogin = false}: {
  toolchain: Toolchain;
  resign?: boolean;
  allowLogin?: boolean;
}): void {
  ensureDevProduct();
  const reason = resign ? '--resign' : devSigningProblem(toolchain.hdc);
  if (!reason) return;
  if (listDevices(toolchain.hdc).length === 0) {
    throw new Error(`dev 调试签名需要生成（${reason}），但没有已连接的设备：devecocli 生成时要注册设备 UDID`);
  }
  // 登录判断只挂在"确实要生成签名"之前：材料有效时跳过，保持离线
  if (allowLogin) ensureAuth(toolchain);
  console.log(`[ohos] dev 调试签名需要生成（${reason}）：devecocli signature generate --product dev`);
  withAppBundleName(devBundleName, () => {
    devecoRun(toolchain, ['signature', 'generate', '--product', 'dev', ...(resign ? ['--force'] : [])]);
  });
  const remaining = devSigningProblem(toolchain.hdc);
  if (remaining) {
    throw new Error(`devecocli 执行后 dev 调试签名仍不可用（${remaining}）；可加 --resign 强制重签`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// devecocli 登录与模拟器（仅 dev:ohos 触发；build:hap / build:app 不使用本节）

// 模拟器启动后等待 hdc 识别的轮询参数：emulator start 内部只等 60s 且超时仅警告
// （退出码仍为 0），脚本必须自己再确认
const EMULATOR_POLL_INTERVAL_MS = 2000;
const EMULATOR_POLL_TIMEOUT_MS = 180000;

// auth status 输出解析结果
export interface AuthStatus {
  loggedIn: boolean;
  // 已登录时的账号名（devecocli 输出可能带掩码，如 天府盐****）；未登录为 null
  userName: string | null;
}

// emulator list --format json 的实例条目（字段为 devecocli 归一化后的形态）
export interface EmulatorInstance {
  name: string;
  // 'running' | 'stopped'
  status: string;
  // 运行中实例对应的 hdc 序列号；stopped 为 null
  serial: string | null;
  deviceType: string | null;
  osVersion: string | null;
}

// emulator image list --format json 的镜像条目（downloaded 已归一化为布尔）
export interface EmulatorImage {
  deviceType: string;
  osVersion: string;
  downloaded: boolean;
}

// dev:ohos 的模拟器参数（--emulator / --emulator-device-type / --emulator-os-version / --no-emulator）
export interface EmulatorOptions {
  // --emulator <name>：直接启动指定实例
  emulator: string | undefined;
  // --emulator-device-type <t>：创建时的设备类型（须与 --emulator-os-version 成对）
  deviceType: string | undefined;
  // --emulator-os-version <v>：创建时的系统版本（须与 --emulator-device-type 成对）
  osVersion: string | undefined;
  // --no-emulator：禁止自动启动/创建，无设备直接报错
  disabled: boolean;
}

/**
 * 解析 `devecocli auth status` 的输出。两种状态退出码都是 0，只能靠输出区分：
 * 未登录打印 `Not logged in`，已登录打印 `Current user: <名称>`。
 *
 * @param output - auth status 的 stdout
 * @returns 登录态与账号名；输出不含任一标记时按未登录处理，由调用方复查后报错
 */
export function parseAuthStatus(output: string): AuthStatus {
  if (output.includes('Not logged in')) return {loggedIn: false, userName: null};
  const match = output.match(/Current user:\s*(.+)/);
  if (match) return {loggedIn: true, userName: match[1].trim()};
  return {loggedIn: false, userName: null};
}

// 从可能混有 pnpm 前缀噪声的输出中提取 JSON 数组：直接 parse 失败时回退为
// 截取首个 `[` 到最后一个 `]` 的片段再试；仍失败返回 null
function extractJsonArray(output: string): unknown[] | null {
  const attempt = (candidate: string): unknown[] | null => {
    try {
      const parsed: unknown = JSON.parse(candidate);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };
  const text = output.trim();
  if (!text) return null;
  const direct = attempt(text);
  if (direct) return direct;
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  return attempt(text.slice(start, end + 1));
}

/**
 * 解析 `devecocli emulator list --format json` 的 stdout。
 *
 * @param output - 命令 stdout
 * @returns 实例列表（无实例为空数组）；输出不是 JSON 数组时返回 null，
 *   表示命令不可用或形态异常（与"没有实例"区分）
 */
export function parseEmulatorList(output: string): EmulatorInstance[] | null {
  const raw = extractJsonArray(output);
  if (!raw) return null;
  const instances: EmulatorInstance[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null;
    // JSON 边界断言：随后逐项校验再收敛到 EmulatorInstance
    const record = item as Record<string, unknown>;
    const {name, status, serial, deviceType, osVersion} = record;
    if (typeof name !== 'string' || !name || typeof status !== 'string') return null;
    instances.push({
      name,
      status,
      serial: typeof serial === 'string' ? serial : null,
      deviceType: typeof deviceType === 'string' ? deviceType : null,
      osVersion: typeof osVersion === 'string' ? osVersion : null
    });
  }
  return instances;
}

// 镜像 JSON 的字段名变体：不同版本工具链输出大小写/命名不一致，
// 与 devecocli 自身渲染表格时的取值口径保持一致
const IMAGE_FIELD_VARIANTS = {
  osVersion: ['osVersion', 'OsVersion', 'OSVersion', 'os_version'],
  deviceType: ['deviceType', 'DeviceType', 'device_type'],
  downloaded: ['downloaded', 'Downloaded', 'isDownloaded']
} as const;

// 取镜像记录里第一个存在的字段变体
function pickImageField(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (key in record) return record[key];
  }
  return undefined;
}

// downloaded 字段容忍 boolean 与字符串 "true"/"false"（devecocli 输出两种形态）
function normalizeFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return false;
}

/**
 * 解析 `devecocli emulator image list --all --format json` 的 stdout。
 * 该命令原样透传工具链的 JSON，字段名有大小写/下划线变体；缺 osVersion 或
 * deviceType 的记录（无法参与选择）跳过，输出不是 JSON 数组时返回 null。
 *
 * @param output - 命令 stdout
 * @returns 镜像列表；不可解析时返回 null
 */
export function parseEmulatorImages(output: string): EmulatorImage[] | null {
  const raw = extractJsonArray(output);
  if (!raw) return null;
  const images: EmulatorImage[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    // JSON 边界断言：字段逐项校验后再使用
    const record = item as Record<string, unknown>;
    const osVersion = pickImageField(record, IMAGE_FIELD_VARIANTS.osVersion);
    const deviceType = pickImageField(record, IMAGE_FIELD_VARIANTS.deviceType);
    if (typeof osVersion !== 'string' || !osVersion.trim()) continue;
    if (typeof deviceType !== 'string' || !deviceType.trim()) continue;
    images.push({
      deviceType: deviceType.trim(),
      osVersion: osVersion.trim(),
      downloaded: normalizeFlag(pickImageField(record, IMAGE_FIELD_VARIANTS.downloaded))
    });
  }
  return images;
}

/**
 * 挑选可自动启动的实例：status=stopped 且 deviceType 在应用支持的类型内，取第一个。
 *
 * @param instances - emulator list 实例
 * @param deviceTypes - module.json5 声明的设备类型（2in1 / tablet）
 * @returns 选中的实例；没有候选时返回 null
 */
export function selectStartableEmulator(instances: EmulatorInstance[], deviceTypes: string[]): EmulatorInstance | null {
  return (
    instances.find(
      item => item.status === 'stopped' && item.deviceType !== null && deviceTypes.includes(item.deviceType)
    ) ?? null
  );
}

// 实例名收敛到小写字母数字与连字符：devecocli 未公开命名规则，用最保守字符集
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * 生成默认实例名 `tesslo-<deviceType>-<version>`；与现有实例重名时追加序号。
 *
 * @param deviceType - 设备类型（2in1 / tablet）
 * @param osVersion - 镜像版本原文（如 "HarmonyOS 6.0.1(21)"）
 * @param existing - 现有实例名列表
 * @returns 未冲突的实例名
 */
export function suggestEmulatorName(deviceType: string, osVersion: string, existing: string[]): string {
  const base = `tesslo-${slugify(deviceType)}-${slugify(osVersion)}`;
  if (!existing.includes(base)) return base;
  for (let index = 2; ; index++) {
    const candidate = `${base}-${index}`;
    if (!existing.includes(candidate)) return candidate;
  }
}

/**
 * 解析 dev:ohos 的模拟器参数并校验组合约束。
 *
 * @param argv - 命令行参数原样列表
 * @returns 归一化后的模拟器参数
 */
export function parseEmulatorArgs(argv: string[]): EmulatorOptions {
  const valueOf = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    if (index === -1) return undefined;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag} 需要一个取值参数`);
    }
    return value;
  };
  const options: EmulatorOptions = {
    emulator: valueOf('--emulator'),
    deviceType: valueOf('--emulator-device-type'),
    osVersion: valueOf('--emulator-os-version'),
    disabled: argv.includes('--no-emulator')
  };
  const hasFlags = [options.emulator, options.deviceType, options.osVersion].some(value => value !== undefined);
  if (options.disabled && hasFlags) {
    throw new Error('--no-emulator 不能与 --emulator / --emulator-device-type / --emulator-os-version 同时使用');
  }
  if ((options.deviceType === undefined) !== (options.osVersion === undefined)) {
    throw new Error('--emulator-device-type 与 --emulator-os-version 必须成对使用');
  }
  return options;
}

// devecocli 调用环境：与签名生成同一注入（CLT 根 + 工具链 PATH）
function devecoEnv(toolchain: Toolchain): NodeJS.ProcessEnv {
  return {...toolchain.env, DEVECO_CLI_CLT_PATH: toolchain.root};
}

// devecocli 的调用形态：command + 前置参数。优先 node 直调包内 bin 入口
// （resolveDevecoEntry，跨平台一致、参数不经 shell）；包布局不识别时回退
// pnpm exec（win32 下 pnpm.cmd 经 prepareSpawn 自动 shell 化）
function devecoInvocation(toolchain: Toolchain): {command: string; prefix: string[]; env: NodeJS.ProcessEnv} {
  const env = devecoEnv(toolchain);
  const entry = resolveDevecoEntry();
  if (entry) {
    return {command: entry.node, prefix: [entry.script], env};
  }
  return {command: pnpm, prefix: ['exec', 'devecocli'], env};
}

/**
 * 同步调用 devecocli，输出直接透传（登录、镜像下载等需要用户实时看到进度的
 * 命令）。优先 node 直调真实入口，绕开 pnpm 与 .cmd 垫片。
 *
 * @param toolchain - 已解析的工具链
 * @param args - devecocli 参数列表
 * @returns spawnSync 结果；非零退出码由 run 抛错
 */
function devecoRun(toolchain: Toolchain, args: string[]): SpawnSyncReturns<string | Buffer> {
  const invocation = devecoInvocation(toolchain);
  return run(invocation.command, [...invocation.prefix, ...args], {
    cwd: hapRoot,
    env: invocation.env
  });
}

// devecoCapture 的返回：退出码、stdout 与合并输出（探测类命令用）
interface DevecoCaptureResult {
  status: number | null;
  stdout: string;
  output: string;
}

/**
 * 同步调用 devecocli 并捕获输出（不透传）。用于 auth status / emulator list
 * 这类要按内容分支的探测命令。
 *
 * @param toolchain - 已解析的工具链
 * @param args - devecocli 参数列表
 * @returns 退出码、stdout 与 stdout+stderr 合并输出
 */
function devecoCapture(toolchain: Toolchain, args: string[]): DevecoCaptureResult {
  const invocation = devecoInvocation(toolchain);
  const target = prepareSpawn(invocation.command, [...invocation.prefix, ...args]);
  const result = spawnSync(target.command, target.args, {
    cwd: hapRoot,
    encoding: 'utf-8',
    env: invocation.env,
    shell: target.shell
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`
  };
}

/**
 * 同步调用 devecocli：捕获输出后原样回显。emulator create/start 这类既要让用户
 * 看到失败详情、又要识别协议错误的命令用；失败时抛错并附带协议指引。
 *
 * @param toolchain - 已解析的工具链
 * @param args - devecocli 参数列表
 */
function devecoRunEcho(toolchain: Toolchain, args: string[]): void {
  const invocation = devecoInvocation(toolchain);
  const target = prepareSpawn(invocation.command, [...invocation.prefix, ...args]);
  const result = spawnSync(target.command, target.args, {
    cwd: hapRoot,
    encoding: 'utf-8',
    env: invocation.env,
    shell: target.shell
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    // 协议未接受时报 EmulatorLicenseBlockedError：只提示用户自行阅读接受，不代签
    const licenseHint = /EmulatorLicenseBlockedError|emulator license/i.test(output)
      ? '；模拟器协议尚未接受：请先运行 devecocli emulator license（交互阅读）或 ' +
        'devecocli emulator license accept 后重跑，本脚本不代替用户接受协议'
      : '';
    throw new Error(`devecocli ${args.join(' ')} 失败（exit ${result.status}）${licenseHint}\n${output.trim()}`);
  }
}

// 同步休眠：脚本链路全程同步（spawnSync），用 Atomics.wait 避免忙等
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// 终端可交互判定：登录引导与交互菜单都需要真实 TTY
function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/**
 * 确保 devecocli 已登录华为账号（签名生成前调用）。已登录直接返回；未登录时
 * 提示用户按回车，由 devecocli auth login 自己拉起浏览器等待回调（stdio 继承，
 * 回车与浏览器交互都交给 devecocli）；无终端可交互时报错给出指引。
 *
 * @param toolchain - 已解析的工具链（devecocli 运行环境）
 */
export function ensureAuth(toolchain: Toolchain): void {
  const status = devecoCapture(toolchain, ['auth', 'status']);
  if (status.status !== 0) {
    throw new Error(`devecocli auth status 异常（exit ${status.status}）：${status.output.trim()}`);
  }
  const parsed = parseAuthStatus(status.stdout);
  if (parsed.loggedIn) {
    console.log(`[ohos] devecocli 已登录：${parsed.userName}`);
    return;
  }
  if (!isInteractive()) {
    throw new Error(
      '生成 dev 调试签名需要登录华为账号，但当前无终端可交互：' +
        '请在带浏览器的机器上执行 devecocli auth login 完成登录后重跑'
    );
  }
  console.log('需要登录华为账号：按回车后 devecocli 会打开浏览器完成登录（Ctrl-C 取消，默认等待 10 分钟）');
  devecoRun(toolchain, ['auth', 'login']);
  const after = devecoCapture(toolchain, ['auth', 'status']);
  const reparsed = after.status === 0 ? parseAuthStatus(after.stdout) : null;
  if (!reparsed?.loggedIn) {
    throw new Error('登录未完成：可重跑 dev:ohos，或先手动执行 devecocli auth login');
  }
  console.log(`[ohos] devecocli 已登录：${reparsed.userName}`);
}

/**
 * 列出本机模拟器实例。命令失败（未装 DevEco Studio、平台不支持如 Linux）或输出
 * 不可解析时返回 null，表示"模拟器能力不可用"，与"没有实例"（空数组）区分。
 *
 * @param toolchain - 已解析的工具链
 * @returns 实例列表；能力不可用时返回 null
 */
function listEmulatorInstances(toolchain: Toolchain): EmulatorInstance[] | null {
  const result = devecoCapture(toolchain, ['emulator', 'list', '--format', 'json']);
  if (result.status !== 0) return null;
  return parseEmulatorList(result.stdout);
}

/**
 * 列出指定设备类型的系统镜像（含未下载）。
 *
 * @param toolchain - 已解析的工具链
 * @param deviceType - 设备类型；undefined 时列出全部
 * @returns 镜像列表；能力不可用或不可解析时返回 null
 */
function listEmulatorImages(toolchain: Toolchain, deviceType?: string): EmulatorImage[] | null {
  const args = ['emulator', 'image', 'list', '--all', '--format', 'json'];
  if (deviceType !== undefined) args.push('--device-type', deviceType);
  const result = devecoCapture(toolchain, args);
  if (result.status !== 0) return null;
  return parseEmulatorImages(result.stdout);
}

// 轮询 hdc list targets（EMULATOR_POLL_INTERVAL_MS 间隔，最长 EMULATOR_POLL_TIMEOUT_MS）；
// 超时抛错并给出重跑与 DevEco Studio 指引
function pollForDevice(toolchain: Toolchain): void {
  process.stdout.write('[ohos] 等待设备出现在 hdc list targets');
  const deadline = Date.now() + EMULATOR_POLL_TIMEOUT_MS;
  while (listDevices(toolchain.hdc).length === 0) {
    if (Date.now() >= deadline) {
      process.stdout.write('\n');
      throw new Error(
        `${EMULATOR_POLL_TIMEOUT_MS / 1000}s 内没有设备出现在 hdc list targets；` +
          '可重跑 dev:ohos，或执行 devecocli emulator list 检查实例、' +
          '用 DevEco Studio 设备管理器启动'
      );
    }
    process.stdout.write('.');
    sleepSync(EMULATOR_POLL_INTERVAL_MS);
  }
  process.stdout.write('\n');
}

// 启动实例并轮询 hdc 确认（emulator start 超时只警告，必须自行确认）
function startEmulatorAndWait(toolchain: Toolchain, name: string): void {
  console.log(`[ohos] devecocli emulator start ${name}`);
  devecoRunEcho(toolchain, ['emulator', 'start', name]);
  pollForDevice(toolchain);
}

// 启动 --emulator 指定的实例：已在运行则只等 hdc 识别；列表里找不到时报错
function startNamedEmulator(toolchain: Toolchain, name: string, instances: EmulatorInstance[] | null): void {
  const found = instances?.find(item => item.name === name) ?? null;
  if (instances !== null && !found) {
    const available = instances.map(item => item.name).join('、') || '（无）';
    throw new Error(`--emulator 指定的实例 ${name} 不存在；现有实例：${available}`);
  }
  if (found?.status === 'running') {
    console.log(`[ohos] 模拟器 ${name} 已在运行，等待 hdc 识别`);
    pollForDevice(toolchain);
    return;
  }
  startEmulatorAndWait(toolchain, name);
}

// 创建并启动实例：镜像缺失先下载（进度透传），实例名冲突自动加序号
function createAndStartEmulator(toolchain: Toolchain, opts: {
  deviceType: string;
  osVersion: string;
  downloaded: boolean;
  instances: EmulatorInstance[] | null;
}): void {
  const {deviceType, osVersion, downloaded, instances} = opts;
  if (!downloaded) {
    console.log(`[ohos] 镜像未下载，开始下载（可能耗时数十分钟，进度由 devecocli 输出）：${deviceType} / ${osVersion}`);
    try {
      devecoRun(toolchain, ['emulator', 'image', 'download', '--device-type', deviceType, '--os-version', osVersion]);
    } catch (error) {
      throw new Error(
        `${errorMessage(error)}\n镜像下载失败可直接重跑 dev:ohos 续传，` +
          `或手动执行：devecocli emulator image download --device-type ${deviceType} --os-version "${osVersion}"`
      );
    }
  }
  const name = suggestEmulatorName(deviceType, osVersion, (instances ?? []).map(item => item.name));
  console.log(`[ohos] devecocli emulator create ${name}`);
  devecoRunEcho(toolchain, ['emulator', 'create', name, '--device-type', deviceType, '--os-version', osVersion]);
  startEmulatorAndWait(toolchain, name);
}

// 编号菜单：返回选中的下标；空输入/EOF/非法编号返回 -1（视为取消）
async function chooseIndex(prompts: Prompts, title: string, entries: string[]): Promise<number> {
  const lines = entries.map((entry, index) => `  ${index + 1}) ${entry}`).join('\n');
  const answer = await prompts.line(`${title}：\n${lines}\n请输入编号（1-${entries.length}）：`);
  const index = Number.parseInt(answer, 10);
  return Number.isInteger(index) && index >= 1 && index <= entries.length ? index - 1 : -1;
}

// ensureDevices 的入参
export interface EnsureDevicesOptions {
  // module.json5 声明的设备类型：自动启动/创建只考虑这些类型
  deviceTypes: string[];
  // dev:ohos 传入的模拟器参数
  emulator: EmulatorOptions;
}

/**
 * 交互创建模拟器（无实例时的最后一步）：编号菜单选设备类型（module.json5 的
 * deviceTypes）与系统版本（标注是否已下载），随后创建并启动。内存、CPU 等规格
 * 不在本工具链内，由用户在 DevEco Studio 或实例配置中维护。
 */
async function ensureEmulator(toolchain: Toolchain, opts: {
  deviceTypes: string[];
  instances: EmulatorInstance[];
}): Promise<void> {
  const prompts = createPrompts();
  try {
    const typeIndex = await chooseIndex(prompts, '设备类型', opts.deviceTypes);
    if (typeIndex === -1) throw new Error('已取消：未创建模拟器');
    const deviceType = opts.deviceTypes[typeIndex];
    const images = listEmulatorImages(toolchain, deviceType);
    if (images === null) {
      throw new Error(
        '无法获取系统镜像列表（需要 DevEco Studio，仅 macOS/Windows）：' +
          '可连接真机，或在支持的机器上用 DevEco Studio 创建模拟器'
      );
    }
    if (images.length === 0) {
      throw new Error(`设备类型 ${deviceType} 没有可用系统镜像；可执行 devecocli emulator image list --all 检查`);
    }
    const versionIndex = await chooseIndex(
      prompts,
      '系统版本',
      images.map(image => `${image.osVersion}${image.downloaded ? '（已下载）' : '（需下载，可能耗时数十分钟）'}`)
    );
    if (versionIndex === -1) throw new Error('已取消：未创建模拟器');
    const image = images[versionIndex];
    createAndStartEmulator(toolchain, {
      deviceType,
      osVersion: image.osVersion,
      downloaded: image.downloaded,
      instances: opts.instances
    });
  } finally {
    prompts.close();
  }
}

/**
 * 无设备时的模拟器前置（仅 dev:ohos 调用，且 hdc list targets 为空）：
 * `--emulator <name>` 直接启动指定实例；`--emulator-device-type` +
 * `--emulator-os-version` 非交互创建；否则启动第一个可用的已停止实例，
 * 没有实例时交互创建。`--no-emulator` 与模拟器能力不可用（未装 DevEco
 * Studio / Linux）时按"无设备"给出真机接入指引，不尝试启动。
 *
 * @param toolchain - 已解析的工具链
 * @param opts.deviceTypes - 支持的设备类型
 * @param opts.emulator - 命令行模拟器参数
 */
export async function ensureDevices(toolchain: Toolchain, opts: EnsureDevicesOptions): Promise<void> {
  const {deviceTypes, emulator} = opts;
  if (emulator.disabled) {
    throw new Error(
      '--no-emulator 已指定且没有已连接设备：请连接 HarmonyOS 真机' +
        '（开发者模式 + USB 调试，hdc list targets 可见后重跑）'
    );
  }
  if (emulator.emulator !== undefined) {
    const instances = listEmulatorInstances(toolchain);
    if (instances === null) {
      throw new Error(
        '模拟器能力不可用（需要 DevEco Studio，仅 macOS/Windows；已安装但不在默认位置时，' +
          `可用 DEVECO_CLI_STUDIO_PATH 指向安装目录），无法启动 --emulator 指定的实例 ${emulator.emulator}`
      );
    }
    startNamedEmulator(toolchain, emulator.emulator, instances);
    return;
  }
  if (emulator.deviceType !== undefined && emulator.osVersion !== undefined) {
    const instances = listEmulatorInstances(toolchain);
    if (instances === null) {
      throw new Error(
        '模拟器能力不可用（需要 DevEco Studio，仅 macOS/Windows）：' +
          `无法创建 ${emulator.deviceType} 模拟器，请连接真机或在支持的机器上运行`
      );
    }
    const images = listEmulatorImages(toolchain, emulator.deviceType);
    if (images === null) {
      throw new Error(
        '模拟器能力不可用（需要 DevEco Studio，仅 macOS/Windows）：' +
          `无法获取 ${emulator.deviceType} 的镜像列表，请连接真机或在支持的机器上运行`
      );
    }
    const image = images.find(item => item.osVersion === emulator.osVersion) ?? null;
    if (!image) {
      const available = images.map(item => item.osVersion).join('、') || '（无）';
      throw new Error(
        `--emulator-os-version "${emulator.osVersion}" 不在 ${emulator.deviceType} 的可用镜像列表；` +
          `可用版本：${available}（devecocli emulator image list --all）`
      );
    }
    createAndStartEmulator(toolchain, {
      deviceType: emulator.deviceType,
      osVersion: emulator.osVersion,
      downloaded: image.downloaded,
      instances
    });
    return;
  }
  // 交互路径：需要终端与模拟器能力，缺一按"无设备"给出指引
  const instances = listEmulatorInstances(toolchain);
  if (instances === null) {
    throw new Error(
      '没有已连接设备，且模拟器能力不可用（需要 DevEco Studio，仅 macOS/Windows）：' +
        '请连接 HarmonyOS 真机（开发者模式 + USB 调试，hdc list targets 可见），' +
        '或在支持的机器上安装 DevEco Studio 后重跑'
    );
  }
  if (!isInteractive()) {
    throw new Error(
      '没有已连接设备，且当前无终端可交互：请连接 HarmonyOS 真机，或用参数跳过菜单创建模拟器：' +
        'pnpm dev:ohos -- --emulator <name>（启动现有实例）／' +
        '--emulator-device-type <t> --emulator-os-version "<v>"（创建新实例）'
    );
  }
  const running = instances.find(item => item.status === 'running');
  if (running) {
    console.log(`[ohos] 模拟器 ${running.name} 已在运行，等待 hdc 识别`);
    pollForDevice(toolchain);
    return;
  }
  const startable = selectStartableEmulator(instances, deviceTypes);
  if (startable) {
    startEmulatorAndWait(toolchain, startable.name);
    return;
  }
  await ensureEmulator(toolchain, {deviceTypes, instances});
}

/**
 * 读取 entry/module.json5 声明的设备类型（模拟器创建菜单的可选项来源）。
 *
 * @returns 设备类型列表（如 ['2in1', 'tablet']）
 */
export function moduleDeviceTypes(): string[] {
  interface ModuleDescriptor {
    module?: {deviceTypes?: unknown};
  }
  const parsed = JSON5.parse(
    fs.readFileSync(path.join(hapRoot, 'entry/src/main/module.json5'), 'utf8')
  ) as ModuleDescriptor;
  const types = parsed.module?.deviceTypes;
  if (!Array.isArray(types) || types.length === 0 || !types.every(item => typeof item === 'string')) {
    throw new Error('entry/src/main/module.json5 的 deviceTypes 缺失或为空');
  }
  return types;
}

/**
 * 上架构建前置：build-profile.json5 的 products 里必须已有用户声明的指定
 * product（其 signingConfig 字段指向用户维护的 signingConfigs 条目；模块
 * targets 的 applyToProducts 需包含该名字）。只做存在性校验；hvigor 的
 * 签名选择只认 product 声明（无 -p signingConfig 参数），多 product +
 * -p product=<name> 是唯一的免改写文件方案。缺失时立刻报错，不进长构建。
 *
 * @param name - product 名（build-profile.json5 products 段内声明）
 */
export function assertProduct(name: string): void {
  // 名字会进入正则，限定安全字符集
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(`invalid product name: ${name}（仅允许字母、数字、下划线、连字符）`);
  }
  ensureProfile();
  const text = fs.readFileSync(path.join(hapRoot, 'build-profile.json5'), 'utf8');
  const start = text.indexOf('products: [');
  if (start === -1) throw new Error('build-profile.json5: products 未找到');
  const close = text.indexOf('\n    ],', start);
  const region = close === -1 ? text.slice(start) : text.slice(start, close);
  if (!new RegExp(`name:\\s*'${name}'`).test(region)) {
    throw new Error(
      `product '${name}' 未在 build-profile.json5 的 products 里声明` +
        '（模块 targets 的 applyToProducts 也要包含它）；见 docs/release-signing.md'
    );
  }
}

/**
 * 定位 keytool（生成密钥库/CSR 用），供 signing:keygen。
 *
 * @returns keytool 路径（win32 带 .exe 形态）；工具链缺失时返回 null
 */
export function findKeytool(): string | null {
  try {
    const {javaHome} = resolveToolchain();
    return (javaHome && firstExecutable(path.join(javaHome, 'bin'), ['keytool', 'keytool.exe'])) || null;
  } catch {
    return null;
  }
}

// readline 的 _writeToOutput 是未公开 API（类型声明缺失）：断言到局部接口使用。
// 边界明确且仅用于静默回显，属 §6 允许的跨边界断言
type EchoControllable = readline.Interface & {_writeToOutput: (chunk: string) => void};

// 基于 line 事件队列的问答：连续 rl.question() 在非 TTY 输入下会丢弃已缓冲的行
// （answer 后接口 pause，longstanding 行为），事件队列则逐行消费，TTY 与管道
// 喂入都可靠。静默输入用 _writeToOutput 屏蔽回显，回车换行由我们补写。
export function createPrompts(): Prompts {
  const rl = readline.createInterface({input: process.stdin, output: process.stdout}) as EchoControllable;
  const write = rl._writeToOutput.bind(rl);
  const buffered: string[] = [];
  const waiters: Array<(answer: string) => void> = [];
  rl.on('line', answer => {
    const waiter = waiters.shift();
    if (waiter) waiter(answer);
    else buffered.push(answer);
  });
  // EOF（Ctrl-D/管道结束）：未完成的提问以空串收尾，由调用方校验报错
  rl.on('close', () => {
    while (waiters.length) waiters.shift()?.('');
  });
  const nextAnswer = (): Promise<string> => {
    const next = buffered.shift();
    if (next !== undefined) return Promise.resolve(next);
    return new Promise(resolve => waiters.push(resolve));
  };
  return {
    async line(prompt: string): Promise<string> {
      process.stdout.write(prompt);
      return (await nextAnswer()).trim();
    },
    async password(prompt: string): Promise<string> {
      process.stdout.write(prompt);
      rl._writeToOutput = () => {};
      const answer = await nextAnswer();
      rl._writeToOutput = write;
      process.stdout.write('\n');
      return answer;
    },
    close: () => rl.close()
  };
}

/**
 * 在产物目录里找 HAP（目录按 product 与模块 target 命名）；signed=true 时缺签名包
 * 返回 null，绝不回退未签名包。
 *
 * @param opts.signed - true 只认签名包；false 优先未签名包
 * @param opts.product - product 名（决定产物目录）
 * @returns 产物路径；不存在时返回 null
 */
export function findHap({signed = true, product = 'default'}: {signed?: boolean; product?: string} = {}): string | null {
  // dev product 走 entry 的专属 dev target（覆盖桌面名），其余 product 共用 default target
  const target = product === 'dev' ? 'dev' : 'default';
  return findArtifact({
    signed,
    dir: path.join(hapRoot, 'entry/build', product, 'outputs', target),
    ext: '.hap'
  });
}

/**
 * 在工程级产物目录里找 App 包（assembleApp 产物，目录按 product 命名）；
 * 签名语义与 findHap 一致。
 *
 * @param opts.signed - true 只认签名包；false 优先未签名包
 * @param opts.product - product 名（决定产物目录）
 * @returns 产物路径；不存在时返回 null
 */
export function findApp({signed = true, product = 'default'}: {signed?: boolean; product?: string} = {}): string | null {
  return findArtifact({
    signed,
    dir: path.join(hapRoot, 'build/outputs', product),
    ext: '.app'
  });
}

/**
 * 产物查找公共实现：signed=true 时缺签名包返回 null，绝不回退未签名包。
 *
 * @param opts - signed: 签名要求；dir: 产物目录；ext: 扩展名
 * @returns 产物路径；不存在时返回 null
 */
function findArtifact({signed, dir, ext}: {signed: boolean; dir: string; ext: string}): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter(name => name.endsWith(ext))
    .map(name => path.join(dir, name));
  const signedFile = files.find(file => file.endsWith(`-signed${ext}`));
  const unsignedFile = files.find(file => file.endsWith(`-unsigned${ext}`));
  if (signed) {
    // 签名包缺失时不能静默回退到未签名包，否则真机安装会失败且难以定位
    return signedFile ?? null;
  }
  return unsignedFile ?? files[0] ?? null;
}

/**
 * 完整 HAP 构建：编辑器产物 -> Link .so 自恢复 -> rawfile 装载 -> hvigor assembleHap。
 *
 * @param opts - 与 buildPackage 相同（mode 固定为 hap）
 * @returns HAP 产物路径与工具链信息
 */
export function buildHap(opts: PackageOptions = {}): {hap: string; toolchain: Toolchain} {
  const {artifact, toolchain} = buildPackage({...opts, mode: 'hap'});
  return {hap: artifact, toolchain};
}

/**
 * 完整包构建公共流程：编辑器产物 -> Link .so 自恢复 -> rawfile 装载 -> hvigor 打包。
 * mode='hap' 产出可单装的 HAP；mode='app' 产出上架用 App 包（assembleApp）。
 * product 由 hvigor 的 -p product=<name> 参数选择（签名配置随 product 声明，
 * 构建全程不改写 build-profile.json5）；App 包固定 buildMode=release。
 * 调试签名只服务 product=dev（独立包名，可与正式版共存），签名前置放在长构建之前。
 *
 * @param opts.build - 强制重建编辑器
 * @param opts.signed - 签名开关（默认 false 出未签名包）
 * @param opts.mode - 'hap' | 'app'（默认 hap）
 * @param opts.product - 选择的 product 名（App 默认由调用方传 'release'）
 * @param opts.resign - product=dev 签名构建时强制重新生成调试签名
 * @param opts.allowLogin - product=dev 签名需要生成时先引导登录（仅 dev:ohos 开启）
 * @returns 产物路径与工具链信息
 */
export function buildPackage({build = false, signed = false, mode = 'hap', product = 'default', resign = false, allowLogin = false}: PackageOptions = {}): PackageResult {
  healAppBundleName();
  const toolchain = resolveToolchain();
  if (signed && product === 'dev') ensureDevSigning({toolchain, resign, allowLogin});
  ensureEditorBuild({build});
  ensureLinkOrBuild();
  stageWebPayload();
  if (!signed) {
    // 未签名路径：换入无签名配置的模板，结束后还原（本机配置不受影响）
    const profilePath = path.join(hapRoot, 'build-profile.json5');
    const templatePath = path.join(hapRoot, 'build-profile.template.json5');
    let backup: string | null = null;
    if (fs.existsSync(profilePath)) {
      backup = `${profilePath}.local`;
      fs.renameSync(profilePath, backup);
    }
    fs.copyFileSync(templatePath, profilePath);
    try {
      return doHvigorBuild({toolchain, signed, mode, product});
    } finally {
      if (backup) {
        fs.rmSync(profilePath, {force: true});
        fs.renameSync(backup, profilePath);
      }
    }
  }
  return doHvigorBuild({toolchain, signed, mode, product});
}

/**
 * hvigor 打包公共实现：签名路径直接用本机 build-profile（product 参数选择），
 * 未签名路径由 buildPackage 换好模板后调用。
 */
function doHvigorBuild({toolchain, signed, mode, product}: {
  toolchain: Toolchain;
  signed: boolean;
  mode: PackageMode;
  product: string;
}): PackageResult {
  // app 产物在工程级 build/ 下，一并清理保证产物确定
  for (const dir of ['.hvigor', 'entry/build', 'build']) {
    fs.rmSync(path.join(hapRoot, dir), {recursive: true, force: true});
  }
  const task = mode === 'app' ? 'assembleApp' : 'assembleHap';
  // assembleApp 是工程级任务（注册在 project 上），--mode module 会报 task not found
  const hvigorMode = mode === 'app' ? 'project' : 'module';
  // 上架 App 包按商店要求用 release 模式；HAP 与未签名产物保持 debug
  const buildMode = mode === 'app' && signed ? 'release' : 'debug';
  console.log(`[ohos] hvigor ${task} (product=${product}, buildMode=${buildMode})`);
  const [hvigorEntry, ...hvigorPrefix] = toolchain.hvigorCommand;
  run(
    hvigorEntry,
    [...hvigorPrefix, task, '--mode', hvigorMode, '-p', `product=${product}`, '-p', `buildMode=${buildMode}`, '--no-daemon'],
    {cwd: hapRoot, env: toolchain.env}
  );
  const artifact = mode === 'app' ? findApp({signed, product}) : findHap({signed, product});
  if (!artifact) {
    throw new Error(
      mode === 'app' && signed
        ? '未产出签名 App 包：release product 是否漏了 signingConfig 引用？' +
          '（signingConfigs 加 release 条目 + product 加 signingConfig 行，见 docs/release-signing.md）'
        : `${mode.toUpperCase()} was not produced`
    );
  }
  console.log(`[ohos] ${mode.toUpperCase()}: ${artifact}`);
  return {artifact, toolchain};
}
