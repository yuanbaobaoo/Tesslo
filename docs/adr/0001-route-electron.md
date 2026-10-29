# ADR 0001: Electron on HarmonyOS vs ArkTS rewrite

## Status

Accepted (PoC), revisit after JIT ACL verification.

## Context

The goal is an experience consistent with Scratch Desktop on Windows/macOS,
while following the upstream `scratch-desktop` + `scratch-link` route.

Two viable routes:

1. **Electron on HarmonyOS** — reuse the desktop shell and renderer.
2. **ArkTS shell + ArkWeb** — rewrite the desktop shell, reuse the web editor.

## Decision

Start with the Electron route.

## Rationale

- Reuses the official desktop main process and renderer HOCs.
- Keeps upstream tracking cheap: patch only the platform edges.
- Electron 40 is available on HarmonyOS.
- Scratch Desktop's required APIs (dialogs, downloads, permissions, USB/HID)
  are reported as supported by the Electron-on-HarmonyOS API matrix.

## Consequences

- Requires the JIT ACL permission
  `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY`.
- Target devices are HarmonyOS tablets / 2-in-1; phones are out of scope.
- The HAP packaging layer is custom (electron-builder does not emit HAP).
- If JIT ACL is denied or phone support becomes mandatory, switch to the
  ArkTS/ArkWeb shell route. The Scratch Link implementation and the editor
  dependency remain unchanged.
