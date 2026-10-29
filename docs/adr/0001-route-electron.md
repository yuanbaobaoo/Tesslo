# ADR 0001: Electron on HarmonyOS

## Status

Accepted.

## Context

Tesslo targets the same editing experience as Scratch Desktop on Windows and
macOS. The editor is web code; the platform-specific parts are the desktop shell,
the HAP host, file/permission integration, and the hardware bridge.

Routes considered:

1. Electron on HarmonyOS, reusing the desktop main process and renderer.
2. ArkTS shell + ArkWeb, reusing only the web editor.

## Decision

Use the Electron route for v1, with a minimal HarmonyOS host and a C# Scratch
Link server loaded through NativeAOT/NAPI.

## Rationale

- Reuses the official desktop shell and its file/dialog/permission behavior.
- Keeps the editor on the same source line as Scratch Desktop.
- The HAP host can stay small: boot Electron, host its window, and expose the
  BLE bridge.
- C# reuses the upstream Scratch Link protocol implementation; NativeAOT is the
  supported .NET runtime on HarmonyOS.

## Consequences

- Requires the JIT ACL permission
  `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY`.
- Targets HarmonyOS 7 tablets / 2-in-1; phones are out of scope.
- HAP packaging is custom; it is not electron-builder output.
- If JIT ACL is denied or phone support becomes mandatory, the ArkWeb shell
  remains the fallback route; the editor source and BLE bridge can be reused.
