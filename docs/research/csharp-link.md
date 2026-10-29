# Scratch Link on HarmonyOS with C# — feasibility notes

Date: 2026-10-29

## Finding

HarmonyOS 5.0.0(12)+ forbids anonymous executable memory, so CoreCLR and Mono
are not viable. The working route is **.NET NativeAOT** compiled for
`linux-musl-arm64` and loaded from the HAP sandbox as a shared library.

GitCode repositories checked:

| Repository | What it is | Status |
|---|---|---|
| `OpenHarmonyPCDeveloper/ohos_net-opensource` | OHOS NativeAOT runtime pack, host-portable cross targets, NAPI `RegisterEntryModule` entry, `hello`/Avalonia samples, prebuilt native libs | Active, concrete |
| `JaneConan/OpenHarmony-NET` | README/license-only placeholder (136 KB) | Not usable as a runtime |
| `Andy88/Harmony-PixiEditor` | Real application ported with the same channel | Reference |

Upstream references: `OpenHarmony-NET/OpenHarmony.Avalonia` (archived 2026-05),
`OpenHarmony-NET/PublishAotCross`, `OpenHarmony.NET.Runtime`,
`OpenHarmony.NDK.Bindings`.

Known-good toolchain from `ohos_net-opensource`:

- .NET SDK 9.0.104
- OHOS Native SDK API 26
- Runtime pack `OpenHarmony.NET.Runtime 0.0.0-alpha.19`
- `dotnet publish -r linux-musl-arm64 -p:OpenHarmonyApiLevel=26 -p:OpenHarmonyAbi=arm64-v8a -p:OpenHarmonySdkRoot=<sdk>`
- Output is a `lib<name>.so` exporting `RegisterEntryModule`; ArkTS/NAPI `dlopen`s it.

## Mapping to Scratch Link

| Scratch Link part | C# on HarmonyOS |
|---|---|
| JSON-RPC / session state machine | Reuse the upstream C# common code, ported to `net9.0` |
| WebSocket server on 127.0.0.1:20111 | Plain TCP/HTTP upgrade in C# (`System.Net.Sockets`; test `HttpListener`/WebSocket AOT support) |
| BLE GATT | ArkTS `@ohos.bluetooth.ble` behind a C#↔ArkTS command/event bridge, or NDK P/Invoke if the BLE NDK is available |
| BT Classic / RFCOMM | ArkTS `@ohos.bluetooth.socket` bridge, same contract |
| Packaging | `libtesslo-link.so` + NativeAOT native libs + ArkTS NAPI shim in HAP `entry/libs/arm64-v8a`; ArkTS starts the server, Electron main connects to 20111 |

The protocol server stays in C#; only the OHOS Bluetooth transport remains
ArkTS, because HarmonyOS exposes BLE/BT through ArkTS system APIs. This is the
maximum C# reuse without reimplementing the Bluetooth stack.

## Risks

- `HttpListener`/`WebSocket` NativeAOT compatibility is unproven; a raw socket
  implementation may be needed.
- The runtime pack ships `libssl.so.3` but no `libcrypto.so`; avoid crypto or
  ship a musl `libcrypto`.
- HarmonyOS seccomp and the JIT ban require the patched runtime pack; do not
  substitute a stock pack.
- `Marshal.GetDelegateForFunctionPointer` can crash without JIT; use function
  pointers.
- Runtime pack and NDK bindings upstreams have no LICENSE file; commercial
  redistribution needs upstream clarification.
- The upstream Avalonia/.NET project was archived in 2026-05; treat
  `ohos_net-opensource` as the maintained practical baseline and pin it.

## Spike results (2026-10-29)

- .NET SDK 9.0.104 installed locally; `vendor/ohos-net` contains the OHOS
  NativeAOT runtime pack, host-portable cross targets, and the `hello` sample.
- `samples/hello` cross-compiled to an aarch64 Linux-musl ELF.
- `packages/link/dotnet/Tesslo.Link.Server` passed host `getVersion` and
  `discover` tests.
- `Tesslo.Link.Native` produces `TessloLinkNative.so`; `napi/libtesslolink.so`
  is the small NAPI bridge. Both are deployed to `apps/ohos/electron/libs`.
- On the real device, the ArkTS `EntryAbility` starts the C# server on
  `127.0.0.1:20111`; the Electron main process detects the C# library and skips
  the JS link server. `getVersion` and `discover` pass through `hdc fport`.
- Two runtime-specific fixes were required: bundle `libc++_shared.so` for the
  NAPI bridge, and use a managed SHA-1 for the WebSocket handshake because the
  runtime pack has no `libcrypto.so`.
- BLE scan is now real: `web_engine/src/main/ets/ble/BleTcpBridge.ets` exposes
  `@ohos.bluetooth.ble` over `127.0.0.1:20113`; C# `discover` connected, scanned,
  and received 43–75 devices on the real device. GATT connect/getServices/read/
  write/notifications are implemented and compiled; hardware regression and BT
  Classic remain.

## Spike plan

1. Build `samples/hello` with the `ohos_net-opensource` toolchain.
2. Build a minimal `libtesslo-link.so` that starts a TCP/WebSocket listener and
   answers `getVersion`.
3. Load it from the HAP through a small NAPI `RegisterEntryModule` shim; start
   it from ArkTS and connect from the Electron renderer.
4. Port the session/JSON-RPC core and the fake BLE endpoint; run the existing
   conformance tests against it.
5. Add the ArkTS BLE/BT bridge; verify micro:bit/WeDo on device.
6. Compare startup, memory, latency, and crash behavior with the TS server.

Decision gate: if steps 1–4 pass on a real device, replace the TS server with
the C# implementation. Otherwise keep the working TS server and reuse only the
C# protocol core behind the same adapter contract.

## Sources

- <https://gitcode.com/OpenHarmonyPCDeveloper/ohos_net-opensource>
- <https://gitcode.com/JaneConan/OpenHarmony-NET>
- <https://gitcode.com/Andy88/Harmony-PixiEditor>
- <https://github.com/OpenHarmony-NET/OpenHarmony.Avalonia>
- <https://github.com/OpenHarmony-NET/PublishAotCross>
