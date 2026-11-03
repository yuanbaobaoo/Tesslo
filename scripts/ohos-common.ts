import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {type SpawnSyncOptions, type SpawnSyncReturns, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

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
  hvigorw: string;
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
export const abilityName = 'EntryAbility';

// Windows 下 pnpm 是 .cmd，spawnSync 需要显式带后缀
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

/**
 * 同步执行命令并继承输出；非零退出码直接抛错中止构建。
 *
 * @param command - 可执行文件
 * @param args - 参数列表
 * @param options - spawnSync 透传选项
 * @returns spawnSync 结果（status/stderr 等）
 */
export function run(command: string, args: string[], options: SpawnSyncOptions = {}): SpawnSyncReturns<string | Buffer> {
  const result = spawnSync(command, args, {stdio: 'inherit', ...options});
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
  const result = spawnSync(command, args, {encoding: 'utf-8'});
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

// CLT 位置解析（与 env.mjs 同一套链，不做任何机器路径猜测）：
// 1. DEVECO_CLI_CLT_PATH（devecocli 标准变量；真实环境变量或 .env 显式声明）
// 2. PATH 反推：hvigorw 位于 <clt>/bin，hdc 位于 <clt>/sdk/default/openharmony/toolchains
// 3. .toolchain/command-line-tools（env.mjs 自愈安装的约定落点）
function commandLineToolCandidates(): string[] {
  const candidates: string[] = [];
  if (process.env.DEVECO_CLI_CLT_PATH) {
    candidates.push(process.env.DEVECO_CLI_CLT_PATH);
  }
  const hvigorw = capture('sh', ['-c', 'command -v hvigorw']);
  if (hvigorw) candidates.push(path.resolve(path.dirname(hvigorw), '..'));
  const hdc = capture('sh', ['-c', 'command -v hdc']);
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
 * 定位 OHOS 命令行工具链与 JDK，返回 hvigorw/hdc 路径和注入好的构建环境变量。
 *
 * @returns 工具链路径与构建环境；找不到时抛错并给出设置指引
 */
export function resolveToolchain(): Toolchain {
  const root = commandLineToolCandidates().find(candidate =>
    fs.existsSync(path.join(candidate, 'bin/hvigorw'))
  );
  if (!root) {
    throw new Error(
      'OHOS command-line-tools not found. Set DEVECO_CLI_CLT_PATH ' +
        '(in .env or environment), run `pnpm env:install clt`, or put hvigorw on PATH.'
    );
  }
  const hdc = path.join(root, 'sdk/default/openharmony/toolchains/hdc');
  if (!fs.existsSync(hdc)) throw new Error(`hdc not found at ${hdc}`);
  const javaCandidates = [
    process.env.JAVA_HOME,
    process.env.HOME && path.join(process.env.HOME, '.sdkman/candidates/java/21.0.11-tem'),
    process.env.HOME && path.join(process.env.HOME, '.sdkman/candidates/java/current')
  ].filter((candidate): candidate is string => Boolean(candidate));
  const javaHome = javaCandidates.find(candidate => fs.existsSync(path.join(candidate, 'bin/java'))) ?? null;
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
  return {root, hvigorw: path.join(root, 'bin/hvigorw'), hdc, javaHome, env};
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

// 在 build-profile.json5 的 signingConfigs 数组区域内查找指定名称的配置。
// 不能全文件搜索 name: 'xxx'：products / buildModeSet / targets 里会有同名项。
function hasSigningConfigNamed(text: string, name: string): boolean {
  const signingIdx = text.indexOf('signingConfigs');
  if (signingIdx === -1) return false;
  const closeIdx = text.indexOf('\n    ],', signingIdx);
  const region = closeIdx === -1 ? text.slice(signingIdx) : text.slice(signingIdx, closeIdx);
  return new RegExp(`name:\\s*'${name}'`).test(region);
}

/**
 * 签名构建前置：没有签名配置时用 devecocli 生成本地调试签名材料。
 * devecocli 是 workspace devDependency，经 pnpm exec 调用，不依赖全局安装。
 */
export function ensureSigning(): void {
  const profile = path.join(hapRoot, 'build-profile.json5');
  ensureProfile();
  const text = fs.readFileSync(profile, 'utf8');
  // 只看 default（调试）配置是否缺失：即使 release 配置已单独存在，也能生成调试签名
  if (!hasSigningConfigNamed(text, 'default')) {
    console.log('[ohos] no default signing config; generating debug signing material with devecocli');
    const toolchain = resolveToolchain();
    runPnpm(['exec', 'devecocli', 'signature', 'generate', '--product', 'default'], {
      cwd: hapRoot,
      env: {...toolchain.env, DEVECO_CLI_CLT_PATH: toolchain.root}
    });
  }
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
 * @returns keytool 路径；工具链缺失时返回 null
 */
export function findKeytool(): string | null {
  try {
    const {javaHome} = resolveToolchain();
    const keytool = javaHome && path.join(javaHome, 'bin/keytool');
    return keytool && fs.existsSync(keytool) ? keytool : null;
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
 * 在产物目录里找 HAP；signed=true 时缺签名包返回 null，绝不回退未签名包。
 *
 * @param opts.signed - true 只认签名包；false 优先未签名包
 * @returns 产物路径；不存在时返回 null
 */
export function findHap({signed = true}: {signed?: boolean} = {}): string | null {
  return findArtifact({
    signed,
    dir: path.join(hapRoot, 'entry/build/default/outputs/default'),
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
 *
 * @param opts.build - 强制重建编辑器
 * @param opts.signed - 签名开关（默认 false 出未签名包）
 * @param opts.mode - 'hap' | 'app'（默认 hap）
 * @param opts.product - 选择的 product 名（App 默认由调用方传 'release'）
 * @returns 产物路径与工具链信息
 */
export function buildPackage({build = false, signed = false, mode = 'hap', product = 'default'}: PackageOptions = {}): PackageResult {
  const toolchain = resolveToolchain();
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
  ensureSigning();
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
  run(
    toolchain.hvigorw,
    [task, '--mode', hvigorMode, '-p', `product=${product}`, '-p', `buildMode=${buildMode}`, '--no-daemon'],
    {cwd: hapRoot, env: toolchain.env}
  );
  const artifact = mode === 'app' ? findApp({signed, product}) : findHap({signed});
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
