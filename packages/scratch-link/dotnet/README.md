# C# Scratch Link

C# implementation of the Scratch Link protocol for Tesslo.

- `Tesslo.Link/` — protocol server, WebSocket handshake, JSON-RPC, BLE bridge client.
- `Tesslo.Link.Server/` — net9.0 host executable for local testing.
- `Tesslo.Link.Native/` — NativeAOT shared library exporting C entry points.
- `napi/libtesslolink.so` — NAPI bridge used by the HarmonyOS host.
- `OhosBleBridge.cs` — C# client for `127.0.0.1:20113` (`BleTcpBridge.ets`).

Build:

```bash
pnpm build:link:csharp
```

Requires .NET SDK 9.0.104 and OHOS Native SDK 26. The command publishes the
NativeAOT library, builds the NAPI bridge, and deploys the libs to
`apps/tesslo/ohos/electron/libs/arm64-v8a`.

Runtime on device:

- ArkTS `EntryAbility` starts the C# server on `127.0.0.1:20111`.
- Electron main skips the TypeScript link when `libtesslolink.so` exists.
- BLE scan is real; GATT connect/getServices/read/write/notifications are
  implemented over the ArkTS bridge.

Simulated devices (no hardware):

```bash
pnpm dev:ohos -- --ble-sim --device <serial>
```

Then load the micro:bit or WeDo extension in Tesslo and connect to the
`BBC micro:bit [tesslo]` / `LEGO WeDo 2.0 [tesslo]` peripheral.

Real hardware: launch without `--ble-sim`, load the extension, and connect the
advertising device.

Remaining: BT Classic, full state-machine parity, micro:bit/WeDo hardware
regression.
