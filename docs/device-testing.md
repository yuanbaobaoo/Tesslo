# Device testing (HarmonyOS 7)

## Prepare

- HarmonyOS 7 device with developer mode and USB debugging enabled.
- `hdc list targets` shows the device serial.
- HarmonyOS SDK 26 command line tools and JDK 21 available. `scripts/ohos-common.mjs`
  auto-detects `OHOS_COMMAND_LINE_TOOLS_ROOT`, `~/command-line-tools`, or
  `hvigorw` on PATH.
- .NET SDK 9.0.104 at `~/.dotnet` (or `DOTNET_ROOT`) for the C# link.

Signing is device/account bound. If `apps/ohos/build-profile.json5` was generated
for an emulator, remove it and let `dev:ohos` regenerate:

```sh
rm -f apps/ohos/build-profile.json5
pnpm dev:ohos -- --device <serial>
```

`build-profile.json5` and files under `~/.ohos/config` are local; do not commit them.

## Build and install

```sh
pnpm build
pnpm build:link:csharp
pnpm build:hap                         # unsigned HAP
pnpm build:hap -- --signed             # signed HAP
pnpm dev:ohos -- --device <serial>     # signed build + install + launch + evidence
```

`dev:ohos` writes `build/verify/<serial>-tesslo-main.log` and
`build/verify/<serial>-tesslo.jpeg`. Accept permission prompts on the device.

## Pass criteria

### Editor / WebGL

`build/verify/<serial>-tesslo-main.log` must contain:

```text
webgl probe {"webgl":true,"webgl2":true,...}
```

If false, capture the probe line, `hdc shell param get const.product.model`,
`hdc shell param get const.ohos.apiversion`, and any
`cppcrash-org.tesslo.app-*` log.

### C# Scratch Link

The main log should contain:

```text
C# Scratch Link present at .../libtesslolink.so; skipping JS link
```

The link log is `/data/app/el2/100/base/org.tesslo.app/files/tesslo-link.log`.
Host verification:

```sh
hdc -t <serial> fport tcp:20111 tcp:20111
node -e 'const W=require("ws");const w=new W("ws://127.0.0.1:20111/scratch/ble");w.on("open",()=>w.send(JSON.stringify({jsonrpc:"2.0",id:1,method:"getVersion"})));w.on("message",m=>{console.log(m.toString());w.close()})'
```

### Simulated micro:bit / WeDo

When no hardware is available, launch the HAP with the simulator (also enabled
automatically on emulator images):

```sh
pnpm dev:ohos -- --ble-sim --device <serial>
```

The ArkTS BLE bridge then advertises two virtual peripherals:

- `BBC micro:bit [tesslo]` — service `0000f005-...`, RX/TX characteristics.
- `LEGO WeDo 2.0 [tesslo]` — `00001523-...` + `00004f0e-...` services.

In Tesslo, load the micro:bit or WeDo 2.0 extension and connect to the matching
`[tesslo]` peripheral. Confirm discover → connect → getServices → notify/read/
write in the editor. The simulated result has been verified for both devices.

### Real micro:bit / WeDo

Launch without `--ble-sim`, make sure the device is advertising and not paired
to another host, then load the extension in Tesslo and connect. Confirm:

- micro:bit: display text, button/tilt notifications.
- WeDo: ATTACHED_IO notifications, battery read, LED/motor command.

Pass means the device is discovered, the service is present, and writes and
subscriptions return without a protocol error.

### File save/open

1. `文件 → 保存到电脑`; confirm the picker defaults to `Scratch作品.sb3`.
2. Tap 保存 manually (the system picker rejects synthetic input).
3. Reopen with `文件 → 从电脑中上传`.

## Emulator limits

- No WebGL: Electron and ArkWeb both report `webgl=false`; UI renders, stage does not.
- No Bluetooth hardware: scanning reports `Bluetooth is off`/no devices.
- System permission and file pickers reject synthetic taps; a human tap is required.
