// 生成交付用的密钥库与 CSR：pnpm signing:keygen [--force]
// 交互式询问：证书名称（文件名、密钥别名与证书 CN——CN 只是本地自签证书的
// 占位主题，AGC 签发时会按账号重新生成，与应用包名无关）、密码（不回显，输两遍）。
// 产物默认写到当前目录 .certs/ 下：<名称>.p12（0600）与 <名称>.csr。
// .certs/ 含私钥，已入 .gitignore。
// 后续：AGC「证书管理」上传 CSR 申请发布证书下载 .cer，「Profile 管理」申请
// 发布 Profile 下载 .p7b；再把材料路径、keyAlias、密码手工填进
// build-profile.json5 的 release signingConfig（见 docs/release-signing.md）。
// 注意：同名重新生成会作废用旧密钥签发的证书，需 --force 并二次确认。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {bundleName, createPrompts, errorMessage, findKeytool} from './ohos-common.ts';
import {encryptPassword} from './signing-encrypt.ts';

const args = new Set(process.argv.slice(2));

try {
  if (!process.stdin.isTTY) {
    throw new Error('请在终端交互运行（需要输入名称与密码）');
  }
  const keytool = findKeytool();
  if (!keytool) {
    throw new Error('未找到 JDK keytool（JDK 是构建前置硬依赖，见 docs/build.md）');
  }
  const prompts = createPrompts();

  const certName = (await prompts.line(`证书名称（文件名、密钥别名与证书 CN，默认 app-release）：`) || 'app-release');
  if (!/^[A-Za-z0-9._-]+$/.test(certName)) {
    throw new Error('证书名称只能包含字母、数字、点、下划线、连字符');
  }

  const outDir = path.resolve('.certs');
  const p12 = path.join(outDir, `${certName}.p12`);
  const csr = path.join(outDir, `${certName}.csr`);
  if (fs.existsSync(p12)) {
    if (!args.has('--force')) {
      throw new Error(
        `${p12} 已存在。同名重新生成会作废用旧密钥签发的证书；确认请加 --force`
      );
    }
    const yes = (await prompts.line(`重新生成将作废用 ${certName} 旧密钥签发的证书，确认请输入 yes：`)).toLowerCase();
    if (yes !== 'yes') throw new Error('已取消，未做任何改动');
  }

  const password = await prompts.password('设置密钥库密码（不回显）：');
  const confirmed = await prompts.password('再输入一次确认（不回显）：');
  prompts.close();
  if (!password) throw new Error('密码为空，已取消');
  if (password !== confirmed) throw new Error('两次输入不一致，已取消');

  fs.mkdirSync(outDir, {recursive: true});
  // 密码经 0600 临时文件传递，不上命令行
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tesslo-keygen-'));
  const pwFile = path.join(tmpDir, 'pw');
  try {
    fs.writeFileSync(pwFile, password, {mode: 0o600});
    const gen = spawnSync(
      keytool,
      [
        '-genkeypair', '-keystore', p12, '-storetype', 'PKCS12',
        '-alias', certName, '-keyalg', 'EC', '-groupname', 'secp256r1',
        '-dname', `CN=${certName}`,
        '-storepass:file', pwFile, '-keypass:file', pwFile
      ],
      {encoding: 'utf8'}
    );
    if (gen.status !== 0) throw new Error(`keytool -genkeypair 失败：${gen.stderr}`);
    const req = spawnSync(
      keytool,
      [
        '-certreq', '-keystore', p12, '-storetype', 'PKCS12',
        '-alias', certName, '-file', csr, '-storepass:file', pwFile
      ],
      {encoding: 'utf8'}
    );
    if (req.status !== 0) throw new Error(`keytool -certreq 失败：${req.stderr}`);
  } finally {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  }
  fs.chmodSync(p12, 0o600);
  if (!fs.existsSync(csr)) throw new Error('CSR 未生成');
  console.log(`[signing:keygen] 密钥库：${p12}（0600）`);
  console.log(`[signing:keygen] CSR：${csr}`);
  // hvigor 只认 DevEco 密文格式的密码（明文报 00303116），顺手给出，免得再跑一次加密工具
  let encrypted: string | null = null;
  try {
    encrypted = encryptPassword(password);
  } catch (error) {
    console.log(`[signing:keygen] 无法生成密码密文（${errorMessage(error)}）`);
  }
  if (encrypted) {
    console.log('[signing:keygen] keyPassword/storePassword 密文（两处填同一串）：');
    console.log(encrypted);
  }
  console.log(`
接下来（发布证书只能由 AGC 签发，devecocli 仅支持调试签名）：
  1. AGC「证书管理」上传 ${csr} 申请【发布证书】，下载 .cer
  2. AGC「Profile 管理」申请【发布】Profile（选该证书 + ${bundleName}），下载 .p7b
  3. 把材料路径、keyAlias（即 ${certName}）与密码手工填进 build-profile.json5
     的 release signingConfig（字段说明见 docs/release-signing.md；
     certpath 必须是单证书文件，证书链需自行拆出叶子证书）
  4. pnpm build:app`);
} catch (error) {
  console.error(`[signing:keygen] ${errorMessage(error)}`);
  process.exit(1);
}
