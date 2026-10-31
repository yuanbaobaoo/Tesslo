// HAP 构建入口：pnpm build:hap [--build] [--signed]
// --build 强制重建编辑器；不带 --signed 时产出未签名包（CI 构建）
import {buildHap} from './ohos-common.mjs';

const args = new Set(process.argv.slice(2));

try {
  const signed = args.has('--signed');
  const {hap} = buildHap({build: args.has('--build'), signed});
  console.log(hap);
} catch (error) {
  console.error(`[build:hap] ${error.message}`);
  process.exit(1);
}
