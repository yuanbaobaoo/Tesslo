#!/usr/bin/env node
// 环境检测与自愈入口：pnpm install 的 postinstall 钩子与各构建命令的前置步骤都走这里。
//
// 决策矩阵（每个组件独立判定）：
//   1. 显式声明（.env 里有该 key，或真实环境变量有值）→ 只校验、绝不下载；
//      路径无效时硬报错并指出是哪一行配置的问题。
//   2. 未声明 → 探测（现有候选链 + 仓库内 .toolchain/ 约定路径）→ 找到即用。
//   3. 探测不到 → 列入交互确认（y/N，大小写不敏感；非 TTY 默认跳过），
//      确认后下载到 .toolchain/ 并生成 .env.toolchain（优先级低于 .env）。
//
// JDK 与 Node 同级：只探测、绝不自动下载（hvigor 打包/签名是 Java 实现，属前置硬依赖）。
// devecocli 是 workspace devDependency，pnpm install 自带，不需要本脚本管理。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// toolchain.lock.json 里单个 CLT 平台资产条目（sha256 为 null 表示 Release 资产未上传）
interface CltAssetEntry {
  version: string;
  parts: string[];
  partSha256?: string[];
  sha256: string | null;
  sizeHint: string;
}

// .NET SDK 资产条目（官方 CDN 不发哈希，sha256 可为 null，靠 dotnet --version 兜底）
interface DotnetEntry {
  version: string;
  sizeHint: string;
  sha256: string | null;
  urls: Partial<Record<DotnetUrlKey, string>>;
}

// ohos-net runtime pack 资产条目
interface RuntimePackEntry {
  baseUrl: string;
  file: string;
  sha256: string;
  format: string;
  sizeHint: string;
  targetDir: string;
  anchor: string;
}

// scripts/toolchain.lock.json 的结构契约（环境自愈组件清单的单一事实源）
interface ToolchainLock {
  clt: {
    baseUrl: string;
    'mac-arm64': CltAssetEntry;
    'linux-x64': CltAssetEntry;
    'mac-x64'?: CltAssetEntry;
    'windows-x64'?: CltAssetEntry;
  };
  dotnet: DotnetEntry;
  runtimePack: RuntimePackEntry;
}

// CLT 资产的平台键（platformKey 的返回值；null 表示该平台不支持自动安装）
type CltAssetKey = 'mac-arm64' | 'mac-x64' | 'linux-x64' | 'windows-x64';

// .NET 官方 CDN 的平台键（darwin/linux 命名，与 CLT 资产的 mac 命名不同）
type DotnetUrlKey = 'darwin-arm64' | 'darwin-x64' | 'linux-x64';

// 组件解析状态：explicit=显式声明 managed=.toolchain 自愈 detected=本机探测
// derived=CLT/PATH 推导 missing=未找到 explicit-invalid=声明路径无效
type ResolveState = 'explicit' | 'explicit-invalid' | 'managed' | 'detected' | 'derived' | 'missing';

// 带路径组件（clt/ohos-sdk/dotnet）的解析结果
interface PathState {
  state: ResolveState;
  root: string | null;
  detail: string;
}

// runtime pack 的解析结果（无 root 概念；explicitArchive 为本地压缩包声明）
interface RuntimePackState {
  state: ResolveState;
  detail: string;
  explicitArchive?: string;
}

// JDK 前置依赖的解析结果
interface JdkState {
  ok: boolean;
  javaHome: string | null;
  detail: string;
}

// devecocli（workspace devDependency）的解析结果
interface DevecocliState {
  ok: boolean;
  detail: string;
}

// --for <scope> 的组件需求声明
interface ScopeConfig {
  auto: string[];
  needSdkOnly: boolean;
  prereqs?: string[];
}

// collectStates 的汇总结果
interface CollectedStates {
  rows: string[][];
  missing: string[];
  invalid: Array<{name: string; detail: string}>;
  jdk: JdkState;
  devecocli: DevecocliState;
  states: {clt: PathState; sdk: PathState; dotnet: PathState; pack: RuntimePackState};
}

// 仓库根与 .toolchain 约定路径
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolchainDir = path.join(repoRoot, '.toolchain');
const cacheDir = path.join(toolchainDir, 'cache');
const markerDir = path.join(toolchainDir, 'markers');
const lockFile = path.join(repoRoot, 'scripts/toolchain.lock.json');
// 边界断言：lock 是仓库内维护的 JSON，结构由 ToolchainLock 接口约定（§6 跨边界）
const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as ToolchainLock;

// 自动安装的组件注册表；顺序即下载顺序（小文件优先，体验好）
const AUTO_COMPONENTS = ['runtime-pack', 'dotnet', 'clt'];

/**
 * 解析 .env 文件为 Map，不污染 process.env——显式声明与否必须与本机探测可区分。
 *
 * @param name - 仓库根下的文件名（.env / .env.toolchain）
 * @returns 键值 Map；文件不存在返回空 Map
 */
function parseEnvFile(name: string): Map<string, string> {
  const file = path.join(repoRoot, name);
  const map = new Map<string, string>();
  if (!fs.existsSync(file)) return map;
  for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
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
    map.set(key, value);
  }
  return map;
}

// .env.toolchain 是本脚本生成的，不算用户显式声明
const userEnv = parseEnvFile('.env');

/**
 * 读取组件的显式配置值：真实环境变量优先于 .env（CI 注入的变量视同显式）。
 *
 * @param key - 环境变量名
 * @returns 显式值；未声明返回 undefined
 */
function explicitValue(key: string): string | undefined {
  if (process.env[key] !== undefined) return process.env[key];
  return userEnv.get(key);
}

/**
 * 平台标识映射到 lock 的 clt 条目。
 *
 * @returns 平台键；null 表示该平台不支持自动安装
 */
function platformKey(): CltAssetKey | null {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64';
  return null;
}

/**
 * .NET 官方 CDN 用 darwin/linux 命名，与 CLT 资产的 mac 命名不同，单独映射。
 *
 * @returns CDN 平台键；null 表示不支持
 */
function dotnetUrlKey(): DotnetUrlKey | null {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64';
  return null;
}

/**
 * 在目录树浅层定位锚点文件（bin/hvigorw 这类），兼容 zip 内多套一层目录的情况。
 *
 * @param from - 起始目录
 * @param anchor - 相对锚点路径，如 'bin/hvigorw'
 * @param maxDepth - 最大深度
 * @returns 锚点所在目录；未找到返回 null
 */
function locateAnchor(from: string, anchor: string, maxDepth: number = 3): string | null {
  if (fs.existsSync(path.join(from, anchor))) return from;
  if (maxDepth <= 0) return null;
  let entries: Array<fs.Dirent> = [];
  try {
    entries = fs.readdirSync(from, {withFileTypes: true});
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = locateAnchor(path.join(from, entry.name), anchor, maxDepth - 1);
    if (found) return found;
  }
  return null;
}

/**
 * 查 PATH 上的命令位置；探测失败返回空串。
 *
 * @param name - 命令名
 * @returns 命令绝对路径；不在 PATH 上返回空串
 */
function commandOnPath(name: string): string {
  const result = spawnSync('sh', ['-c', `command -v ${name}`], {encoding: 'utf-8'});
  return result.status === 0 ? result.stdout.trim() : '';
}

/**
 * PATH 反推 CLT 根：hvigorw 位于 <clt>/bin，hdc 位于
 * <clt>/sdk/default/openharmony/toolchains（hdc 链也覆盖只装了 SDK、没装 CLT 的布局）。
 *
 * @returns 候选根目录列表
 */
function pathDerivedCltCandidates(): string[] {
  const candidates = [];
  const hvigorw = commandOnPath('hvigorw');
  if (hvigorw) candidates.push(path.resolve(path.dirname(hvigorw), '..'));
  const hdc = commandOnPath('hdc');
  if (hdc) candidates.push(path.resolve(path.dirname(hdc), '../../../..'));
  return candidates;
}

// 与 ohos-common.ts 的探测链保持一致，不做机器路径猜测：
// DEVECO_CLI_CLT_PATH 显式声明（devecocli 标准变量）→ PATH 反推 → .toolchain/ 自愈安装
function cltCandidates(): string[] {
  return [
    explicitValue('DEVECO_CLI_CLT_PATH'),
    ...pathDerivedCltCandidates(),
    path.join(toolchainDir, 'command-line-tools')
  ].filter((candidate): candidate is string => Boolean(candidate));
}

/**
 * 解析 CLT 状态。sdkRoot 单独判定：link 构建只需要 Native SDK，hap/app 才需要 hvigorw。
 *
 * @returns 解析状态、根路径与说明
 */
function resolveClt(): PathState {
  const explicit = explicitValue('DEVECO_CLI_CLT_PATH');
  // 显式声明只校验声明路径本身——即使本机其他位置有可用安装，声明无效也必须报错，
  // 否则配置错误会被探测链静默掩盖
  if (explicit) {
    if (!fs.existsSync(path.join(explicit, 'bin/hvigorw'))) {
      return {state: 'explicit-invalid', root: null, detail: `DEVECO_CLI_CLT_PATH=${explicit} 下没有 bin/hvigorw`};
    }
    return {state: 'explicit', root: explicit, detail: '显式声明'};
  }
  const found = cltCandidates().find(candidate =>
    fs.existsSync(path.join(candidate, 'bin/hvigorw'))
  );
  if (found) {
    const managed = found.startsWith(toolchainDir);
    return {
      state: managed ? 'managed' : 'detected',
      root: found,
      detail: managed ? '.toolchain 自愈安装' : '本机已安装'
    };
  }
  return {state: 'missing', root: null, detail: '未找到 command-line-tools'};
}

// Native SDK 有效性锚点：oh-uni-package.json（新旧 SDK 布局两种位置）
function hasSdkAnchor(root: string): boolean {
  return (
    fs.existsSync(path.join(root, 'openharmony/native/oh-uni-package.json')) ||
    fs.existsSync(path.join(root, 'native/oh-uni-package.json'))
  );
}

/**
 * 解析 OHOS Native SDK 根（openharmony 交叉工具链）。优先显式 OHOS_SDK_ROOT，
 * 否则由 CLT 根或 PATH 上的 SDK 工具（hvigorw/hdc）反推（sdk/default）。
 *
 * @param cltRoot - CLT 根（可为 null，仅影响推导候选）
 * @returns 解析状态、根路径与说明
 */
function resolveSdk(cltRoot: string | null): PathState {
  const explicit = explicitValue('OHOS_SDK_ROOT');
  // 与 CLT 同理：显式声明只校验声明路径本身
  if (explicit) {
    if (!hasSdkAnchor(explicit)) {
      return {state: 'explicit-invalid', root: null, detail: `OHOS_SDK_ROOT=${explicit} 下没有 native SDK`};
    }
    return {state: 'explicit', root: explicit, detail: '显式声明'};
  }
  // 推导候选：CLT 根优先；PATH 上只有 hdc（只装 SDK、没装 CLT）时也能反推出 sdk/default
  const derivedCandidates = [];
  if (cltRoot) derivedCandidates.push(path.join(cltRoot, 'sdk/default'));
  for (const candidate of pathDerivedCltCandidates()) {
    derivedCandidates.push(path.join(candidate, 'sdk/default'));
  }
  const derived = derivedCandidates.find(root => hasSdkAnchor(root));
  if (derived) {
    return {state: 'derived', root: derived, detail: '由 CLT 根 / PATH 反推'};
  }
  return {state: 'missing', root: null, detail: '未找到 Native SDK'};
}

/**
 * 解析 .NET SDK 根（含 dotnet 可执行文件的目录）。
 *
 * @returns 解析状态、根路径与说明
 */
function resolveDotnet(): PathState {
  const explicit = explicitValue('DOTNET_ROOT');
  if (explicit) {
    if (!fs.existsSync(path.join(explicit, 'dotnet'))) {
      return {state: 'explicit-invalid', root: null, detail: `DOTNET_ROOT=${explicit} 下没有 dotnet`};
    }
    return {state: 'explicit', root: explicit, detail: '显式声明'};
  }
  const onPath = capture('sh', ['-c', 'command -v dotnet']);
  const candidates = [
    path.join(toolchainDir, 'dotnet'),
    process.env.HOME && path.join(process.env.HOME, '.dotnet'),
    onPath && path.dirname(onPath)
  ].filter((candidate): candidate is string => Boolean(candidate));
  const found = candidates.find(candidate => fs.existsSync(path.join(candidate, 'dotnet')));
  if (found) {
    const managed = found.startsWith(toolchainDir);
    return {state: managed ? 'managed' : 'detected', root: found, detail: managed ? '.toolchain 自愈安装' : '本机已安装'};
  }
  return {state: 'missing', root: null, detail: '未找到 .NET SDK'};
}

// runtime pack 的约定安装路径由 csproj 的 Import 决定，不能改
const runtimePackTarget = path.join(repoRoot, lock.runtimePack.targetDir);

/**
 * runtime pack 锚点检查：约定路径下是否已有可用的 ilcompiler 目录。
 *
 * @returns 锚点存在返回 true
 */
function runtimePackAnchor(): boolean {
  return fs.existsSync(path.join(runtimePackTarget, lock.runtimePack.anchor));
}

/**
 * 解析 ohos-net runtime pack。支持 .env 显式声明 OHOS_NET_RUNTIME_PACK
 * 指向解压目录或本地压缩包；声明后绝不下载。
 *
 * @returns 解析状态与说明；声明本地压缩包时带 explicitArchive
 */
function resolveRuntimePack(): RuntimePackState {
  const explicit = explicitValue('OHOS_NET_RUNTIME_PACK');
  if (explicit) {
    if (fs.existsSync(explicit) && fs.statSync(explicit).isFile()) {
      return {state: 'explicit', detail: `本地压缩包 ${explicit}`, explicitArchive: explicit};
    }
    // 目录形态兼容两种指法：指向解压根目录，或直接指向 ilcompiler 目录
    const ilcDirs = [
      path.join(explicit, 'runtime.linux-musl-arm64.microsoft.dotnet.ilcompiler'),
      explicit
    ];
    if (ilcDirs.some(dir => fs.existsSync(path.join(dir, 'sdk/System.Private.CoreLib.dll')))) {
      return {state: 'explicit', detail: `本地目录 ${explicit}`};
    }
    return {state: 'explicit-invalid', detail: `OHOS_NET_RUNTIME_PACK=${explicit} 不是有效的 pack 目录或压缩包`};
  }
  if (runtimePackAnchor()) {
    return {state: 'detected', detail: '约定路径已就绪'};
  }
  return {state: 'missing', detail: '约定路径缺失'};
}

/**
 * JDK 前置依赖：JAVA_HOME → sdkman → PATH。绝不自动下载。
 *
 * @returns 是否可用、JAVA_HOME 与说明
 */
function resolveJdk(): JdkState {
  const candidates = [
    explicitValue('JAVA_HOME'),
    process.env.HOME && path.join(process.env.HOME, '.sdkman/candidates/java/current')
  ].filter((candidate): candidate is string => Boolean(candidate));
  let javaHome = candidates.find(candidate => fs.existsSync(path.join(candidate, 'bin/java'))) ?? null;
  let javaBin = javaHome && path.join(javaHome, 'bin/java');
  if (!javaBin) {
    const onPath = capture('sh', ['-c', 'command -v java']);
    if (onPath) {
      javaBin = onPath;
      javaHome = path.resolve(path.dirname(onPath), '..');
    }
  }
  if (!javaBin) {
    return {
      ok: false,
      javaHome: null,
      detail: '未找到 java；hvigor 打包/签名需要 JDK（建议 Temurin 17+）：https://adoptium.net/'
    };
  }
  // 不变量：javaBin 存在时 javaHome 必已赋值（候选目录或 PATH 反推），兜底展示 bin 路径
  return {ok: true, javaHome, detail: javaHome ?? javaBin};
}

/**
 * devecocli 是 workspace devDependency，pnpm install 后必然存在。
 *
 * @returns 是否可用与说明
 */
function resolveDevecocli(): DevecocliState {
  const bin = path.join(repoRoot, 'node_modules/.bin/devecocli');
  return fs.existsSync(bin) ? {ok: true, detail: bin} : {ok: false, detail: '运行 pnpm install 安装 devDependency'};
}

/**
 * 同步执行命令并捕获 stdout；失败返回空串（探测用）。
 *
 * @param command - 可执行文件
 * @param args - 参数列表
 * @returns 去除首尾空白后的 stdout；非零退出码返回空串
 */
function capture(command: string, args: string[]): string {
  const result = spawnSync(command, args, {encoding: 'utf8'});
  return result.status === 0 ? result.stdout.trim() : '';
}

// ---------------------------------------------------------------------------
// 下载 / 校验 / 解压
// ---------------------------------------------------------------------------

/**
 * 用系统 curl 下载（断点续传、重试）；curl 不存在时给出安装指引。
 *
 * @param url - 下载地址
 * @param dest - 目标文件
 */
function download(url: string, dest: string): void {
  if (!capture('sh', ['-c', 'command -v curl'])) {
    throw new Error('curl not found; install curl first');
  }
  const result = spawnSync(
    'curl',
    ['-fL', '--retry', '3', '-C', '-', '-o', dest, url],
    {stdio: 'inherit'}
  );
  if (result.status !== 0) throw new Error(`download failed: ${url}`);
}

/**
 * 计算文件 SHA-256。
 *
 * @param file - 目标文件
 * @returns hex 摘要
 */
function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * 校验文件哈希；expected 为 null 时跳过（dotnet 官方 CDN 不发哈希，靠功能校验兜底）。
 *
 * @param file - 目标文件
 * @param expected - 期望的 hex 摘要；null 跳过校验
 */
async function verifySha256(file: string, expected: string | null): Promise<void> {
  if (!expected) return;
  const actual = await sha256File(file);
  if (actual !== expected) {
    throw new Error(`sha256 mismatch for ${path.basename(file)}: expected ${expected}, got ${actual}`);
  }
}

/**
 * 解压 zip 到目标目录；优先 unzip，darwin 无 unzip 时退回系统 ditto。
 *
 * @param zip - zip 文件
 * @param destDir - 目标目录
 */
function extractZip(zip: string, destDir: string): void {
  fs.mkdirSync(destDir, {recursive: true});
  if (capture('sh', ['-c', 'command -v unzip'])) {
    const result = spawnSync('unzip', ['-q', zip, '-d', destDir], {stdio: 'inherit'});
    if (result.status !== 0) throw new Error(`unzip failed: ${zip}`);
    return;
  }
  if (process.platform === 'darwin') {
    const result = spawnSync('ditto', ['-x', '-k', zip, destDir], {stdio: 'inherit'});
    if (result.status !== 0) throw new Error(`ditto failed: ${zip}`);
    return;
  }
  throw new Error('no unzip tool available (install unzip)');
}

/**
 * 解压 tar 包；.zst 先探测 tar 的 zstd 支持，再退回 zstd 管道。
 *
 * @param file - tar 文件
 * @param destDir - 目标目录
 * @param zst - 是否为 zstd 压缩
 */
function extractTar(file: string, destDir: string, zst: boolean): void {
  fs.mkdirSync(destDir, {recursive: true});
  if (!zst) {
    const result = spawnSync('tar', ['-xf', file, '-C', destDir], {stdio: 'inherit'});
    if (result.status !== 0) throw new Error(`tar failed: ${file}`);
    return;
  }
  // macOS 较新系统自带 libarchive 的 zstd 支持；先试 tar --zstd 再试 zstd 管道
  const probe = spawnSync('tar', ['--zstd', '-tf', file], {encoding: 'utf8', stdio: 'ignore'});
  if (probe.status === 0) {
    const result = spawnSync('tar', ['--zstd', '-xf', file, '-C', destDir], {stdio: 'inherit'});
    if (result.status !== 0) throw new Error(`tar --zstd failed: ${file}`);
    return;
  }
  if (capture('sh', ['-c', 'command -v zstd'])) {
    const result = spawnSync('sh', ['-c', `zstd -dc '${file}' | tar -xf - -C '${destDir}'`], {stdio: 'inherit'});
    if (result.status !== 0) throw new Error(`zstd|tar failed: ${file}`);
    return;
  }
  throw new Error('no zstd decoder available (需要 tar --zstd 支持或安装 zstd)');
}

/**
 * 简易互斥锁：两个 pnpm 终端同时触发 postinstall 时不并发写 .toolchain。
 * 锁超过 30 分钟视为残留（下载中断），直接接管。
 *
 * @param fn - 持锁执行的安装动作
 */
async function withLock(fn: () => Promise<void>): Promise<void> {
  fs.mkdirSync(toolchainDir, {recursive: true});
  const lockPath = path.join(toolchainDir, '.lock');
  try {
    fs.writeFileSync(lockPath, `${process.pid} ${Date.now()}`, {flag: 'wx'});
  } catch {
    const stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs > 30 * 60 * 1000) {
      fs.rmSync(lockPath, {force: true});
      fs.writeFileSync(lockPath, `${process.pid} ${Date.now()}`, {flag: 'wx'});
    } else {
      console.error('[env] 另一个安装进程正在进行（.toolchain/.lock）；稍后重试');
      process.exit(1);
    }
  }
  try {
    await fn();
  } finally {
    try {
      const owner = fs.readFileSync(lockPath, 'utf8').split(' ')[0];
      if (owner === String(process.pid)) fs.rmSync(lockPath, {force: true});
    } catch {
      // 锁文件已被接管时直接放行
    }
  }
}

/**
 * 交互确认：y/Y/yes 确认，n/N/no/回车/EOF 拒绝；非 TTY 与 TESSLO_BOOTSTRAP=off 默认拒绝。
 *
 * @param question - 提示文案
 * @param yesFlag - 命令行 --yes
 * @param noFlag - 命令行 --no
 * @returns 是否确认
 */
function confirm(question: string, yesFlag: boolean, noFlag: boolean): Promise<boolean> {
  if (yesFlag || process.env.TESSLO_BOOTSTRAP === 'on') return Promise.resolve(true);
  if (noFlag || process.env.TESSLO_BOOTSTRAP === 'off') return Promise.resolve(false);
  if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.resolve(false);
  const rl = readline.createInterface({input: process.stdin, output: process.stdout});
  return new Promise(resolve => {
    rl.question(`${question} `, answer => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

/**
 * 组件基址独立配置（CLT 走 GitCode 国内 CDN，runtime pack 走 GitHub Release）；
 * TESSLO_TOOLS_BASE_URL 可整体覆盖（自建镜像场景）。
 *
 * @param entry - 带 baseUrl 的资产条目
 * @returns 实际使用的下载基址
 */
function componentBaseUrl(entry: {baseUrl: string}): string {
  return process.env.TESSLO_TOOLS_BASE_URL || entry.baseUrl;
}

/**
 * 安装 CLT：分卷下载 → 逐卷校验 → cat 还原 → 整包校验 → 解压 → 锚点定位。
 *
 * @param force - 是否强制重装
 */
async function installClt(force: boolean): Promise<void> {
  const key = platformKey();
  const entry = key ? lock.clt[key] : undefined;
  if (!entry) {
    throw new Error(
      `当前平台（${process.platform}/${process.arch}）不支持 CLT 自动安装（支持 mac-arm64 / linux-x64）；请参考 docs/build.md 手动安装`
    );
  }
  if (entry.sha256 === null) {
    throw new Error(`CLT 资产 ${key} 尚未上传到 Release（lock 中 sha256 为空）；请先手动安装或等待资产就绪`);
  }
  const dest = path.join(toolchainDir, 'command-line-tools');
  if (fs.existsSync(dest)) fs.rmSync(dest, {recursive: true, force: true});
  fs.mkdirSync(cacheDir, {recursive: true});
  // OHOS_CLT_URL：整包直链覆盖（与 CI 的可选变量对齐）
  const zipPath = path.join(cacheDir, `clt-${key}-${entry.version}.zip`);
  if (process.env.OHOS_CLT_URL) {
    console.log(`[env] 下载 CLT 整包：${process.env.OHOS_CLT_URL}`);
    download(process.env.OHOS_CLT_URL, zipPath);
  } else {
    const parts: string[] = [];
    for (let i = 0; i < entry.parts.length; i += 1) {
      const partPath = path.join(cacheDir, entry.parts[i]);
      console.log(`[env] 下载 ${entry.parts[i]}（${entry.sizeHint} 共 ${entry.parts.length} 卷）`);
      download(`${componentBaseUrl(lock.clt)}/${entry.parts[i]}`, partPath);
      // 逐卷先校验，损坏的分卷立即失败，避免 cat 之后整包报废
      if (entry.partSha256 && entry.partSha256[i]) {
        await verifySha256(partPath, entry.partSha256[i]);
      }
      parts.push(partPath);
    }
    // 分卷是字节级切分：cat 即还原
    const out = fs.createWriteStream(zipPath);
    for (const part of parts) {
      await new Promise<void>((resolve, reject) => {
        fs.createReadStream(part)
          .on('data', chunk => out.write(chunk))
          .on('end', resolve)
          .on('error', reject);
      });
    }
    await new Promise<void>(resolve => out.end(resolve));
    for (const part of parts) fs.rmSync(part, {force: true});
  }
  await verifySha256(zipPath, entry.sha256);
  extractZip(zipPath, toolchainDir);
  fs.rmSync(zipPath, {force: true});
  // 锚点定位：zip 根目录层级不保证固定，找到 bin/hvigorw 为止
  const root = locateAnchor(toolchainDir, 'bin/hvigorw');
  if (!root) throw new Error('CLT 解压后未找到 bin/hvigorw');
  if (root !== dest) {
    if (fs.existsSync(dest)) fs.rmSync(dest, {recursive: true, force: true});
    fs.renameSync(root, dest);
  }
  // CLT 装在仓库内时，repo 根 package.json 的 "type":"module" 会把 hvigorw.js
  // （CommonJS）误判为 ESM 直接崩溃；写入 commonjs 标记中和（仅当 zip 未自带时）
  const cjsMarker = path.join(dest, 'package.json');
  if (!fs.existsSync(cjsMarker)) {
    fs.writeFileSync(cjsMarker, '{"type":"commonjs","private":true}\n');
  }
  writeMarker('clt', {version: entry.version, sha256: entry.sha256, forced: force});
  console.log(`[env] CLT ${entry.version} 安装完成：${dest}`);
}

/**
 * 安装 .NET SDK 到 .toolchain/dotnet；安装后跑 dotnet --version 做功能校验。
 *
 * @param force - 是否强制重装
 */
async function installDotnet(force: boolean): Promise<void> {
  const key = dotnetUrlKey();
  const url = key ? lock.dotnet.urls[key] : undefined;
  if (!url) {
    throw new Error(`当前平台（${process.platform}/${process.arch}）没有可自动安装的 .NET 资产；请参考 docs/build.md 手动安装`);
  }
  const dest = path.join(toolchainDir, 'dotnet');
  if (fs.existsSync(dest)) fs.rmSync(dest, {recursive: true, force: true});
  fs.mkdirSync(dest, {recursive: true});
  fs.mkdirSync(cacheDir, {recursive: true});
  const archive = path.join(cacheDir, `dotnet-sdk-${lock.dotnet.version}-${key}.tar.gz`);
  console.log(`[env] 下载 .NET SDK ${lock.dotnet.version}（${lock.dotnet.sizeHint}）`);
  download(url, archive);
  await verifySha256(archive, lock.dotnet.sha256);
  extractTar(archive, dest, false);
  fs.rmSync(archive, {force: true});
  // 官方 CDN 不提供锁定哈希，用版本输出兜底校验
  const version = capture(path.join(dest, 'dotnet'), ['--version']);
  if (!version.startsWith(`${lock.dotnet.version.split('.')[0]}.`)) {
    throw new Error(`dotnet --version 输出异常：${version || '(无输出)'}，期望 ${lock.dotnet.version}`);
  }
  writeMarker('dotnet', {version: lock.dotnet.version, forced: force});
  console.log(`[env] .NET SDK ${version} 安装完成：${dest}`);
}

/**
 * 安装 runtime pack 到约定路径；支持本地压缩包来源（.env 显式声明时不联网）。
 *
 * @param force - 是否强制重装
 * @param localArchive - .env 声明的本地压缩包；未声明时联网下载
 */
async function installRuntimePack(force: boolean, localArchive: string | undefined): Promise<void> {
  fs.mkdirSync(cacheDir, {recursive: true});
  const archive = localArchive || path.join(cacheDir, lock.runtimePack.file);
  if (!localArchive) {
    console.log(`[env] 下载 runtime pack（${lock.runtimePack.sizeHint}）`);
    download(`${componentBaseUrl(lock.runtimePack)}/${lock.runtimePack.file}`, archive);
    await verifySha256(archive, lock.runtimePack.sha256);
  }
  // 只清 ilcompiler 子目录：runtime/ 根下还有仓库跟踪的 OpenHarmony.NET.Runtime.targets，
  // 整目录删除会误伤（与 CI 的 rm -rf "$TARGET" 粒度保持一致）
  const ilcDir = path.join(runtimePackTarget, 'runtime.linux-musl-arm64.microsoft.dotnet.ilcompiler');
  fs.rmSync(ilcDir, {recursive: true, force: true});
  extractTar(archive, runtimePackTarget, lock.runtimePack.format === 'tar.zst');
  if (!localArchive) fs.rmSync(archive, {force: true});
  if (!runtimePackAnchor()) {
    throw new Error(`runtime pack 解压后缺少锚点文件 ${lock.runtimePack.anchor}`);
  }
  writeMarker('runtime-pack', {version: lock.runtimePack.sha256.slice(0, 12), forced: force});
  console.log(`[env] runtime pack 安装完成：${runtimePackTarget}`);
}

/**
 * 写安装标记：跳过重复安装，env:status 显示来源。
 *
 * @param component - 组件名
 * @param meta - 版本/哈希/强制标记等附加信息
 */
function writeMarker(component: string, meta: Record<string, unknown>): void {
  fs.mkdirSync(markerDir, {recursive: true});
  fs.writeFileSync(
    path.join(markerDir, `${component}.json`),
    JSON.stringify({component, installedAt: new Date().toISOString(), ...meta}, null, 2)
  );
}

/**
 * 把自愈安装的路径写进 .env.toolchain（优先级低于 .env 与真实环境变量）。
 * 只写 managed 组件——探测到的本机安装不固化，避免路径过期后误导。
 */
function writeEnvToolchain(): void {
  const lines = [
    '# 由 scripts/env.ts 自动生成，勿手改；用户级配置请写 .env（优先级更高）。',
    '# 加载顺序：真实环境变量 > .env > .env.toolchain。'
  ];
  const clt = path.join(toolchainDir, 'command-line-tools');
  if (fs.existsSync(path.join(clt, 'bin/hvigorw'))) {
    lines.push(`DEVECO_CLI_CLT_PATH=${clt}`);
    lines.push(`OHOS_SDK_ROOT=${path.join(clt, 'sdk/default')}`);
  }
  const dotnet = path.join(toolchainDir, 'dotnet');
  if (fs.existsSync(path.join(dotnet, 'dotnet'))) {
    lines.push(`DOTNET_ROOT=${dotnet}`);
  }
  fs.writeFileSync(path.join(repoRoot, '.env.toolchain'), `${lines.join('\n')}\n`);
}

// ---------------------------------------------------------------------------
// 子命令
// ---------------------------------------------------------------------------

// 各 scope 需要的组件：link 只需要 SDK 与 C# 工具链；hap/app 需要 hvigorw；签名再加 JDK/devecocli
const SCOPES: Record<string, ScopeConfig> = {
  link: {auto: ['runtime-pack', 'dotnet', 'clt'], needSdkOnly: true},
  hap: {auto: ['clt'], needSdkOnly: false},
  app: {auto: ['clt'], needSdkOnly: false},
  signed: {auto: ['clt'], needSdkOnly: false, prereqs: ['jdk', 'devecocli']}
};

/**
 * 汇总所有组件状态并返回缺失的自动组件列表。
 *
 * @returns 体检表行、缺失/无效组件与各组件解析状态
 */
function collectStates(): CollectedStates {
  const clt = resolveClt();
  const sdk = resolveSdk(clt.root);
  const dotnet = resolveDotnet();
  const pack = resolveRuntimePack();
  const jdk = resolveJdk();
  const devecocli = resolveDevecocli();
  const rows = [
    ['clt', clt.state, clt.root || clt.detail],
    ['ohos-sdk', sdk.state, sdk.root || sdk.detail],
    ['dotnet', dotnet.state, dotnet.root || dotnet.detail],
    ['runtime-pack', pack.state, pack.detail],
    ['jdk (前置)', jdk.ok ? 'ok' : 'missing', jdk.detail],
    ['devecocli', devecocli.ok ? 'workspace' : 'missing', devecocli.detail]
  ];
  const invalid: Array<{name: string; detail: string}> = [];
  for (const [name, state, detail] of [
    ['clt', clt.state, clt.detail],
    ['ohos-sdk', sdk.state, sdk.detail],
    ['dotnet', dotnet.state, dotnet.detail],
    ['runtime-pack', pack.state, pack.detail]
  ]) {
    if (state === 'explicit-invalid') invalid.push({name, detail});
  }
  const missing: string[] = [];
  if (clt.state === 'missing') missing.push('clt');
  if (pack.state === 'missing') missing.push('runtime-pack');
  if (dotnet.state === 'missing') missing.push('dotnet');
  return {rows, missing, invalid, jdk, devecocli, states: {clt, sdk, dotnet, pack}};
}

/**
 * status 子命令：打印体检表。
 */
function cmdStatus(): void {
  const {rows} = collectStates();
  console.log('\nTesslo 环境体检（详细规则见 docs/build.md）\n');
  for (const [name, state, detail] of rows) {
    console.log(`  ${name.padEnd(14)} ${state.padEnd(15)} ${detail}`);
  }
  console.log('');
}

/**
 * ensure 子命令：决策矩阵主流程。
 *
 * @param scope - --for 声明的链路（link/hap/app/signed）；postinstall 场景为 undefined
 * @param yesFlag - 命令行 --yes
 * @param noFlag - 命令行 --no
 */
async function cmdEnsure(scope: string | undefined, yesFlag: boolean, noFlag: boolean): Promise<void> {
  const collected = collectStates();
  const {invalid} = collected;

  // 显式声明但路径无效：配置错误必须浮出水面，绝不静默下载
  if (invalid.length) {
    for (const item of invalid) {
      console.error(`[env] 配置错误：${item.name} ${item.detail}（显式声明只校验、不自动下载）`);
    }
    process.exit(1);
  }

  // 签名链路的前置硬依赖：缺失立即失败并给手动指引
  const config = scope ? SCOPES[scope] : null;
  if (config && config.prereqs) {
    const failures: string[] = [];
    if (!collected.jdk.ok) failures.push(`jdk: ${collected.jdk.detail}`);
    if (!collected.devecocli.ok) failures.push(`devecocli: ${collected.devecocli.detail}`);
    if (failures.length) {
      console.error(`[env] --for ${scope} 缺少前置依赖（与 Node 同级，不自动下载）：`);
      for (const failure of failures) console.error(`  - ${failure}`);
      process.exit(1);
    }
  }

  // 计算本 scope 真正缺的东西
  let toInstall: string[] = [];
  if (config) {
    for (const name of config.auto) {
      if (name === 'runtime-pack' && collected.states.pack.state === 'missing') toInstall.push('runtime-pack');
      if (name === 'dotnet' && collected.states.dotnet.state === 'missing') toInstall.push('dotnet');
      if (name === 'clt') {
        // link 只需要 Native SDK；sdk 显式就绪时无需整个 CLT
        const cltMissing = collected.states.clt.state === 'missing';
        const sdkMissing = collected.states.sdk.state === 'missing';
        if (config.needSdkOnly ? sdkMissing : cltMissing) toInstall.push('clt');
      }
    }
  } else {
    // postinstall：把三个自动组件全量检查一遍，缺什么列什么
    toInstall = AUTO_COMPONENTS.filter(name => collected.missing.includes(name));
  }
  toInstall = [...new Set(toInstall)].filter(name => AUTO_COMPONENTS.includes(name));

  if (!toInstall.length) {
    // 快速路径：全部就绪时不产生任何输出（避免每次构建刷屏）
    if (scope || process.env.TESSLO_ENV_VERBOSE) {
      console.log('[env] 工具链就绪');
    }
    if (fs.existsSync(toolchainDir)) writeEnvToolchain();
    return;
  }

  // 平台不支持自动安装的组件在询问前就报错，避免用户确认后才失败；
  // postinstall（无 scope）场景只警告不中断——Windows 等平台不应因此装不了依赖。
  // Intel mac（mac-x64）与 Windows 明确不支持：不提供 CLT 资产，直接按平台不支持报错
  const key = platformKey();
  const cltEntry = key ? lock.clt[key] : undefined;
  const unsupported: string[] = [];
  const reasons = new Map<string, string>();
  for (const name of toInstall) {
    let supported = true;
    let reason = '';
    if (name === 'clt') {
      if (!key || !cltEntry) {
        supported = false;
        reason = `当前平台 ${process.platform}/${process.arch} 不支持（支持 mac-arm64 / linux-x64）`;
      } else if (cltEntry.sha256 === null) {
        supported = false;
        reason = 'Release 资产尚未上传';
      }
    }
    const dnKey = dotnetUrlKey();
    if (name === 'dotnet' && !(dnKey && lock.dotnet.urls[dnKey])) {
      supported = false;
      reason = `当前平台 ${process.platform}/${process.arch} 不支持自动安装`;
    }
    if (!supported) {
      unsupported.push(name);
      reasons.set(name, reason);
    }
  }
  if (unsupported.length) {
    const message = unsupported.map(name => `${name}（${reasons.get(name) ?? ''}）`).join('、');
    if (scope) {
      console.error(`[env] ${message}；请参考 docs/build.md 手动安装`);
      process.exit(1);
    }
    console.warn(`[env] ${message}；请参考 docs/build.md 手动安装后重新运行`);
    toInstall = toInstall.filter(name => !unsupported.includes(name));
    if (!toInstall.length) return;
  }

  // 交互确认
  const entry = (key0: string): {sizeHint?: string; version?: string} | undefined => {
    if (key0 === 'clt') {
      const k = platformKey();
      return k ? lock.clt[k] : undefined;
    }
    return key0 === 'runtime-pack' ? lock.runtimePack : lock.dotnet;
  };
  console.log('\n[env] 检测到缺失组件：');
  for (const name of toInstall) {
    const item = entry(name);
    const hint = item?.sizeHint || '';
    const label = name === 'runtime-pack' ? 'ohos-net runtime pack' : name === 'dotnet' ? `.NET SDK ${lock.dotnet.version}` : `OHOS CLT ${item?.version}`;
    console.log(`  - ${label} ${hint}`);
  }
  const downloadDir = (name: string): string =>
    name === 'runtime-pack' ? runtimePackTarget : name === 'dotnet' ? path.join(toolchainDir, 'dotnet') : path.join(toolchainDir, 'command-line-tools');
  console.log('  安装位置：');
  for (const name of toInstall) console.log(`    ${downloadDir(name)}`);
  const ok = await confirm('是否下载并安装以上组件？[y/N]', yesFlag, noFlag);
  if (!ok) {
    const hint = '稍后可运行 pnpm env:install <组件名> 手动安装';
    if (scope) {
      console.error(`[env] 已跳过下载；--for ${scope} 所需组件缺失，构建无法继续。${hint}`);
      process.exit(1);
    }
    console.warn(`[env] 已跳过下载；构建需要时会再次提示。${hint}`);
    return;
  }

  await withLock(async () => {
    for (const name of toInstall) {
      if (name === 'clt') await installClt(false);
      if (name === 'dotnet') await installDotnet(false);
      if (name === 'runtime-pack') await installRuntimePack(false, collected.states.pack.explicitArchive);
    }
    writeEnvToolchain();
  });
  console.log('[env] 缺失组件安装完成');
}

/**
 * install 子命令：强制/手动安装指定组件（不询问，用户意图已明确）。
 *
 * @param names - 组件名列表；为空时安装全部自动组件
 * @param force - 是否强制重装
 */
async function cmdInstall(names: string[], force: boolean): Promise<void> {
  const targets = names.length ? names : AUTO_COMPONENTS;
  for (const name of targets) {
    if (!AUTO_COMPONENTS.includes(name)) {
      console.error(`[env] 未知组件：${name}（可选：${AUTO_COMPONENTS.join(' | ')}）`);
      process.exit(1);
    }
  }
  const collected = collectStates();
  await withLock(async () => {
    for (const name of targets) {
      if (name === 'clt') await installClt(force);
      if (name === 'dotnet') await installDotnet(force);
      if (name === 'runtime-pack') {
        await installRuntimePack(force, collected.states.pack.explicitArchive);
      }
    }
    writeEnvToolchain();
  });
}

// ---------------------------------------------------------------------------
// CLI 解析
// ---------------------------------------------------------------------------

// 子命令与标志解析：ensure（默认）/ status / install
const argv = process.argv.slice(2);
const first = argv[0];
const command = first !== undefined && !first.startsWith('--') ? first : 'ensure';
const flags = new Set(argv.filter(arg => arg.startsWith('--')));
const yesFlag = flags.has('--yes');
const noFlag = flags.has('--no');
const forceFlag = flags.has('--force');
const forIndex = argv.indexOf('--for');
const scope = forIndex !== -1 ? argv[forIndex + 1] : undefined;
if (scope && !SCOPES[scope]) {
  console.error(`[env] 未知 scope：${scope}（可选：${Object.keys(SCOPES).join(' | ')}）`);
  process.exit(1);
}

// TESSLO_BOOTSTRAP=off：完全跳过（离线装依赖、只改 web 等场景）
if (process.env.TESSLO_BOOTSTRAP !== 'off') {
  if (command === 'status') {
    cmdStatus();
  } else if (command === 'install') {
    const names = argv.slice(1).filter(arg => !arg.startsWith('--'));
    await cmdInstall(names, forceFlag);
  } else {
    await cmdEnsure(scope, yesFlag, noFlag);
  }
}
