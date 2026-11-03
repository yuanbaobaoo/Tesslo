// HAP/App 构建入口：
//   pnpm build:hap [--build] [--signed]
//   pnpm build:app [--build] [--product <name>]
// 全链（工具链自检 → 编辑器 → Web → C# Link → hvigor 打包）都在本脚本内完成。
// HAP：debug 模式，product 固定 default；默认未签名，--signed 用 default（调试）
// 签名装真机。
// App：上架产物，buildMode 固定 release。--product 选择 build-profile.json5 里
// 用户声明的 product（默认 release；其 signingConfig 指向上架签名配置）。hvigor
// 没有选择签名配置的命令行参数——签名随 product 声明，多 product +
// -p product=<name> 是唯一的免改写文件方案；构建全程不动 build-profile.json5。
// CI 只产出 HAP，不存在未签名 App。
import {type PackageMode, assertProduct, buildPackage, errorMessage, repoRoot, run, runPnpm} from './ohos-common.ts';

// 命令行参数原样列表与去重集合
const argv = process.argv.slice(2);
const args = new Set(argv);
const mode: PackageMode = args.has('--app') ? 'app' : 'hap';
const productIndex = argv.indexOf('--product');
// --product 的取值参数；未传或缺失时按模式给默认 product
const productArg = productIndex !== -1 ? argv[productIndex + 1] : undefined;
const product = productArg ?? (mode === 'app' ? 'release' : 'default');
if (productIndex !== -1 && mode !== 'app') {
  console.error('[build:hap] --product 仅支持与 --app 搭配使用');
  process.exit(1);
}
// HAP 默认未签名（--signed 开调试签名）；App 恒为 release 签名
const signed = mode === 'app' || args.has('--signed');

try {
  if (mode === 'app') {
    assertProduct(product);
  }
  // 工具链自检前置：缺件在编辑器链路跑起来之前就暴露
  run(process.execPath, ['scripts/env.ts', 'ensure', '--for', mode], {cwd: repoRoot});
  runPnpm(['build:editor']);
  runPnpm(['build:web']);
  runPnpm(['build:link:csharp']);
  const {artifact} = buildPackage({build: args.has('--build'), signed, mode, product});
  console.log(artifact);
} catch (error) {
  console.error(`[build:${mode}] ${errorMessage(error)}`);
  process.exit(1);
}
