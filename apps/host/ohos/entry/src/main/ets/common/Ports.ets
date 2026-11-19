// 设备内本地服务的端口约定，改动任一端口时需同步以下位置：
// - LINK_PORT：上游 scratch-link-common ScratchLinkApp.WebSocketPort、
//   napi/tesslo_link_napi.cpp 默认值、web/src/constants.js 无需（不直连）
// - BLE_BRIDGE_PORT：packages/scratch-link/scratch-link-ohos/BLE/OhosBleClient.cs
// - ASSET_SERVER_PORT：web 侧 @tesslo/platform-adapter harmony.ts（唯一出口）
// - PROJECT_SERVER_PORT：同上，经 @tesslo/platform-adapter 访问

// C# Scratch Link 的 WebSocket 端口（上游 ScratchLinkApp 固定值）
export const LINK_PORT: number = 20111;
// ArkTS BLE 桥的 TCP 端口（BleTcpBridge.ets <-> scratch-link-ohos 客户端）
export const BLE_BRIDGE_PORT: number = 20113;
// 离线素材 HTTP 服务端口（AssetServer.ets <-> platform-adapter）
export const ASSET_SERVER_PORT: number = 20114;
// 作品库 HTTP 服务端口（ProjectServer.ets <-> platform-adapter，P1）
export const PROJECT_SERVER_PORT: number = 20117;
