# Device testing (HarmonyOS 7)

Emulators can verify startup, UI, DOM, media paths, the VM, Scratch Link, and web dialogs.
They cannot verify WebGL or Bluetooth: the HarmonyOS 7 emulator images have no WebGL backend and no Bluetooth hardware. Run the checks below on a real tablet or 2in1 device.

## 1. Prepare

- HarmonyOS 7 device with developer mode and USB debugging enabled.
- `hdc list targets` shows the device serial.
- HarmonyOS SDK 26 command line tools and JDK 21 available; `scripts/ohos-common.mjs`
  auto-detects `OHOS_COMMAND_LINE_TOOLS_ROOT`, `~/command-line-tools`, or `hvigorw` on PATH.

Signing is device/account bound. If the local `apps/ohos/build-profile.json5` was generated against an emulator, remove it and regenerate:

```sh
rm -f apps/ohos/build-profile.json5
hdc list targets          # confirm the physical device is the only target
pnpm dev:ohos -- --device <serial>  # builds signed HAP, installs, launches, collects evidence
```

`build-profile.json5` is gitignored; never commit it or files under `~/.ohos/config`.

## 2. Build and install

```sh
pnpm build:hap                         # unsigned HAP
pnpm build:hap -- --signed             # signed HAP
pnpm dev:ohos -- --device <serial>     # signed build + install + launch + evidence
```

`dev:ohos` installs the HAP, launches Tesslo, waits for startup, and writes
`build/verify/<serial>-tesslo-main.log` plus `build/verify/<serial>-tesslo.jpeg`.
Accept the clipboard and Bluetooth permission prompts on the device when they appear.

## 3. Pass criteria

### WebGL

`build/verify/tesslo-main.log` must contain:

```text
webgl probe {"webgl":true,"webgl2":true,...}
```

If both are `false`, the stage, paint editor, pen, and costume thumbnails will not work. Capture:
- the probe line,
- `hdc shell param get const.product.model`,
- `hdc shell param get const.ohos.apiversion`,
- any `cppcrash-org.tesslo.app-*` log under `/data/log/faultlog/faultlogger/`.

### Scratch Link / BLE

1. Enable Bluetooth.
2. Add the micro:bit extension in Tesslo; the first use shows the "发现和连接附近的设备" prompt.
3. Pair/connect a micro:bit and confirm blocks report data.

The device-side server listens on `127.0.0.1:20111`; host debugging:

```sh
hdc fport tcp:20111 tcp:20111
node packages/protocol-tests/test/conformance.test.js   # optional host-side probe
```

### File save/open

1. `文件 → 保存到电脑`; confirm the system picker defaults to `Scratch作品.sb3` and the `.sb3` filter.
2. Tap 保存 manually (the system picker rejects synthetic input) and check the Downloads folder.
3. Reopen the saved file with `文件 → 从电脑中上传`.

## 4. Known emulator limits

- No WebGL: Electron and ArkWeb both report `webgl=false`; UI renders, stage does not.
- No Bluetooth hardware: the ArkTS scan call returns `Bluetooth disabled`.
- System permission and file pickers reject `uinput`/`uitest` taps; a human tap is required.

These are environment limits, not Tesslo regressions. Record device evidence in `docs/status.md` when a real device run completes.
