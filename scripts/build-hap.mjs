// HAP/App 构建入口：pnpm build:hap | build:app [--build] [--signed]
// 默认产出未签名包（对齐 CI）；--signed 走签名流程；
// --app 走 assembleApp 产出上架用 App 包（工程级 build/outputs）
import {buildPackage} from './ohos-common.mjs';

const args = new Set(process.argv.slice(2));
const mode = args.has('--app') ? 'app' : 'hap';

try {
  const {artifact} = buildPackage({build: args.has('--build'), signed: args.has('--signed'), mode});
  console.log(artifact);
} catch (error) {
  console.error(`[build:${mode === 'app' ? 'app' : 'hap'}] ${error.message}`);
  process.exit(1);
}
