// 把 p12 密码加密成 build-profile.json5 要求的格式：进明文，出密文。
//   pnpm signing:encrypt <明文>
//   echo <明文> | pnpm signing:encrypt
// 背景：hvigor 对 signingConfigs 的 keyPassword/storePassword 只认 DevEco 本机
// 加密格式（AES-128-GCM 密文的 hex，头 4 字节 = 明文长度 + 16），明文一律报
// 00303116。加密密钥不是用户选择的，由 ~/.ohos/config/material/{fd,ac,ce} 派生
// （devecocli/DevEco 生成调试签名时创建；缺失先跑一次 pnpm build:hap --signed），
// 因此通用加密工具无法替代。输出的同一串密文填到 keyPassword 与 storePassword 两处。
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// xorComponents 的硬编码分量（hvigor-ohos-plugin 的 decipher-util.js）
const COMPONENT = Int8Array.from([49, 243, 9, 115, 214, 175, 91, 184, 211, 190, 177, 88, 101, 131, 192, 119]);

// AES-128-GCM 解密（DevEco 密文格式：头 4 字节长度 + iv + 密文 + 16B auth tag）
function gcmDecrypt(key: Buffer, blob: Buffer): Buffer {
  const contentLength = ((blob[0] & 255) << 24) | ((blob[1] & 255) << 16) | ((blob[2] & 255) << 8) | (blob[3] & 255);
  const ivLength = blob.length - 4 - contentLength;
  const decipher = crypto.createDecipheriv('aes-128-gcm', key, blob.subarray(4, 4 + ivLength));
  decipher.setAuthTag(blob.subarray(blob.length - 16));
  return Buffer.concat([decipher.update(blob.subarray(4 + ivLength, blob.length - 16)), decipher.final()]);
}

/**
 * 由本机 material 目录派生工作密钥（与 hvigor DecipherUtil.getKey 一致：
 * fd 三分量与硬编码分量异或 → PBKDF2-SHA256(10000 次, 16B) → 解密 ce 得工作密钥）。
 *
 * @returns 工作密钥；material 目录缺失时抛错并给出指引
 */
export function deriveWorkKey(): Buffer {
  const root = path.join(os.homedir(), '.ohos/config', 'material');
  if (!fs.existsSync(root)) {
    throw new Error(
      `签名材料目录不存在：${root}（先跑一次 pnpm build:hap --signed 让 devecocli 创建）`
    );
  }
  // 读目录里第一个业务文件（过滤 .DS_Store 等 OS 噪声文件）
  const readBytes = (dir: string): Buffer => {
    const names = fs.readdirSync(dir).filter(name => name !== '.DS_Store');
    return fs.readFileSync(path.join(dir, names[0]));
  };
  const fdRoot = path.join(root, 'fd');
  const fdNames = fs.readdirSync(fdRoot).filter(name => name !== '.DS_Store');
  const fdParts = fdNames.map(name => Int8Array.from(readBytes(path.join(fdRoot, name))));
  const salt = readBytes(path.join(root, 'ac'));
  const ce = readBytes(path.join(root, 'ce'));
  let acc = fdParts[0];
  for (const part of [...fdParts.slice(1), COMPONENT]) {
    const next = new Int8Array(acc.length);
    for (let i = 0; i < acc.length; i++) next[i] = acc[i] ^ part[i];
    acc = next;
  }
  // 注意：hvigor 的 xorComponents 返回 Buffer，toString() 默认 utf-8，
  // PBKDF2 以该字符串为口令（不是字节数组）
  const rootKey = crypto.pbkdf2Sync(Buffer.from(acc).toString('utf-8'), salt, 10000, 16, 'sha256');
  return gcmDecrypt(rootKey, ce);
}

/**
 * 明文密码 → build-profile.json5 用的密文 hex（头 4 字节 = 明文长 + 16）。
 *
 * @param plaintext - 明文密码
 * @returns 密文 hex（keyPassword 与 storePassword 共用）
 */
export function encryptPassword(plaintext: string): string {
  const key = deriveWorkKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-128-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf-8')), cipher.final()]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(Buffer.byteLength(plaintext, 'utf-8') + 16);
  return Buffer.concat([header, iv, ciphertext, cipher.getAuthTag()]).toString('hex');
}

// 被 import 时不执行 CLI（keygen 只用 encryptPassword），直接运行才走
const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const arg = process.argv[2];
  try {
    if (arg !== undefined) {
      console.log(encryptPassword(arg));
    } else if (!process.stdin.isTTY) {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      const plaintext = Buffer.concat(chunks).toString('utf-8').split(/\r?\n/)[0];
      if (!plaintext) throw new Error('stdin 为空');
      console.log(encryptPassword(plaintext));
    } else {
      console.error('用法：pnpm signing:encrypt <明文>（或 echo <明文> | pnpm signing:encrypt）');
      process.exit(1);
    }
  } catch (error) {
    console.error(`[signing:encrypt] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
