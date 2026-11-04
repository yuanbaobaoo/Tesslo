import fs from 'node:fs';
import path from 'node:path';

import {
  abilityName,
  buildHap,
  devBundleName,
  ensureDevices,
  errorMessage,
  findHap,
  listDevices,
  moduleDeviceTypes,
  parseEmulatorArgs,
  repoRoot,
  resolveToolchain,
  run
} from './ohos-common.ts';

// 命令行参数：--device <serial> 指定单台设备；--ble-sim 以模拟外设启动 BLE；
// --resign 强制重新生成 dev 调试签名（新设备未生效、profile 异常时用）；
// 模拟器参数（--emulator / --emulator-device-type / --emulator-os-version /
// --no-emulator）仅在无设备时生效；组合约束在 try 内校验（parseEmulatorArgs），
// 非法组合走统一的错误出口
const argv = process.argv.slice(2);
const args = new Set(argv);
const deviceIndex = argv.indexOf('--device');
const requestedDevice = deviceIndex !== -1 ? argv[deviceIndex + 1] : undefined;
const bleSim = args.has('--ble-sim');

// 部署调试身份（dev product）：独立包名与桌面名 Tesslo-dev，不覆盖设备上的正式版
const product = 'dev';
const bundleName = devBundleName;

// 等待应用冷启动与权限弹窗；首启授权需要人工在设备上确认
const STARTUP_WAIT_MS = 15000;

// 验证证据目录：安装后拉回的设备日志与截图落在这里，供人工核对
const evidenceDir = path.join(repoRoot, 'build/verify');
fs.mkdirSync(evidenceDir, {recursive: true});

try {
  const emulatorOptions = parseEmulatorArgs(argv);
  const toolchain = resolveToolchain();
  // 先确认设备再构建：生成 dev 调试签名要注册设备，也避免无设备时白跑长构建。
  // 无设备且未用 --device 指定序列号时，自动启动已有模拟器或交互创建（dev:ohos 专属）
  let devices = listDevices(toolchain.hdc).filter(serial =>
    requestedDevice ? serial === requestedDevice : true
  );
  if (devices.length === 0 && requestedDevice === undefined) {
    await ensureDevices(toolchain, {deviceTypes: moduleDeviceTypes(), emulator: emulatorOptions});
    devices = listDevices(toolchain.hdc);
  }
  if (devices.length === 0) {
    throw new Error(
      requestedDevice
        ? `device ${requestedDevice} is not in hdc list targets`
        : 'hdc list targets is empty; connect a HarmonyOS device'
    );
  }

  // 本次部署的 HAP 路径：--skip-build 复用已有签名包，否则现场构建；
  // allowLogin 让签名确实需要生成时先引导登录华为账号（其它构建入口不开启）
  let hap = '';
  if (args.has('--skip-build')) {
    const found = findHap({signed: true, product});
    if (!found) throw new Error('no signed dev HAP found; run without --skip-build first');
    hap = found;
  } else {
    hap = buildHap({
      build: args.has('--build'),
      signed: true,
      product,
      resign: args.has('--resign'),
      allowLogin: true
    }).hap;
  }

  for (const serial of devices) {
    console.log(`[dev:ohos] ${serial}: force-stop ${bundleName}`);
    try {
      run(toolchain.hdc, ['-t', serial, 'shell', 'aa', 'force-stop', bundleName], {
        stdio: 'ignore'
      });
    } catch {
      // app may not be running yet
    }

    console.log(`[dev:ohos] ${serial}: install ${path.basename(hap)}`);
    try {
      run(toolchain.hdc, ['-t', serial, 'install', '-r', hap], {stdio: 'ignore'});
    } catch {
      console.log('[dev:ohos] update failed; uninstalling and reinstalling');
      try {
        run(toolchain.hdc, ['-t', serial, 'uninstall', bundleName], {stdio: 'ignore'});
      } catch {
        // best effort：应用可能尚未安装过
      }
      // 重装失败直接抛出，由外层统一报告
      try {
        run(toolchain.hdc, ['-t', serial, 'install', hap], {stdio: 'ignore'});
      } catch (error) {
        throw new Error(`${errorMessage(error)}（若签名已失效，可加 --resign 重新生成 dev 调试签名）`);
      }
    }

    console.log(`[dev:ohos] ${serial}: start ${abilityName}`);
    // AbilityStage 的 filesDir 可能落在模块级 haps/entry/files，也可能在应用级 files
    const remoteLogs = [
      `/data/app/el2/100/base/${bundleName}/haps/entry/files/tesslo-main.log`,
      `/data/app/el2/100/base/${bundleName}/files/tesslo-main.log`
    ];
    for (const remoteLog of remoteLogs) {
      try {
        run(toolchain.hdc, ['-t', serial, 'shell', 'rm', '-f', remoteLog], {stdio: 'ignore'});
      } catch {
        // log may not exist yet
      }
    }
    const startArgs = ['-t', serial, 'shell', 'aa', 'start', '-a', abilityName, '-b', bundleName];
    if (bleSim) startArgs.push('--ps', 'tessloBleSim', 'true');
    run(toolchain.hdc, startArgs, {stdio: 'ignore'});

    console.log('[dev:ohos] waiting for startup; accept permission prompts on the device');
    await new Promise(resolve => setTimeout(resolve, STARTUP_WAIT_MS));

    const localLog = path.join(evidenceDir, `${serial}-tesslo-main.log`);
    fs.rmSync(localLog, {force: true});
    let hasLog = false;
    for (const remoteLog of remoteLogs) {
      try {
        run(toolchain.hdc, ['-t', serial, 'file', 'recv', remoteLog, localLog], {stdio: 'ignore'});
        if (fs.existsSync(localLog) && fs.statSync(localLog).size > 0) {
          hasLog = true;
          break;
        }
      } catch {
        // try next candidate
      }
    }
    if (hasLog) {
      const log = fs.readFileSync(localLog, 'utf8');
      const interesting = log
        .split(/\r?\n/)
        .filter(line => /boot |Scratch Link|BLE bridge|webgl probe|page (begin|end)|error/i.test(line))
        .slice(-12);
      if (interesting.length) console.log(interesting.join('\n'));
    } else {
      console.log('[dev:ohos] main log not available yet');
    }

    const remoteShot = `/data/local/tmp/tesslo-${serial}.jpeg`;
    const localShot = path.join(evidenceDir, `${serial}-tesslo.jpeg`);
    try {
      run(
        toolchain.hdc,
        ['-t', serial, 'shell', 'snapshot_display', '-f', remoteShot],
        {stdio: 'ignore'}
      );
      run(toolchain.hdc, ['-t', serial, 'file', 'recv', remoteShot, localShot], {
        stdio: 'ignore'
      });
      console.log(`[dev:ohos] screenshot: ${localShot}`);
    } catch {
      console.log('[dev:ohos] screenshot unavailable');
    }
  }
} catch (error) {
  console.error(`[dev:ohos] ${errorMessage(error)}`);
  process.exit(1);
}
