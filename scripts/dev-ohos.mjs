import fs from 'node:fs';
import path from 'node:path';

import {
    abilityName,
    buildHap,
    bundleName,
    findHap,
    listDevices,
    repoRoot,
    resolveToolchain,
    run
} from './ohos-common.mjs';

const argv = process.argv.slice(2);
const args = new Set(argv);
const deviceIndex = argv.indexOf('--device');
const requestedDevice = deviceIndex !== -1 ? argv[deviceIndex + 1] : undefined;
const bleSim = args.has('--ble-sim');

const evidenceDir = path.join(repoRoot, 'build/verify');
fs.mkdirSync(evidenceDir, {recursive: true});

try {
    const toolchain = resolveToolchain();
    let hap;
    if (args.has('--skip-build')) {
        hap = findHap({signed: true});
        if (!hap) throw new Error('no signed HAP found; run without --skip-build first');
    } else {
        ({hap} = buildHap({build: args.has('--build'), signed: true}));
    }

    const devices = listDevices(toolchain.hdc).filter(serial =>
        requestedDevice ? serial === requestedDevice : true
    );
    if (devices.length === 0) {
        throw new Error(
            requestedDevice
                ? `device ${requestedDevice} is not in hdc list targets`
                : 'hdc list targets is empty; connect a HarmonyOS device'
        );
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
        let installed = false;
        try {
            run(toolchain.hdc, ['-t', serial, 'install', '-r', hap], {stdio: 'ignore'});
            installed = true;
        } catch {
            console.log('[dev:ohos] update failed; uninstalling and reinstalling');
            try {
                run(toolchain.hdc, ['-t', serial, 'uninstall', bundleName], {stdio: 'ignore'});
            } catch {
                // best effort
            }
            run(toolchain.hdc, ['-t', serial, 'install', hap], {stdio: 'ignore'});
            installed = true;
        }
        if (!installed) throw new Error('install failed');

        console.log(`[dev:ohos] ${serial}: start ${abilityName}`);
        const remoteLog = `/data/app/el2/100/base/${bundleName}/files/tesslo-main.log`;
        try {
            run(toolchain.hdc, ['-t', serial, 'shell', 'rm', '-f', remoteLog], {stdio: 'ignore'});
        } catch {
            // log may not exist yet
        }
        const startArgs = ['-t', serial, 'shell', 'aa', 'start', '-a', abilityName, '-b', bundleName];
        if (bleSim) startArgs.push('--ps', 'tessloBleSim', 'true');
        run(toolchain.hdc, startArgs, {stdio: 'ignore'});

        console.log('[dev:ohos] waiting for startup; accept permission prompts on the device');
        await new Promise(resolve => setTimeout(resolve, 15000));

        const localLog = path.join(evidenceDir, `${serial}-tesslo-main.log`);
        try {
            run(toolchain.hdc, ['-t', serial, 'file', 'recv', remoteLog, localLog], {stdio: 'ignore'});
            const log = fs.existsSync(localLog) ? fs.readFileSync(localLog, 'utf8') : '';
            const interesting = log
                .split(/\r?\n/)
                .filter(line => /boot |Scratch Link|BLE bridge|webgl probe|page (begin|end)|error/i.test(line))
                .slice(-12);
            if (interesting.length) console.log(interesting.join('\n'));
        } catch {
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
    console.error(`[dev:ohos] ${error.message}`);
    process.exit(1);
}
