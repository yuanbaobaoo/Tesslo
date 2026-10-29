# C# Scratch Link

This directory is the C# implementation of the Scratch Link protocol.

- `Tesslo.Link.Server/` — net9.0 NativeAOT server for OHOS `linux-musl-arm64`.
- Host test: `dotnet run --project packages/link/dotnet/Tesslo.Link.Server` (defaults to 127.0.0.1:20111).
- OHOS cross build: `pnpm build:link:csharp` (requires .NET 9.0.104 and OHOS Native SDK 26).
- Current scope: WebSocket handshake, `getVersion`, `discover` + fake `didDiscoverPeripheral`,
  `connect`, `read`, `write`, `startNotifications`, `stopNotifications`.
- HAP integration: `napi/libtesslolink.so` loads `TessloLinkNative.so`; ArkTS starts it on
  20111 and Electron skips the JS link when the C# library is present.
- Verified on device: `getVersion` and `discover`.
- BLE scan: C# talks to `apps/ohos/web_engine/.../BleTcpBridge.ets` over 127.0.0.1:20113;
  real scan observed 75 devices on device.
- GATT connect/getServices/read/write/startNotifications/stopNotifications are implemented
  over the same bridge; micro:bit/WeDo hardware regression is pending.
- Next: BT Classic and protocol state-machine parity.
