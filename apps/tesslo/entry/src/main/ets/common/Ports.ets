// 设备内三个本地服务的端口约定，改动任一端口时需同步以下位置：
// - LINK_PORT：上游 scratch-link-common ScratchLinkApp.WebSocketPort、
//   napi/tesslo_link_napi.cpp 默认值、web/src/constants.js 无需（不直连）
// - BLE_BRIDGE_PORT：packages/scratch-link/scratch-link-ohos/BLE/OhosBleClient.cs
// - ASSET_SERVER_PORT：apps/tesslo/web/src/constants.js ASSET_ORIGIN

// C# Scratch Link 的 WebSocket 端口（上游 ScratchLinkApp 固定值）
export const LINK_PORT: number = 20111;
// ArkTS BLE 桥的 TCP 端口（BleTcpBridge.ets <-> scratch-link-ohos 客户端）
export const BLE_BRIDGE_PORT: number = 20113;
// 离线素材 HTTP 服务端口（AssetServer.ets <-> web/src/constants.js）
export const ASSET_SERVER_PORT: number = 20114;
